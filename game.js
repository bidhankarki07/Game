'use strict';
/* ===== Fruit Frenzy — vanilla JS / Canvas 2D ===== */
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const S = { MENU: 0, PLAYING: 1, PAUSED: 2, OVER: 3, SCORES: 4, SETTINGS: 5 };
const LH = 700, G = 900; // logical height, gravity
let state = S.MENU, W = 1000, scale = 1, bg = null;

/* ---------- storage (fails safe) ---------- */
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
let high = +store.get('fruitGameHighScore', 0) || 0;
let settings = Object.assign({ sound: true }, store.get('fruitGameSettings', {}));
let save = store.get('fruitGameSave', null);
const validSave = s => s && s.resumable && Number.isFinite(s.score) && s.lives > 0 && s.level >= 1;
if (!validSave(save)) save = null;

/* ---------- audio (synth, no files) ---------- */
let ac = null;
function beep(f, d = .1, type = 'triangle', v = .12, f2) {
  if (!settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
  } catch (e) {}
}

/* ---------- game data ---------- */
const FRUITS = {
  apple:      { r: 38, c: '#d62828', c2: '#7a0c0c', pts: 10 },
  orange:     { r: 40, c: '#ff9f1c', c2: '#c45f00', pts: 10 },
  banana:     { r: 36, c: '#ffe14d', c2: '#b8941a', pts: 15 },
  strawberry: { r: 30, c: '#e63946', c2: '#8f1d2c', pts: 20 },
  watermelon: { r: 52, c: '#2e8b3a', c2: '#e63950', pts: 25 }
};
const TYPES = Object.keys(FRUITS);
let g, fruits, halves, parts, pops, trail, shake = 0, lastT = 0, running = false;

function newGame(s) {
  g = { score: s ? s.score : 0, level: s ? s.level : 1, lives: s ? s.lives : 3, combo: 0, comboT: 0, wave: 1, flash: 0, banner: 0 };
  fruits = []; halves = []; parts = []; pops = []; trail = [];
}

