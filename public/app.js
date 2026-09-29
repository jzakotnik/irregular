(() => {
'use strict';

/* ---------- Helfer ---------- */
const $ = (s, r = document) => r.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Daten ---------- */
const { P, shuffle } = window.Verbs;
const LEVELS = [
  { name:'Aufwärmen',       lanes:['same','iau','ought'], deck:14, fall:8.6, max:2, gap:.42 },
  { name:'Die -en-Gruppe',  lanes:['oen','ioi','ewn'],    deck:14, fall:7.8, max:2, gap:.40 },
  { name:'Zwillinge',       lanes:['bb','aba','en'],      deck:14, fall:7.2, max:2, gap:.38 },
  { name:'Boss-Mix',        mix:4,                        deck:20, fall:6.4, max:3, gap:.34 }
];
const LANE_HEX = ['#FF5C9E','#FFC533','#2FD9C4','#7C8CFF'];
const LANE_VAR = ['var(--c0)','var(--c1)','var(--c2)','var(--c3)'];
const TRIOS = [['sing','sang','sung'],['swim','swam','swum'],['drink','drank','drunk'],['begin','began','begun'],['ring','rang','rung'],['sink','sank','sunk']];

/* ---------- Speicher ---------- */
const KEY = 'verbdrop.v1';
let save = { stars:[0,0,0,0], best:[0,0,0,0], sound:true, speak:false, miss:{} };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') save = Object.assign(save, o); }
} catch(e) {}
function persist(){ try { localStorage.setItem(KEY, JSON.stringify(save)); } catch(e) {} }

/* ---------- Audio ---------- */
let AC = null;
function ac(){
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
  if (AC && AC.state === 'suspended') { try { AC.resume(); } catch(e) {} }
  return AC;
}
function tone(f, d = .12, type = 'triangle', vol = .12, at = 0){
  if (!save.sound) return;
  const a = ac(); if (!a) return;
  try {
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + .03);
  } catch(e) {}
}
const sfx = {
  good(s){ const b = 520 * Math.pow(1.0595, Math.min(s, 12)); tone(b, .09, 'triangle', .15); tone(b * 1.5, .15, 'triangle', .12, .07); },
  bad(){ tone(170, .25, 'sawtooth', .08); tone(125, .3, 'sawtooth', .07, .1); },
  win(){ [523,659,784,1047].forEach((f,i) => tone(f, .22, 'triangle', .14, i * .11)); },
  lose(){ [392,330,262,196].forEach((f,i) => tone(f, .24, 'square', .06, i * .15)); },
  tap(){ tone(720, .05, 'sine', .08); }
};
['pointerup','touchend','click'].forEach(ev => document.addEventListener(ev, () => { if (save.sound) ac(); }, { passive:true }));
function say(text){
  try {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB'; u.rate = .9;
    speechSynthesis.speak(u);
  } catch(e) {}
}

/* ---------- Bildschirme ---------- */
const screens = ['home','menu','intro','game','result','cheat','vsEntry','vsLobby','vsGame','vsResult'];
function show(id){
  screens.forEach(s => $('#' + s).classList.toggle('on', s === id));
  if (id !== 'game') { try { speechSynthesis.cancel(); } catch(e) {} }
}

/* ---------- Menü ---------- */
let trioN = 0;
function hlDiff(t, i){
  let idx = 0; const len = Math.min(...t.map(w => w.length));
  while (idx < len && t.every(w => w[idx] === t[0][idx])) idx++;
  const w = t[i];
  return idx < w.length ? w.slice(0, idx) + '<u>' + w[idx] + '</u>' + w.slice(idx + 1) : w;
}
function paintTrio(){
  const t = TRIOS[trioN++ % TRIOS.length];
  $('#trio').innerHTML = t.map((w, i) =>
    `<b class="hchip" style="--r:${[-4,2,-3][i]}deg;animation-delay:${i * 110}ms">${hlDiff(t, i)}</b>`).join('');
}
setInterval(() => { if ($('#home').classList.contains('on')) paintTrio(); }, 3000);

