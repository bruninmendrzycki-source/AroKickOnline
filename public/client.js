
(() => {
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const screens = {
  main: document.getElementById('mainMenu'),
  mode: document.getElementById('modeMenu'),
  mp: document.getElementById('multiplayerMenu'),
  lobby: document.getElementById('lobbyScreen'),
  settings: document.getElementById('mainSettings'),
  shop: document.getElementById('shopScreen')
};

const hud = document.getElementById('hud');
const mobileControls = document.getElementById('mobileControls');
const replayOverlay = document.getElementById('replayOverlay');
const skipReplayBtn = document.getElementById('skipReplayBtn');

let DPR = 1;
let W = 0, H = 0;

const settings = {
  fps: 120,
  graphics: 'high',
  brightness: 100,
  trainingMode: '4v4'
};

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
function resize() {
  const maxDpr = settings.graphics === 'low' ? 1.4 : settings.graphics === 'medium' ? 1.8 : 2.4;
  DPR = Math.min(window.devicePixelRatio || 1, maxDpr);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function showScreen(name) {
  for (const s of Object.values(screens)) s.classList.remove('active');
  if (screens[name]) screens[name].classList.add('active');
  const inGame = name === 'game';
  hud.classList.toggle('hidden', !inGame);
  mobileControls.classList.toggle('hidden', !inGame || !isTouchDevice());
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${String(m).padStart(2, '0')}:${ss}`;
}

document.getElementById('btnTraining').onclick = () => showScreen('mode');
document.getElementById('btnMultiplayer').onclick = () => { showScreen('mp'); requestRooms(); };
document.getElementById('btnMainSettings').onclick = () => showScreen('settings');
document.getElementById('btnShop').onclick = () => showScreen('shop');
for (const btn of document.querySelectorAll('.backBtn')) btn.onclick = () => showScreen('main');

document.getElementById('setFps').onchange = e => settings.fps = Number(e.target.value) || 120;
document.getElementById('setGraphics').onchange = e => { settings.graphics = e.target.value; resize(); };
document.getElementById('setBrightness').oninput = e => {
  settings.brightness = Number(e.target.value) || 100;
  const v = settings.brightness;
  const overlay = document.getElementById('brightnessOverlay');
  if (v < 100) overlay.style.background = `rgba(0,0,0,${(100-v)/100})`;
  else overlay.style.background = `rgba(255,255,255,${(v-100)/220})`;
};
document.getElementById('btnFullscreen').onclick = async () => {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement) await el.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    toast('Tela cheia bloqueada pelo navegador.');
  }
};

const MODES = {
  '1v1': { label: '1 vs 1', maxTeam: 1, width: 2200, height: 1280, goal: 340, depth: 150, areaW: 360, areaH: 560, smallW: 150, smallH: 360 },
  '2v2': { label: '2 vs 2', maxTeam: 2, width: 2700, height: 1500, goal: 420, depth: 165, areaW: 440, areaH: 680, smallW: 180, smallH: 430 },
  '3v3': { label: '3 vs 3', maxTeam: 3, width: 3200, height: 1760, goal: 500, depth: 180, areaW: 520, areaH: 820, smallW: 215, smallH: 500 },
  '4v4': { label: '4 vs 4', maxTeam: 4, width: 3900, height: 2100, goal: 580, depth: 210, areaW: 630, areaH: 980, smallW: 260, smallH: 580 }
};
function fieldFor(mode) {
  const m = MODES[mode] || MODES['4v4'];
  return {
    mode,
    label: m.label,
    width: m.width, height: m.height,
    left: -m.width / 2, right: m.width / 2,
    top: -m.height / 2, bottom: m.height / 2,
    goalH: m.goal, goalDepth: m.depth,
    areaW: m.areaW, areaH: m.areaH,
    smallW: m.smallW, smallH: m.smallH,
    centerCircle: Math.round(Math.min(m.width, m.height) * 0.165)
  };
}

let local = null;
for (const btn of document.querySelectorAll('.mode-grid button')) {
  btn.onclick = () => startTraining(btn.dataset.mode);
}
function startTraining(mode) {
  const f = fieldFor(mode);
  local = {
    type: 'training',
    phase: 'playing',
    field: f,
    score: { red: 0, blue: 0 },
    clockMs: 0,
    ball: { x: 0, y: 0, r: 24, vx: 0, vy: 0, spin: 0, lastTouch: 'local' },
    players: [{ id: 'local', nickname: nick(), team: 'blue', color: '#229dff', x: f.left + f.width * 0.25, y: 0, vx: 0, vy: 0, r: 42, contactTime: 0, kickCooldown: 0 }],
    history: [],
    replay: null
  };
  state = local;
  replayOverlay.classList.add('hidden');
  showScreen('game');
}

document.getElementById('homeBtn').onclick = () => {
  if (mp.inRoom) send({ type: 'leaveRoom' });
  local = null;
  state = null;
  showScreen('main');
};
document.getElementById('matchConfigBtn').onclick = () => {
  showScreen('settings');
};

function nick() {
  return (document.getElementById('nickInput').value || 'Player').trim().slice(0, 18) || 'Player';
}

/* Multiplayer */
let ws = null;
const mp = {
  selfId: null,
  inRoom: false,
  roomCode: null,
  isAdmin: false,
  selectedPlayerId: null,
  replayFrames: null,
  replayStarted: 0,
  replayDuration: 0,
  replayScorer: null
};

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => requestRooms();
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMsg(msg);
  };
  ws.onclose = () => {
    if (mp.inRoom) toast('Conexão perdida.');
    mp.inRoom = false;
    setTimeout(connect, 1300);
  };
}
connect();

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Servidor desconectado.');
    return;
  }
  ws.send(JSON.stringify(obj));
}
function requestRooms() { send({ type: 'listRooms' }); }
document.getElementById('btnCreateRoom').onclick = () => send({ type: 'createRoom', nickname: nick(), mode: document.getElementById('roomMode').value });
document.getElementById('btnJoinRoom').onclick = () => send({ type: 'joinRoom', nickname: nick(), code: document.getElementById('joinCodeInput').value });
document.getElementById('btnListRooms').onclick = requestRooms;
document.getElementById('btnLobbyBack').onclick = () => {
  send({ type: 'leaveRoom' });
  mp.inRoom = false;
  state = null;
  showScreen('mp');
  requestRooms();
};
document.getElementById('btnStartMatch').onclick = () => {
  if (state?.phase === 'playing') send({ type: 'restartMatch' });
  else send({ type: 'startMatch' });
};

function handleMsg(msg) {
  if (msg.type === 'hello') {
    mp.selfId = msg.id;
  } else if (msg.type === 'rooms') {
    renderRooms(msg.rooms || []);
  } else if (msg.type === 'joinedRoom') {
    mp.inRoom = true;
    mp.roomCode = msg.info.code;
    state = msg.info;
    state.ball = state.ball || {x:0,y:0,r:24,vx:0,vy:0,spin:0};
    mp.isAdmin = msg.info.adminId === mp.selfId;
    renderLobby(msg.info);
    showScreen('lobby');
  } else if (msg.type === 'roomInfo') {
    state = { ...(state || {}), ...msg.info };
    state.ball = state.ball || {x:0,y:0,r:24,vx:0,vy:0,spin:0};
    mp.isAdmin = msg.info.adminId === mp.selfId;
    renderLobby(msg.info);
  } else if (msg.type === 'state') {
    if (mp.replayFrames) return;
    state = msg;
    document.getElementById('scoreRed').textContent = msg.score?.red ?? 0;
    document.getElementById('scoreBlue').textContent = msg.score?.blue ?? 0;
    document.getElementById('matchClock').textContent = fmtClock(msg.clockMs || 0);
    if (screens.lobby.classList.contains('active') && msg.phase === 'playing') showScreen('game');
  } else if (msg.type === 'matchStarted') {
    state = msg.info;
    showScreen('game');
  } else if (msg.type === 'replayStart') {
    mp.replayFrames = msg.frames || [];
    mp.replayStarted = performance.now();
    mp.replayDuration = msg.duration || 5500;
    mp.replayScorer = msg.scorerId;
    replayOverlay.classList.remove('hidden');
    skipReplayBtn.classList.toggle('hidden', mp.selfId !== msg.scorerId);
  } else if (msg.type === 'replayEnd') {
    mp.replayFrames = null;
    replayOverlay.classList.add('hidden');
  } else if (msg.type === 'sound') {
    playSound(msg.name);
  } else if (msg.type === 'errorMsg') {
    toast(msg.message);
  } else if (msg.type === 'leftRoom') {
    mp.inRoom = false;
    state = null;
    showScreen('mp');
  }
}
skipReplayBtn.onclick = () => send({ type: 'skipReplay' });

function renderRooms(rooms) {
  const el = document.getElementById('roomsList');
  if (!rooms.length) {
    el.innerHTML = '<div class="room-card"><span>Nenhuma sala encontrada</span></div>';
    return;
  }
  el.innerHTML = '';
  for (const r of rooms) {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `<div><strong>${r.code}</strong><br><small>${r.label} • ${r.players} jogador(es)</small></div>`;
    const b = document.createElement('button');
    b.textContent = 'ENTRAR';
    b.onclick = () => send({ type: 'joinRoom', nickname: nick(), code: r.code });
    card.appendChild(b);
    el.appendChild(card);
  }
}
function renderLobby(info) {
  if (!info) return;
  document.getElementById('roomCodeText').textContent = info.code;
  document.getElementById('btnStartMatch').style.display = info.adminId === mp.selfId ? '' : 'none';
  document.getElementById('btnStartMatch').textContent = info.phase === 'playing' ? 'REINICIAR' : 'INICIAR';

  const red = document.getElementById('redList'), blue = document.getElementById('blueList'), spec = document.getElementById('specList');
  red.innerHTML = blue.innerHTML = spec.innerHTML = '';
  const lists = { red, blue, spectators: spec };
  for (const p of info.players) {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `<div class="player-dot" style="background:${p.color || '#fff'}"></div>
      <div><strong>${p.nickname}${p.admin ? ' 👑' : ''}</strong><br><small>${p.team === 'spectators' ? 'Reserva' : p.team === 'red' ? 'Red Team' : 'Blue Team'}</small></div>
      <small>${p.ping || 0}ms</small>`;
    row.onclick = () => {
      if (info.adminId !== mp.selfId) return;
      openPlayerActions(p);
    };
    (lists[p.team] || spec).appendChild(row);
  }
}
function openPlayerActions(p) {
  mp.selectedPlayerId = p.id;
  document.getElementById('actionPlayerName').textContent = p.nickname;
  document.getElementById('playerActionModal').classList.remove('hidden');
}
document.getElementById('playerActionModal').addEventListener('click', e => {
  if (e.target.id === 'playerActionModal') e.currentTarget.classList.add('hidden');
});
for (const b of document.querySelectorAll('#playerActionModal button')) {
  b.onclick = () => {
    const action = b.dataset.action;
    if (action === 'close') {
      document.getElementById('playerActionModal').classList.add('hidden');
      return;
    }
    if (action === 'admin') send({ type: 'passAdmin', playerId: mp.selectedPlayerId });
    else send({ type: 'assignTeam', playerId: mp.selectedPlayerId, team: action });
    document.getElementById('playerActionModal').classList.add('hidden');
  };
}

/* Input */
const input = { x: 0, y: 0, kick: false };
const keys = new Set();
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
  keys.add(e.code);
  if (e.code === 'Space' || e.code === 'KeyN') input.kick = true;
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'Space' || e.code === 'KeyN') input.kick = false;
});
function updateKeyboardInput() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  if (!joy.active) {
    input.x = x;
    input.y = y;
  }
}

const kickBtn = document.getElementById('kickBtn');
kickBtn.addEventListener('pointerdown', e => { e.preventDefault(); input.kick = true; });
window.addEventListener('pointerup', () => { input.kick = false; });

const joy = { active: false, id: null, x: 0, y: 0 };
const joystick = document.getElementById('joystick');
const knob = joystick.querySelector('div');
joystick.addEventListener('pointerdown', e => {
  joy.active = true; joy.id = e.pointerId; joystick.setPointerCapture(e.pointerId);
  joyMove(e);
});
joystick.addEventListener('pointermove', e => { if (joy.active && e.pointerId === joy.id) joyMove(e); });
joystick.addEventListener('pointerup', e => {
  if (e.pointerId === joy.id) {
    joy.active = false; joy.id = null; input.x = 0; input.y = 0; knob.style.transform = 'translate(0,0)';
  }
});
function joyMove(e) {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = rect.width * 0.37;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  knob.style.transform = `translate(${dx}px,${dy}px)`;
  const dead = 0.1;
  let ix = dx / max, iy = dy / max;
  if (Math.hypot(ix, iy) < dead) ix = iy = 0;
  input.x = ix; input.y = iy;
}
let lastInputSent = 0;
function sendInput(t) {
  if (t - lastInputSent < 33) return;
  lastInputSent = t;
  if (mp.inRoom && state?.phase === 'playing') send({ type: 'input', x: input.x, y: input.y, kick: input.kick });
}

/* Local training physics */
function localTick(dt) {
  if (!local || local.phase !== 'playing') return;
  local.clockMs += dt * 1000;
  const p = local.players[0], b = local.ball, f = local.field;
  const len = Math.hypot(input.x, input.y);
  const nx = len > 0.08 ? input.x / len : 0;
  const ny = len > 0.08 ? input.y / len : 0;
  const touching = Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r + 10;
  if (touching) p.contactTime += dt; else p.contactTime = Math.max(0, p.contactTime - dt * 2);
  const speed = 430 * (touching ? 0.84 : 1);
  p.vx = nx * speed * Math.min(1, len); p.vy = ny * speed * Math.min(1, len);
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = Math.max(f.left + p.r, Math.min(f.right - p.r, p.x));
  p.y = Math.max(f.top + p.r, Math.min(f.bottom - p.r, p.y));

  let dx = b.x - p.x, dy = b.y - p.y;
  let d = Math.hypot(dx, dy) || 1;
  if (d < p.r + b.r) {
    const ax = dx / d, ay = dy / d;
    b.x = p.x + ax * (p.r + b.r + 0.3);
    b.y = p.y + ay * (p.r + b.r + 0.3);
    const pv = p.vx * ax + p.vy * ay;
    if (pv > 0) { b.vx += ax * pv * 0.42; b.vy += ay * pv * 0.42; }
    b.lastTouch = p.id;
  }
  const ring = p.r + 19;
  if (input.kick && d <= ring + b.r + 7 && p.kickCooldown <= 0) {
    const ax = dx / d || 1, ay = dy / d || 0;
    const playerSpeed = Math.hypot(p.vx, p.vy);
    const pushForward = playerSpeed > 120 && (p.vx * ax + p.vy * ay) / (playerSpeed || 1) > 0.62;
    let strength = 1160 * (pushForward ? 1.16 : 1);
    b.vx = ax * strength + p.vx * 0.22;
    b.vy = ay * strength + p.vy * 0.22;
    p.kickCooldown = .28;
    playSound('kick');
  }
  p.kickCooldown = Math.max(0, p.kickCooldown - dt);
  b.x += b.vx * dt; b.y += b.vy * dt; b.spin += Math.hypot(b.vx, b.vy) * dt * 0.015;
  b.vx *= Math.pow(0.988, dt * 60); b.vy *= Math.pow(0.988, dt * 60);
  const inMouth = Math.abs(b.y) < f.goalH / 2 - b.r * .2;
  if (b.y - b.r < f.top) { b.y = f.top + b.r; b.vy = Math.abs(b.vy) * .46; }
  if (b.y + b.r > f.bottom) { b.y = f.bottom - b.r; b.vy = -Math.abs(b.vy) * .46; }
  if (b.x - b.r < f.left && !inMouth) { b.x = f.left + b.r; b.vx = Math.abs(b.vx) * .5; }
  if (b.x + b.r > f.right && !inMouth) { b.x = f.right - b.r; b.vx = -Math.abs(b.vx) * .5; }
  const leftNetX = f.left - f.goalDepth * .72;
  const rightNetX = f.right + f.goalDepth * .72;
  if (Math.abs(b.y) < f.goalH / 2 + b.r * .6) {
    if (b.x - b.r < leftNetX && b.x > f.left - f.goalDepth - b.r) { b.x = leftNetX + b.r; b.vx = Math.abs(b.vx) * .08; b.vy *= .58; playSound('net'); }
    if (b.x + b.r > rightNetX && b.x < f.right + f.goalDepth + b.r) { b.x = rightNetX - b.r; b.vx = -Math.abs(b.vx) * .08; b.vy *= .58; playSound('net'); }
  }
}

/* Drawing */
let state = null;
const cam = { x: 0, y: 0, z: 1 };
function currentReplayState() {
  if (!mp.replayFrames) return null;
  const frames = mp.replayFrames;
  if (!frames.length) return null;
  const t = performance.now() - mp.replayStarted;
  const idx = Math.min(frames.length - 1, Math.floor((t / mp.replayDuration) * frames.length));
  const frame = frames[idx];
  return {
    phase: 'replay',
    field: state?.field || fieldFor('4v4'),
    score: frame.score || state?.score || {red:0,blue:0},
    ball: frame.ball,
    players: frame.players || [],
    clockMs: state?.clockMs || 0
  };
}
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const s = currentReplayState() || state;
  if (!s || !s.field) {
    drawMenuBackground();
    return;
  }
  const f = s.field;
  const me = (s.players || []).find(p => p.id === mp.selfId) || (s.players || [])[0];
  const focus = me ? { x: me.x * 0.78 + (s.ball?.x || 0) * 0.22, y: me.y * 0.78 + (s.ball?.y || 0) * 0.22 } : (s.ball || {x:0,y:0});
  const baseZoom = Math.min(W / (f.width * 0.75), H / (f.height * 0.75));
  const z = Math.max(0.33, Math.min(1.2, baseZoom * (isTouchDevice() ? 1.15 : 1.25)));
  cam.x += (focus.x - cam.x) * 0.08;
  cam.y += (focus.y - cam.y) * 0.08;
  cam.z += (z - cam.z) * 0.08;

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.z, cam.z);
  ctx.translate(-cam.x, -cam.y);

  drawField(f);
  if (settings.graphics !== 'low') drawNets(f, s.ball);
  for (const p of (s.players || [])) drawPlayer(p);
  if (s.ball) drawBall(s.ball);

  ctx.restore();

  if (s.score) {
    document.getElementById('scoreRed').textContent = s.score.red ?? 0;
    document.getElementById('scoreBlue').textContent = s.score.blue ?? 0;
  }
  document.getElementById('matchClock').textContent = fmtClock(s.clockMs || 0);
}
function drawMenuBackground() {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0e3512'); g.addColorStop(1, '#071108');
  ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  ctx.globalAlpha = .25;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  const step = 80;
  for (let x = -100; x < W + 100; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 120, H); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawField(f) {
  ctx.fillStyle = '#177d31';
  ctx.fillRect(f.left - f.goalDepth - 80, f.top - 80, f.width + f.goalDepth * 2 + 160, f.height + 160);
  if (settings.graphics === 'high') {
    ctx.globalAlpha = .13;
    for (let x = f.left; x < f.right; x += 160) {
      ctx.fillStyle = Math.floor((x - f.left) / 160) % 2 ? '#0d6126' : '#1c9139';
      ctx.fillRect(x, f.top, 160, f.height);
    }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.lineWidth = 8;
  ctx.strokeRect(f.left, f.top, f.width, f.height);
  ctx.beginPath(); ctx.moveTo(0, f.top); ctx.lineTo(0, f.bottom); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, f.centerCircle, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();

  for (const side of [-1, 1]) {
    const x = side < 0 ? f.left : f.right;
    const areaX = side < 0 ? x : x - f.areaW;
    const smallX = side < 0 ? x : x - f.smallW;
    ctx.strokeRect(areaX, -f.areaH/2, f.areaW, f.areaH);
    ctx.strokeRect(smallX, -f.smallH/2, f.smallW, f.smallH);
    // Gol/traves
    ctx.strokeStyle = '#f7f7f7';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(x, -f.goalH / 2);
    ctx.lineTo(x + side * -f.goalDepth * 0.72, -f.goalH / 2);
    ctx.moveTo(x, f.goalH / 2);
    ctx.lineTo(x + side * -f.goalDepth * 0.72, f.goalH / 2);
    ctx.stroke();
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.arc(x, -f.goalH/2, 10, 0, Math.PI*2);
    ctx.arc(x, f.goalH/2, 10, 0, Math.PI*2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.lineWidth = 8;
  }
}
function drawNets(f, ball) {
  for (const side of [-1, 1]) {
    const mouthX = side < 0 ? f.left : f.right;
    const netX = mouthX + side * f.goalDepth * 0.72;
    const impact = ball && Math.abs(ball.y) < f.goalH / 2 + 60 && Math.abs(ball.x - netX) < 130 ? (side < 0 ? -1 : 1) * Math.max(0, 70 - Math.abs(ball.x - netX)) : 0;
    ctx.strokeStyle = 'rgba(255,255,255,.32)';
    ctx.lineWidth = 3;
    const top = -f.goalH / 2, bottom = f.goalH / 2;
    for (let y = top; y <= bottom + 1; y += 52) {
      ctx.beginPath();
      ctx.moveTo(mouthX, y);
      ctx.quadraticCurveTo((mouthX + netX)/2 + impact * .25, y + impact * .04, netX + impact * .7, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 5; i++) {
      const y = top + (bottom - top) * i / 5;
      ctx.beginPath();
      ctx.moveTo(netX + impact * .6, top);
      ctx.lineTo(netX + impact * .6, bottom);
      ctx.stroke();
      break;
    }
    for (let y = top; y <= bottom + 1; y += 52) {
      ctx.beginPath(); ctx.moveTo(netX + impact*.6, y); ctx.lineTo(netX + impact*.6, y + 1); ctx.stroke();
    }
  }
}
function drawPlayer(p) {
  const r = p.r || 40;
  const teamColor = p.team === 'red' ? '#ff4949' : p.team === 'blue' ? '#229dff' : '#eeeeee';
  const ringColor = p.team === 'red' ? '#ff2828' : p.team === 'blue' ? '#178bff' : '#fff';

  // Branco fixo entre corpo e borda quando chute está pressionado localmente.
  const isMe = p.id === mp.selfId || (local && p.id === 'local');
  if (isMe && input.kick) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 17, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(p.x, p.y, r + 18, 0, Math.PI * 2);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 7;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.color || teamColor;
  ctx.fill();
  ctx.strokeStyle = '#070707';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = '700 24px Arial';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,.65)';
  ctx.lineWidth = 5;
  const name = p.nickname || 'Player';
  ctx.strokeText(name, p.x, p.y + r + 34);
  ctx.fillText(name, p.x, p.y + r + 34);
}
function drawBall(b) {
  const r = b.r || 24;
  const rot = (b.spin || 0) + (performance.now() * 0.002);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f5f5';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#111';
  ctx.stroke();

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.82, r * (0.22 + i * 0.08), i * Math.PI / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#35b8ff';
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, r * 0.13, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

/* Sounds */
let audioCtx = null;
function audio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, dur, type, gainVal, when = 0) {
  const ac = audio();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, ac.currentTime + when);
  gain.gain.setValueAtTime(gainVal, ac.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + dur);
  osc.connect(gain); gain.connect(ac.destination);
  osc.start(ac.currentTime + when); osc.stop(ac.currentTime + when + dur);
}
function playSound(name) {
  try {
    if (name === 'kick') {
      tone(115, .055, 'square', .08);
      tone(72, .09, 'sine', .05);
    } else if (name === 'post') {
      tone(880, .07, 'triangle', .09);
      tone(1240, .12, 'sine', .045, .015);
      tone(510, .16, 'sine', .03, .025);
    } else if (name === 'net') {
      tone(170, .08, 'triangle', .035);
      tone(95, .12, 'sine', .025, .02);
    }
  } catch {}
}

/* Main loop */
let last = performance.now();
let accum = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const minFrame = 1000 / settings.fps;
  if (t - accum < minFrame - 0.3) return;
  accum = t;
  const dt = Math.min(1/30, (t - last) / 1000 || 1/60);
  last = t;

  updateKeyboardInput();
  sendInput(t);
  if (local) localTick(dt);
  draw();
}
requestAnimationFrame(frame);

})();