/* ---------- spawning ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
function launch(type, xFrac) {
  const bomb = type === 'bomb', d = bomb ? { r: 34 } : FRUITS[type];
  const x = W * xFrac, h = LH * rnd(.55, .85) * (1 + Math.min(g.level, 8) * .01);
  const vy = -Math.sqrt(2 * G * h), spd = 1 + Math.min(g.level - 1, 10) * .04;
  const vx = (W / 2 - x) * rnd(.1, .45) * .5 + rnd(-60, 60);
  fruits.push({ type, x, y: LH + d.r, vx, vy: vy * Math.min(spd, 1.2), r: d.r, rot: rnd(0, 6.3), rs: rnd(-4, 4), isSliced: false });
}
function spawnWave() {
  const L = g.level, n = Math.min(1 + Math.floor(Math.random() * (1 + L * .6)), 6);
  const bombP = L < 2 ? 0 : Math.min(.08 + L * .02, .28);
  let bombUsed = false;
  for (let i = 0; i < n; i++) {
    const isBomb = !bombUsed && Math.random() < bombP && n > 1;
    if (isBomb) bombUsed = true;
    setTimeout(() => state === S.PLAYING && launch(isBomb ? 'bomb' : TYPES[Math.random() * TYPES.length | 0], rnd(.12, .88)), i * rnd(60, 180));
  }
  g.wave = Math.max(.7, 2.2 - L * .15) * rnd(.8, 1.2);
}

/* ---------- slicing ---------- */
function segHit(ax, ay, bx, by, f) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((f.x - ax) * dx + (f.y - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx - f.x, py = ay + t * dy - f.y;
  return px * px + py * py <= f.r * f.r;
}
function sliceSeg(ax, ay, bx, by) {
  let n = 0;
  for (const f of fruits) {
    if (f.isSliced || !segHit(ax, ay, bx, by, f)) continue;
    f.isSliced = true;
    const ang = Math.atan2(by - ay, bx - ax);
    if (f.type === 'bomb') { hitBomb(f); continue; }
    n++; cutFruit(f, ang);
  }
  if (n) {
    g.combo = performance.now() - g.comboT < 1000 ? g.combo + n : n; g.comboT = performance.now();
    let pts = 0; for (let i = 0; i < n; i++) pts += 10;
    if (g.combo >= 2) { pts += g.combo * 5; pops.push({ x: W / 2, y: LH * .3, t: 1, s: 'COMBO x' + g.combo, big: 1 }); beep(500 + g.combo * 80, .15, 'square', .08); }
    if (n >= 3) pts += n * 10;
    g.score += pts; checkLevel();
  }
}
function cutFruit(f, ang) {
  const d = FRUITS[f.type]; g.score += d.pts - 10;
  beep(700, .12, 'sawtooth', .08, 200);
  pops.push({ x: f.x, y: f.y - 20, t: .8, s: '+' + d.pts });
  for (const side of [-1, 1]) {
    const a = ang + side * Math.PI / 2;
    halves.push({ type: f.type, x: f.x, y: f.y, vx: f.vx + Math.cos(a) * 140, vy: f.vy * .3 + Math.sin(a) * 140, rot: f.rot, rs: f.rs + side * 3, cut: ang, side, life: 1.4, r: f.r });
  }
  for (let i = 0; i < 16 && parts.length < 300; i++) {
    const a = rnd(0, 6.3), s = rnd(60, 360);
    parts.push({ x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rnd(.4, .9), t: 0, r: rnd(2, 6), c: i % 5 ? d.c : '#fff' });
  }
}
function hitBomb(f) {
  beep(90, .5, 'sawtooth', .25, 30); shake = .5; g.flash = .4; g.combo = 0;
  for (let i = 0; i < 30 && parts.length < 300; i++) { const a = rnd(0, 6.3), s = rnd(100, 500); parts.push({ x: f.x, y: f.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(.3, .8), t: 0, r: rnd(3, 7), c: i % 2 ? '#ffb347' : '#555' }); }
  loseLife();
}
function loseLife() { if (--g.lives <= 0) { g.lives = 0; gameOver(); } }
function checkLevel() {
  const L = 1 + Math.floor(g.score / 300);
  if (L > g.level) { g.level = L; g.banner = 1.8; beep(400, .3, 'square', .1, 900); }
}

/* ---------- state transitions ---------- */
const show = id => { for (const s of ['menu', 'scores', 'settings', 'pause', 'over']) $(s).classList.toggle('hidden', s !== id); $('pauseBtn').classList.toggle('hidden', state !== S.PLAYING); };
function persist() { if (state === S.PLAYING || state === S.PAUSED) { save = { score: g.score, level: g.level, lives: g.lives, difficulty: g.level, resumable: true }; store.set('fruitGameSave', save); } }
function refreshMenu() { $('btnResume').classList.toggle('hidden', !save); $('btnSound').textContent = 'SOUND: ' + (settings.sound ? 'ON' : 'OFF'); $('hsBig').textContent = String(high).padStart(7, '0'); }
function toMenu() { persist(); state = S.MENU; refreshMenu(); show('menu'); }
function startGame(s) { newGame(s); state = S.PLAYING; show(null); }
function pause() { if (state !== S.PLAYING) return; state = S.PAUSED; persist(); show('pause'); }
function unpause() { if (state === S.PAUSED) { state = S.PLAYING; trail = []; show(null); } }
function gameOver() {
  const isNew = g.score > high; if (isNew) { high = g.score; store.set('fruitGameHighScore', high); }
  save = null; store.del('fruitGameSave'); state = S.OVER;
  $('goScore').textContent = g.score; $('goHigh').textContent = high; $('goLevel').textContent = g.level;
  $('newHS').classList.toggle('hidden', !isNew); beep(200, .8, 'sawtooth', .15, 60); show('over');
}
const actions = {
  start: () => { beep(600, .08); startGame(null); },
  resume: () => save && startGame(save),
  scores: () => { state = S.SCORES; refreshMenu(); show('scores'); },
  settings: () => { state = S.SETTINGS; refreshMenu(); show('settings'); },
  menu: toMenu, quit: toMenu, pause, unpause,
  sound: () => { settings.sound = !settings.sound; store.set('fruitGameSettings', settings); refreshMenu(); beep(600, .08); }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { b.blur(); actions[b.dataset.act](); } });
addEventListener('keydown', e => {
  if (e.key === 'Escape') state === S.PLAYING ? pause() : state === S.PAUSED ? unpause() : 0;
});
document.addEventListener('visibilitychange', () => document.hidden && pause());
addEventListener('blur', pause);
addEventListener('pagehide', persist);