function unlocked(i){ return i === 0 || save.stars[i - 1] >= 1; }
function renderLevels(){
  $('#levels').innerHTML = LEVELS.map((L, i) => {
    const open = unlocked(i);
    const lanes = L.mix
      ? `<span class="lvl-sub">${L.mix} Boxen, zufällig aus allen Mustern</span>`
      : L.lanes.map((k, j) => `<i class="pill" style="--lc:${LANE_VAR[j]}">${P[k].label}</i>`).join('');
    const st = [0,1,2].map(n => n < save.stars[i] ? '★' : '<span class="e">★</span>').join('');
    const rec = save.best[i] ? `<span class="lvl-sub">Rekord ${save.best[i]}</span>` : '';
    return `<button class="lvl" data-i="${i}" ${open ? '' : 'disabled'}>
      <span class="lvl-num">${open ? i + 1 : '&#128274;'}</span>
      <span class="lvl-main"><span class="lvl-name">${L.name}</span><span class="lvl-lanes">${lanes}</span>${rec}</span>
      <span class="lvl-stars" aria-label="${save.stars[i]} von 3 Sternen">${st}</span>
    </button>`;
  }).join('');
}
function renderToggles(){
  $('#btnSound').textContent = 'Ton: ' + (save.sound ? 'an' : 'aus');
  $('#btnSpeak').textContent = 'Vorlesen: ' + (save.speak ? 'an' : 'aus');
}
function goMenu(){ renderLevels(); show('menu'); }
function goHome(){ renderToggles(); show('home'); paintTrio(); }

$('#levels').addEventListener('click', e => {
  const b = e.target.closest('.lvl'); if (!b || b.disabled) return;
  sfx.tap(); openIntro(+b.dataset.i);
});
$('#btnSound').addEventListener('click', () => { save.sound = !save.sound; persist(); renderToggles(); if (save.sound) sfx.tap(); });
$('#btnSpeak').addEventListener('click', () => { save.speak = !save.speak; persist(); renderToggles(); if (save.speak) say('Hello!'); });
let resetArmed = 0;
$('#btnReset').addEventListener('click', e => {
  const b = e.currentTarget;
  if (!resetArmed) {
    resetArmed = setTimeout(() => { resetArmed = 0; b.textContent = 'Fortschritt zurücksetzen'; }, 3500);
    b.textContent = 'Wirklich alles löschen? Nochmal tippen.';
  } else {
    clearTimeout(resetArmed); resetArmed = 0; b.textContent = 'Fortschritt zurücksetzen';
    save.stars = [0,0,0,0]; save.best = [0,0,0,0]; save.miss = {}; persist(); renderLevels();
  }
});

/* ---------- Spickzettel ---------- */
function renderCheat(){
  $('#cheatList').innerHTML = Object.keys(P).map(k => `
    <div class="cg">
      <div class="cg-h"><span class="pl">${P[k].label}</span><b>${P[k].name}</b></div>
      <p>${P[k].tip}</p>
      <div class="cg-v">${P[k].verbs.map(x =>
        `<button class="vb${save.miss[x[0]] ? ' hard' : ''}" data-say="${x.join(', ')}">${x[0]} – ${x[1]} – ${x[2]}</button>`).join('')}
      </div>
    </div>`).join('');
}
$('#btnCheat').addEventListener('click', () => { renderCheat(); show('cheat'); });
$('#cheatBack').addEventListener('click', goHome);
$('#menuBack').addEventListener('click', goHome);
$('#modeSolo').addEventListener('click', () => { sfx.tap(); goMenu(); });
$('#cheatList').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) say(b.dataset.say); });

/* ---------- Intro ---------- */
let pending = null;
const pickMix = n => window.Verbs.pickGroups(n);
function openIntro(i){
  const L = LEVELS[i];
  const lanes = L.mix ? pickMix(L.mix) : L.lanes.slice();
  pending = { i, lanes };
  $('#introTitle').textContent = `Level ${i + 1}: ${L.name}`;
  $('#introRules').innerHTML = lanes.map((k, j) => `
    <div class="rule" style="--lc:${LANE_VAR[j]}">
      <div class="rl display">${P[k].label}</div>
      <div class="rt"><b>${P[k].name}</b><span class="ex">${P[k].ex}</span><small>${P[k].tip}</small></div>
    </div>`).join('');
  show('intro');
  $('#introRules').parentElement.scrollTop = 0;
}
$('#introBack').addEventListener('click', goMenu);
$('#introGo').addEventListener('click', () => { if (pending) startGame(pending.i, pending.lanes); });