/* ---------- input (Pointer Events) ---------- */
let last = null;
const pos = e => ({ x: e.clientX / scale, y: e.clientY / scale });
cv.addEventListener('pointerdown', e => { last = pos(e); trail = []; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
cv.addEventListener('pointermove', e => {
  if (state !== S.PLAYING) { last = null; return; }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) {
    const p = pos(ev), t = performance.now();
    if (last) sliceSeg(last.x, last.y, p.x, p.y);
    trail.push({ x: p.x, y: p.y, t }); if (trail.length > 24) trail.shift();
    last = p;
  }
});
cv.addEventListener('pointerup', () => { last = null; });
cv.addEventListener('pointerleave', () => { last = null; });

/* ---------- resize / background ---------- */
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  scale = innerHeight / LH; W = innerWidth / scale;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  bg = document.createElement('canvas'); bg.width = Math.ceil(W); bg.height = LH;
  const b = bg.getContext('2d'), ph = LH / 6;
  for (let i = 0; i < 6; i++) {
    const l = 14 + (i % 2) * 3; b.fillStyle = `hsl(25,40%,${l}%)`; b.fillRect(0, i * ph, W, ph);
    for (let k = 0; k < 40; k++) { b.strokeStyle = `rgba(0,0,0,${rnd(.05, .15)})`; b.beginPath(); const y = i * ph + rnd(4, ph - 4), x = rnd(0, W); b.moveTo(x, y); b.lineTo(x + rnd(60, 300), y + rnd(-2, 2)); b.stroke(); }
    b.fillStyle = '#0008'; b.fillRect(0, i * ph, W, 3);
  }
  const v = b.createRadialGradient(W / 2, LH / 2, LH * .3, W / 2, LH / 2, W * .65);
  v.addColorStop(0, '#0000'); v.addColorStop(1, '#000c'); b.fillStyle = v; b.fillRect(0, 0, W, LH);
}
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 150));

/* ---------- drawing ---------- */
function drawFruitBody(type, r, half) {
  if (type === 'bomb') {
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#fff3'; ctx.beginPath(); ctx.arc(-r * .3, -r * .3, r * .25, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#a66'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(10, -r - 14, 18, -r - 10); ctx.stroke();
    ctx.fillStyle = '#ff6a00'; ctx.beginPath(); ctx.arc(18, -r - 10, 5, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e33'; ctx.font = `bold ${r * .8}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☠', 0, 2); return;
  }
  const d = FRUITS[type], gr = ctx.createRadialGradient(-r * .3, -r * .3, r * .1, 0, 0, r);
  gr.addColorStop(0, half ? '#ffeaea' : d.c); gr.addColorStop(1, half ? d.c : d.c2);
  ctx.fillStyle = gr;
  ctx.beginPath();
  if (type === 'banana') ctx.ellipse(0, 0, r * 1.15, r * .5, 0, 0, 6.3); else ctx.arc(0, 0, r, 0, 6.3);
  ctx.fill();
  if (type === 'watermelon') { ctx.strokeStyle = '#145a1e'; ctx.lineWidth = 5; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(0, 0, r - 3, i * .6 - .3, i * .6 + .3); ctx.stroke(); } }
  if (type === 'strawberry') { ctx.fillStyle = '#ffe9a0'; for (let i = 0; i < 6; i++) ctx.fillRect(Math.cos(i * 1.05) * r * .5, Math.sin(i * 1.05) * r * .5, 3, 3); ctx.fillStyle = '#2d9a3a'; ctx.fillRect(-8, -r - 2, 16, 7); }
  if (type === 'apple') { ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, -r + 4); ctx.lineTo(3, -r - 8); ctx.stroke(); }
  if (!half) { ctx.fillStyle = '#fff4'; ctx.beginPath(); ctx.ellipse(-r * .35, -r * .35, r * .22, r * .12, -.7, 0, 6.3); ctx.fill(); }
}
function drawFruit(f) {
  ctx.save(); ctx.translate(f.x, f.y);
  ctx.fillStyle = '#0004'; ctx.beginPath(); ctx.ellipse(6, f.r * .9, f.r * .8, f.r * .25, 0, 0, 6.3); ctx.fill();
  ctx.rotate(f.rot); drawFruitBody(f.type, f.r); ctx.restore();
}
function drawHalf(h) {
  ctx.save(); ctx.translate(h.x, h.y); ctx.globalAlpha = Math.min(1, h.life);
  ctx.rotate(h.rot); ctx.rotate(h.cut - h.rot); // clip along cut direction
  ctx.beginPath(); ctx.rect(-h.r * 2, h.side < 0 ? -h.r * 2 : 0, h.r * 4, h.r * 2); ctx.clip();
  ctx.rotate(h.rot - h.cut); drawFruitBody(h.type, h.r, true); ctx.restore();
}
function drawHeart(x, y, s, on) {
  ctx.fillStyle = on ? '#e63946' : '#3a2a2a'; ctx.beginPath(); ctx.moveTo(x, y + s * .35);
  ctx.bezierCurveTo(x - s, y - s * .3, x - s * .4, y - s, x, y - s * .35);
  ctx.bezierCurveTo(x + s * .4, y - s, x + s, y - s * .3, x, y + s * .35); ctx.fill();
}
function drawHUD() {
  ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = '#f3e6c8'; ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.font = '38px Impact,sans-serif'; ctx.fillText('SCORE: ' + String(g.score).padStart(6, '0'), 20, 16);
  ctx.font = '24px Impact,sans-serif'; ctx.fillStyle = '#ffb347'; ctx.fillText('LEVEL: ' + g.level, 22, 62);
  ctx.shadowBlur = 0; for (let i = 0; i < 3; i++) drawHeart(34 + i * 40, 112, 16, i < g.lives);
}
function drawMenuFruit(t) {
  const x = W * .76, y = LH * .5 + Math.sin(t / 700) * 14, r = Math.min(LH * .3, W * .2);
  ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(x, LH * .84, r * .8, r * .15, 0, 0, 6.3); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(t / 2500); drawFruitBody('watermelon', r); ctx.restore();
}
function drawTrail(now) {
  while (trail.length && now - trail[0].t > 160) trail.shift();
  if (trail.length < 2) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i], k = 1 - (now - b.t) / 160;
    ctx.strokeStyle = `rgba(255,220,150,${.35 * k})`; ctx.lineWidth = 16 * k; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 5 * k; ctx.stroke();
  }
}