/* ---------- Spiel ---------- */
const stage = $('#stage'), field = $('#field'), bins = $('#bins');
let G = null, raf = 0, FW = 0, FH = 0, toastT = 0;

function buildDeck(lanes, N){
  const per = Math.ceil(N / lanes.length), out = [];
  lanes.forEach(k => {
    let pool = [];
    while (pool.length < per) pool = pool.concat(shuffle(P[k].verbs.slice()));
    pool.slice(0, per).forEach(x => out.push({ inf:x[0], past:x[1], pp:x[2], pat:k, requeued:false }));
  });
  shuffle(out);
  out.length = Math.min(out.length, N);
  for (let i = 1; i < out.length; i++) {
    if (out[i].inf === out[i - 1].inf) { const j = (i + 2) % out.length; [out[i], out[j]] = [out[j], out[i]]; }
  }
  return out;
}

function startGame(i, lanes){
  const L = LEVELS[i];
  G = { i, L, lanes, chips:[], deck:buildDeck(lanes, L.deck), hearts:3, score:0, streak:0, bestStreak:0, mult:1,
        done:0, total:0, mistakes:0, attempts:0, missed:[], paused:false, ended:false, spawnCd:1.2, lastT:0, front:null };
  G.total = G.deck.length;
  $('#pauseOv').classList.remove('on');
  show('game');
  buildStage();
  hud(true);
  toast('<div class="tf">Bereit?</div>', 900);
  G.lastT = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function buildStage(){
  const n = G.lanes.length;
  bins.innerHTML = G.lanes.map((k, j) =>
    `<div class="bin" data-j="${j}" style="--lc:${LANE_VAR[j]}" role="button" aria-label="Box ${j + 1}: ${P[k].name}"><b class="display">${P[k].label}</b><small>${P[k].ex.replace(/ – /g, '–')}</small></div>`).join('');
  field.innerHTML = G.lanes.map((k, j) =>
    `<div class="lane-bg" style="left:${j * 100 / n}%;width:${100 / n}%;--lc:${LANE_VAR[j]}"></div>`).join('');
  measure();
}
function measure(){
  const r = field.getBoundingClientRect(); FW = r.width; FH = r.height;
  mainFx.resize();
}
window.addEventListener('resize', () => { if (G && !G.ended) measure(); });

function hud(initial){
  $('#score').textContent = G.score;
  $('#hearts').innerHTML = [0,1,2].map(n => `<span class="h${n >= G.hearts ? ' lost' : ''}">♥&#xFE0E;</span>`).join('');
  $('#progFill').style.width = Math.min(100, Math.round(G.done / G.total * 100)) + '%';
  $('#combo').innerHTML = G.streak >= 2
    ? `${G.streak} in Folge${G.mult > 1 ? ` <b>×${G.mult}</b>` : ''}` : '';
}
function toast(html, ms){
  const t = $('#toast'); t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

function place(c){
  c.el.style.transform = `translate3d(${c.x - c.w / 2}px,${c.y}px,0) rotate(${c.drag ? 0 : c.r}deg) scale(${c.drag ? 1.1 : 1})`;
}
function spawn(){
  const it = G.deck.shift(); if (!it) return;
  const el = document.createElement('div');
  el.className = 'chip'; el.textContent = it.inf;
  field.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  const c = { it, el, w, h, x:FW / 2 + rnd(-22, 22), y:-h - 6, r:rnd(-4, 4), drag:false };
  G.chips.push(c); place(c);
}
function lowest(){
  let b = null; G.chips.forEach(c => { if (!b || c.y > b.y) b = c; }); return b;
}

function tick(t){
  if (!G || G.ended) return;
  raf = requestAnimationFrame(tick);
  const dt = Math.min(.05, (t - G.lastT) / 1000); G.lastT = t;
  if (G.paused) return;
  const fallTime = Math.max(3.6, G.L.fall - G.done * .06);
  const speed = FH / fallTime;
  for (const c of G.chips.slice()) {
    if (c.drag) continue;
    c.y += speed * dt; place(c);
    if (c.y + c.h >= FH) { missChip(c); }
  }
  if (G.ended) return;
  G.spawnCd -= dt;
  const low = lowest();
  if (G.deck.length && G.chips.length < G.L.max && G.spawnCd <= 0 && (!low || low.y > FH * G.L.gap)) {
    spawn(); G.spawnCd = .8;
  }
  const f = lowest();
  if (f !== G.front) {
    if (G.front) G.front.el.classList.remove('front');
    if (f) f.el.classList.add('front');
    G.front = f;
  }
  if (!G.deck.length && !G.chips.length) endGame(true);
}

function binEl(j){ return bins.children[j]; }
function flash(el, cls, ms){ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); }

function record(c){
  const it = c.it;
  save.miss[it.inf] = (save.miss[it.inf] || 0) + 1; persist();
  if (!G.missed.some(m => m.inf === it.inf)) G.missed.push(it);
  if (!it.requeued) { it.requeued = true; G.deck.splice(Math.min(3, G.deck.length), 0, it); G.total++; }
}
function loseHeart(){
  G.hearts--; G.streak = 0; G.mult = 1; G.mistakes++; G.attempts++;
  G.spawnCd = Math.max(G.spawnCd, 1.3);
  hud();
}
function reveal(it){
  const cj = G.lanes.indexOf(it.pat);
  toast(`<div class="tf">${it.inf} – ${it.past} – ${it.pp}</div><div class="tn">gehört in <b>${P[it.pat].label}</b></div>`, 2300);
  if (cj >= 0) flash(binEl(cj), 'hint', 1600);
  if (save.speak) say(`${it.inf}, ${it.past}, ${it.pp}`);
}

function sortChip(c, j){
  if (!c || !G || G.ended || G.paused || c.gone) return;
  c.gone = true; c.drag = false;
  G.chips.splice(G.chips.indexOf(c), 1);
  if (G.front === c) G.front = null;
  const right = G.lanes[j] === c.it.pat, n = G.lanes.length, cx = (j + .5) * FW / n;
  const el = c.el; el.classList.remove('front', 'grab');
  el.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1.15), opacity .3s .16s';
  void el.offsetWidth;
  el.style.transform = `translate3d(${cx - c.w / 2}px,${FH - c.h * .5}px,0) scale(.55)`;
  el.style.opacity = '0';
  if (!right) el.classList.add('bad');
  setTimeout(() => el.remove(), 650);

  if (right) {
    G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    G.mult = 1 + Math.min(3, Math.floor(G.streak / 5));
    G.score += 10 * G.mult; G.done++; G.attempts++;
    flash(binEl(j), 'pop', 420);
    burst(cx, FH, LANE_HEX[j], G.streak >= 5 ? 34 : 20);
    const f = document.createElement('div'); f.className = 'float';
    f.textContent = `${c.it.past} – ${c.it.pp}`; f.style.left = cx + 'px'; f.style.top = (FH - 6) + 'px';
    stage.appendChild(f); setTimeout(() => f.remove(), 1000);
    sfx.good(G.streak);
    if (save.speak) say(`${c.it.inf}, ${c.it.past}, ${c.it.pp}`);
    hud();
  } else {
    flash(binEl(j), 'nope', 420);
    sfx.bad(); record(c); loseHeart(); reveal(c.it);
    if (G.hearts <= 0) endGame(false);
  }
}
function missChip(c){
  c.gone = true; G.chips.splice(G.chips.indexOf(c), 1);
  if (G.front === c) G.front = null;
  c.el.classList.remove('front'); c.el.classList.add('bad');
  c.el.style.transition = 'opacity .4s'; c.el.style.opacity = '0';
  setTimeout(() => c.el.remove(), 450);
  sfx.bad(); record(c); loseHeart(); reveal(c.it);
  if (G.hearts <= 0) endGame(false);
}
function sortLowest(j){ const c = lowest(); if (c) sortChip(c, j); }