/* ---------- loop (single rAF) ---------- */
function update(dt) {
  g.wave -= dt; if (g.wave <= 0 && fruits.length < 12) spawnWave();
  for (const f of fruits) {
    f.vy += G * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.rs * dt;
    if (!f.isSliced && f.vy > 0 && f.y - f.r > LH) { f.isSliced = true; f.gone = 1; if (f.type !== 'bomb') { loseLife(); g.combo = 0; beep(150, .2, 'square', .1); } }
  }
  fruits = fruits.filter(f => !f.isSliced);
  for (const h of halves) { h.vy += G * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.rs * dt; h.life -= dt; }
  halves = halves.filter(h => h.life > 0 && h.y < LH + 150);
  for (const p of parts) { p.vy += G * .6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.t += dt; }
  parts = parts.filter(p => p.t < p.life);
  for (const p of pops) { p.t -= dt; p.y -= 40 * dt; } pops = pops.filter(p => p.t > 0);
  shake = Math.max(0, shake - dt); g.flash = Math.max(0, g.flash - dt); g.banner = Math.max(0, g.banner - dt);
  if (performance.now() - g.comboT > 1000) g.combo = 0;
}
function render(now) {
  ctx.save();
  if (shake > 0 && state === S.PLAYING) ctx.translate(rnd(-8, 8) * shake * 2, rnd(-8, 8) * shake * 2);
  ctx.drawImage(bg, Math.sin(now / 4000) * 3 - 3, 0);
  if (state === S.PLAYING || state === S.PAUSED || state === S.OVER) {
    for (const h of halves) drawHalf(h);
    for (const f of fruits) drawFruit(f);
    for (const p of parts) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.3); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (state === S.PLAYING) drawTrail(now);
    drawHUD();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of pops) { ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = p.big ? '#ffd84a' : '#fff'; ctx.font = (p.big ? 56 : 28) + 'px Impact,sans-serif'; ctx.fillText(p.s, p.x, p.y); }
    ctx.globalAlpha = 1;
    if (g.banner > 0) { ctx.globalAlpha = Math.min(1, g.banner); ctx.fillStyle = '#ffb347'; ctx.font = '72px Impact,sans-serif'; ctx.fillText('LEVEL ' + g.level, W / 2, LH * .45); ctx.globalAlpha = 1; }
    if (g.flash > 0) { ctx.fillStyle = `rgba(255,200,100,${g.flash})`; ctx.fillRect(0, 0, W, LH); }
  } else drawMenuFruit(now);
  ctx.restore();
}
function loop(now) {
  const dt = Math.min((now - lastT) / 1000, .05); lastT = now;
  if (state === S.PLAYING) update(dt);
  render(now);
  requestAnimationFrame(loop);
}
function boot() {
  if (running) return; running = true;
  newGame(null); resize(); refreshMenu(); show('menu');
  requestAnimationFrame(t => { lastT = t; loop(t); });
}
boot();
setInterval(() => state === S.PLAYING && persist(), 5000);