/* Eingabe: Tippen = tiefstes Verb in die Spalte, Ziehen = dieses Verb in die Spalte.
   Wird auch vom 1v1-Modus genutzt. */
function bindInput(cfg){
  const { stage, field, bins } = cfg;
  let drag = null;
  const laneAt = x => {
    const r = field.getBoundingClientRect(), n = cfg.laneCount();
    return Math.max(0, Math.min(n - 1, Math.floor((x - r.left) / (r.width / n))));
  };
  const clearHot = () => {
    [...field.children].forEach(b => b.classList.remove('hot'));
    [...bins.children].forEach(b => b.classList.remove('hot'));
  };
  stage.addEventListener('pointerdown', e => {
    if (!cfg.live()) return;
    const el = e.target.closest('.chip');
    drag = { c:el ? cfg.chipFor(el) : null, sx:e.clientX, sy:e.clientY, moved:false };
    try { stage.setPointerCapture(e.pointerId); } catch(_) {}
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10) {
      drag.moved = true;
      if (drag.c) { drag.c.drag = true; drag.c.el.classList.add('grab'); }
    }
    if (drag.moved) {
      const j = laneAt(e.clientX);
      [...field.children].forEach((b, k) => b.classList.toggle('hot', k === j));
      [...bins.children].forEach((b, k) => b.classList.toggle('hot', k === j));
      if (drag.c && !drag.c.gone) {
        const r = field.getBoundingClientRect(), c = drag.c, FH = cfg.height();
        c.x = e.clientX - r.left;
        c.y = Math.max(-c.h, Math.min(FH - c.h * .6, e.clientY - r.top - c.h / 2));
        place(c);
      }
    }
  });
  function end(e, cancel){
    if (!drag) return;
    const d = drag; drag = null;
    clearHot();
    if (!cfg.live()) return;
    if (d.c) { d.c.drag = false; d.c.el.classList.remove('grab'); if (!d.c.gone) place(d.c); }
    if (cancel) return;
    const j = laneAt(e.clientX);
    if (d.moved && d.c) cfg.sort(d.c, j); else cfg.sortLowest(j);
  }
  stage.addEventListener('pointerup', e => end(e, false));
  stage.addEventListener('pointercancel', e => end(e, true));
}
bindInput({
  stage, field, bins,
  live: () => G && !G.ended && !G.paused,
  chipFor: el => G.chips.find(x => x.el === el),
  laneCount: () => G.lanes.length,
  height: () => FH,
  sort: sortChip,
  sortLowest
});
document.addEventListener('keydown', e => {
  if (!G || G.ended || !$('#game').classList.contains('on')) return;
  if (e.key === 'Escape') { setPause(!G.paused); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= G.lanes.length) sortLowest(n - 1);
});

/* Pause */
function setPause(on){
  if (!G || G.ended) return;
  G.paused = on; $('#pauseOv').classList.toggle('on', on);
  if (!on) G.lastT = performance.now();
}
$('#pauseBtn').addEventListener('click', () => setPause(true));
$('#ovResume').addEventListener('click', () => setPause(false));
$('#ovRestart').addEventListener('click', () => { const g = G; leaveGame(); startGame(g.i, g.lanes); });
$('#ovMenu').addEventListener('click', () => { leaveGame(); goMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.ended && $('#game').classList.contains('on')) setPause(true); });
function leaveGame(){ if (G) { G.ended = true; } cancelAnimationFrame(raf); $('#pauseOv').classList.remove('on'); }

/* Ende */
function endGame(win){
  if (!G || G.ended) return;
  G.ended = true; cancelAnimationFrame(raf);
  const g = G;
  if (win) {
    sfx.win();
    for (let k = 0; k < 5; k++) setTimeout(() => burst(rnd(FW * .15, FW * .85), rnd(FH * .3, FH * .9), LANE_HEX[k % 4], 30), k * 130);
  } else {
    sfx.lose();
    g.chips.forEach(c => { c.el.style.transition = 'opacity .4s'; c.el.style.opacity = '0'; });
  }
  setTimeout(() => showResult(g, win), win ? 1000 : 1200);
}

function showResult(g, win){
  const stars = win ? (g.mistakes === 0 ? 3 : g.mistakes <= 2 ? 2 : 1) : 0;
  const prevBest = save.best[g.i];
  const record = win && g.score > prevBest;
  if (win) {
    save.stars[g.i] = Math.max(save.stars[g.i], stars);
    save.best[g.i] = Math.max(prevBest, g.score);
    persist();
  }
  const acc = g.attempts ? Math.round((g.attempts - g.mistakes) / g.attempts * 100) : 0;
  $('#resTitle').textContent = win ? (stars === 3 ? 'Perfekt!' : 'Geschafft!') : 'Fast!';
  $('#resStars').innerHTML = [0,1,2].map(n =>
    n < stars ? `<span style="animation-delay:${n * 180}ms">★</span>` : '<span class="e">★</span>').join('');
  $('#resLead').textContent = win
    ? (record && prevBest ? 'Neuer Rekord in diesem Level.' : stars === 3 ? 'Kein einziger Fehler. Stark!' : 'Schau dir unten die Verben an, die noch wackeln.')
    : 'Alle Leben sind weg. Schau dir die kniffligen Verben an und versuch es gleich nochmal.';
  $('#resStats').innerHTML =
    `<div class="stat"><b>${g.score}</b><span>Punkte</span></div>` +
    `<div class="stat"><b>${acc}%</b><span>richtig</span></div>` +
    `<div class="stat"><b>${g.bestStreak}</b><span>längste Serie</span></div>`;
  $('#resMissed').innerHTML = g.missed.length
    ? `<h4>Diese Verben üben wir nochmal (tippen zum Anhören):</h4>` +
      g.missed.map(m => `<button class="mv" data-say="${m.inf}, ${m.past}, ${m.pp}"><span>${m.inf} – ${m.past} – ${m.pp}</span><small>${P[m.pat].label}</small></button>`).join('')
    : '';
  const nextOk = win && g.i + 1 < LEVELS.length;
  $('#resActions').innerHTML =
    (nextOk ? `<button class="btn pink" data-a="next">Nächstes Level</button>` : '') +
    `<button class="btn ${nextOk ? 'ghost' : ''}" data-a="again">Nochmal</button>` +
    `<button class="btn ghost" data-a="menu">Menü</button>`;
  show('result'); $('#result').scrollTop = 0;
  window.__last = { i:g.i, lanes:g.lanes };
}
$('#resMissed').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) say(b.dataset.say); });
$('#resActions').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const last = window.__last; sfx.tap();
  if (b.dataset.a === 'menu') goMenu();
  else if (b.dataset.a === 'again') { if (LEVELS[last.i].mix) openIntro(last.i); else startGame(last.i, last.lanes); }
  else if (b.dataset.a === 'next') openIntro(last.i + 1);
});

/* ---------- Konfetti ---------- */
function makeFx(canvas, host){
  const cx = canvas.getContext('2d');
  let parts = [], raf = 0, last = 0;
  function resize(){
    const s = host.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(s.width * d); canvas.height = Math.round(s.height * d);
    cx.setTransform(d, 0, 0, d, 0, 0);
  }
  function burst(x, y, color, n){
    const count = reduceMotion ? Math.ceil(n / 4) : n;
    for (let k = 0; k < count; k++) {
      parts.push({ x, y, vx:rnd(-190, 190), vy:rnd(-520, -120), life:0, ttl:rnd(.7, 1.2), s:rnd(4, 8),
                   c:Math.random() < .3 ? '#FFFDF8' : color, rot:rnd(0, 6.28), vr:rnd(-8, 8), round:Math.random() < .4 });
    }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  function tick(t){
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    const s = host.getBoundingClientRect();
    cx.clearRect(0, 0, s.width, s.height);
    parts = parts.filter(p => (p.life += dt) < p.ttl);
    parts.forEach(p => {
      p.vy += 1100 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      cx.save(); cx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
      cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c;
      if (p.round) { cx.beginPath(); cx.arc(0, 0, p.s / 2, 0, 6.283); cx.fill(); }
      else cx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66);
      cx.restore();
    });
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = 0; cx.clearRect(0, 0, s.width, s.height); }
  }
  return { resize, burst };
}
const mainFx = makeFx($('#fx'), $('#stage'));
const burst = mainFx.burst;

/* ---------- Start ---------- */
goHome();
window.VD = { $, rnd, show, sfx, say, save, persist, P, LANE_HEX, LANE_VAR, place, makeFx, bindInput, goHome, reduceMotion, flash, hlDiff };
})();
