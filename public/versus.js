/* 1v1 mode: WebSocket client. The server owns lives and the winner; this file
   renders the shared, deterministic verb timeline and reports answers. */
(() => {
'use strict';
const { $, rnd, show, sfx, say, save, P, LANE_HEX, LANE_VAR, place, makeFx, bindInput, goHome, flash } = window.VD;
const V = window.Verbs;
const TL = V.timeline(V.DECK_LEN);
const SESSION_KEY = 'verbdrop.session.v1';
const SESSION_MAX_AGE = 10 * 60 * 1000;

/* ---------- session (survives reload / app switch) ---------- */
let session = null;
function loadSession(){
  try {
    const o = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (o && o.code && o.token && Date.now() - o.ts < SESSION_MAX_AGE) return o;
  } catch(e) {}
  return null;
}
function saveSession(){ try { if (session) { session.ts = Date.now(); localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } } catch(e) {} }
function clearSession(){ session = null; try { localStorage.removeItem(SESSION_KEY); } catch(e) {} }

/* ---------- connection ---------- */
let ws = null, pending = null, wantOnline = false, backoff = 500, reconnectT = 0, pingT = 0, probeT = 0;
let offset = 0, bestRtt = Infinity, lastMsgAt = 0, connected = false;
let me = 0, phase = 'idle';           // idle | lobby | play | over
let oppOnline = true, oppLeft = false, rematch = [false, false], lastOver = null;
const serverNow = () => Date.now() + offset;

function tx(o){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function flush(){ if (pending && ws && ws.readyState === 1) { tx(pending); pending = null; } }

function connect(){
  wantOnline = true;
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  clearTimeout(reconnectT);
  let sock;
  try { sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
  catch(e) { scheduleReconnect(); return; }
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    backoff = 500; bestRtt = Infinity; connected = true; lastMsgAt = Date.now(); paintConn();
    startPing();
    if (session) tx({ t:'resume', code:session.code, token:session.token });
    else flush();
  };
  sock.onmessage = ev => {
    if (ws !== sock) return;
    lastMsgAt = Date.now();
    let m; try { m = JSON.parse(ev.data); } catch(e) { return; }
    onMsg(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null; connected = false; stopPing(); paintConn();
    if (wantOnline) scheduleReconnect();
  };
  sock.onerror = () => {};
}
function scheduleReconnect(){
  clearTimeout(reconnectT);
  reconnectT = setTimeout(connect, backoff);
  backoff = Math.min(4000, Math.round(backoff * 1.7));
}
function disconnect(){
  wantOnline = false; pending = null;
  clearTimeout(reconnectT); stopPing();
  if (ws) { const s = ws; ws = null; try { s.close(); } catch(e) {} }
  connected = false;
}
function submit(msg){
  clearSession();
  pending = msg;
  if (ws && ws.readyState === 1) { wantOnline = true; flush(); } else connect();
}

/* clock sync: keep the offset from the lowest-latency sample */
function ping(){ tx({ t:'ping', c:performance.now() }); }
function startPing(){ stopPing(); ping(); setTimeout(ping, 200); setTimeout(ping, 500); pingT = setInterval(ping, 10000); }
function stopPing(){ clearInterval(pingT); }
function onPong(m){
  const rtt = performance.now() - m.c;
  if (rtt < 0 || rtt > 4000) return;
  if (rtt <= bestRtt * 1.3 + 5) { bestRtt = Math.min(bestRtt, rtt); offset = m.s + rtt / 2 - Date.now(); }
}
/* Phones often keep a dead socket open after the app was in the background */
function probe(){
  if (!wantOnline) return;
  if (!ws || ws.readyState > 1) { clearTimeout(reconnectT); connect(); return; }
  const before = lastMsgAt;
  ping();
  clearTimeout(probeT);
  probeT = setTimeout(() => { if (lastMsgAt === before && ws) { try { ws.close(); } catch(e) {} } }, 2500);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) probe(); });
window.addEventListener('online', probe);

function paintConn(){ $('#vConn').classList.toggle('on', !connected && phase === 'play'); }

/* ---------- messages ---------- */
function onMsg(m){
  switch (m.t) {
    case 'pong': onPong(m); break;
    case 'joined': session = { code:m.code, token:m.token }; saveSession(); me = m.you; break;
    case 'lobby': onLobby(m); break;
    case 'start': onStart(m); break;
    case 'state': onState(m); break;
    case 'over': onOver(m); break;
    case 'opp': setOpp(m.connected); break;
    case 'oppleft': oppLeft = true; paintResult(); break;
    case 'rematch': rematch = m.ready; paintResult(); break;
    case 'error': onError(m); break;
  }
  if (session) saveSession();
}
function onError(m){
  const resumeFailed = m.code === 'gone';
  clearSession();
  if (resumeFailed && pending) { flush(); return; }
  if (resumeFailed && phase === 'idle') { disconnect(); return; }   // silent auto-resume failed
  disconnect();
  leaveState();
  openEntry(m.msg, true);
}

/* ---------- entry / lobby ---------- */
function openEntry(msg, isErr){
  entryMsg(msg || '', isErr);
  show('vsEntry');
}
function entryMsg(text, isErr){
  const e = $('#vsErr'); e.textContent = text || '';
  e.style.color = isErr ? '' : 'var(--ink2)';
}
function leaveState(){
  phase = 'idle'; GM = null; cancelAnimationFrame(raf); raf = 0;
  oppLeft = false; oppOnline = true; rematch = [false, false]; lastOver = null;
}
function leaveVersus(){
  tx({ t:'leave' });
  clearSession(); disconnect(); leaveState();
  goHome();
}
$('#modeVs').addEventListener('click', () => { sfx.tap(); openEntry(''); });
$('#vsBack').addEventListener('click', goHome);
$('#lobbyBack').addEventListener('click', leaveVersus);
$('#btnVsEnd').addEventListener('click', leaveVersus);
$('#btnCreate').addEventListener('click', () => { sfx.tap(); entryMsg('Erstelle Spiel …'); submit({ t:'create' }); });
$('#joinForm').addEventListener('submit', e => { e.preventDefault(); joinWith($('#joinCode').value); });
$('#joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
function joinWith(raw){
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { entryMsg('Der Code hat 4 Zeichen.', true); return; }
  sfx.tap(); entryMsg('Trete bei …'); submit({ t:'join', code });
}

function onLobby(m){
  if (phase === 'play' || phase === 'over') return;
  phase = 'lobby';
  if (me !== 0) return;   // the guest goes straight to the countdown
  $('#lobbyCode').textContent = session ? session.code : '';
  $('#lobbyWait').innerHTML = m.present[1] ? 'Gegner ist da!' : 'Warte auf Gegner<span class="dots"></span>';
  show('vsLobby');
}
function shareUrl(){ return location.origin + '/?join=' + (session ? session.code : ''); }
$('#btnShare').addEventListener('click', () => {
  if (!session) return;
  const text = `Spiel mit mir Verb Drop! Code: ${session.code}`;
  if (navigator.share) navigator.share({ title:'Verb Drop', text, url:shareUrl() }).catch(() => {});
  else copyText(shareUrl(), $('#btnShare'), 'Link teilen');
});
$('#btnCopy').addEventListener('click', () => { if (session) copyText(session.code, $('#btnCopy'), 'Code kopieren'); });
function copyText(text, btn, label){
  const done = () => { btn.textContent = 'Kopiert!'; setTimeout(() => { btn.textContent = label; }, 1500); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => {});
  else {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch(e) {}
    t.remove();
  }
}

/* ---------- game ---------- */
const stage = $('#vStage'), field = $('#vField'), bins = $('#vBins');
const fx = makeFx($('#vFx'), stage);
let GM = null, raf = 0, FW = 0, FH = 0, toastT = 0, cdShown = 0;

function hearts(el, n, prev){
  el.innerHTML = [0, 1, 2].map(i =>
    `<span class="h${i >= n ? ' lost' : ''}${i >= n && !(prev !== undefined && i < prev) ? ' old' : ''}">♥&#xFE0E;</span>`).join('');
}
function paintHearts(prevMe, prevOpp){
  hearts($('#vMe'), GM.hearts[me], prevMe);
  hearts($('#vOpp'), GM.hearts[1 - me], prevOpp);
}
function paintCombo(){
  $('#vCombo').textContent = GM && GM.streak >= 2 ? `${GM.streak} in Folge` : '';
}
function setOpp(on){
  oppOnline = on;
  $('.who.opp').classList.toggle('off', !on);
}
function toast(html, ms){
  const t = $('#vToast'); t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function measure(){
  const r = field.getBoundingClientRect(); FW = r.width; FH = r.height;
  fx.resize();
}
window.addEventListener('resize', () => { if (GM && !GM.over) measure(); });

function buildStage(){
  const n = GM.lanes.length;
  bins.innerHTML = GM.lanes.map((k, j) =>
    `<div class="bin" data-j="${j}" style="--lc:${LANE_VAR[j]}" role="button" aria-label="Box ${j + 1}: ${P[k].name}"><b class="display">${P[k].label}</b><small>${P[k].ex.replace(/ – /g, '–')}</small></div>`).join('');
  field.innerHTML = GM.lanes.map((k, j) =>
    `<div class="lane-bg" style="left:${j * 100 / n}%;width:${100 / n}%;--lc:${LANE_VAR[j]}"></div>`).join('');
  $('#vRules').innerHTML = GM.lanes.map((k, j) =>
    `<div class="cd-rule" style="--lc:${LANE_VAR[j]}"><i>${P[k].label}</i><span><b>${P[k].name}</b><br>${P[k].ex}</span></div>`).join('');
  measure();
}

function onStart(m){
  me = m.you; phase = 'play';
  if (m.now && bestRtt === Infinity) offset = m.now - Date.now();
  rematch = [false, false]; oppLeft = false;
  const same = GM && GM.startAt === m.startAt;
  if (same) {
    const prevMe = GM.hearts[me], prevOpp = GM.hearts[1 - me];
    GM.hearts = m.hearts.slice();
    m.done.forEach(n => GM.done.add(n));
    paintHearts(prevMe, prevOpp);
  } else {
    GM = { startAt:m.startAt, lanes:m.lanes, deck:m.deck, hearts:m.hearts.slice(), chips:new Map(), done:new Set(m.done),
           next:0, streak:0, best:0, missed:[], over:false, started:false };
    cdShown = 0;
    $('#vToast').classList.remove('show');
    show('vsGame');
    buildStage();
    paintHearts(); paintCombo();
    $('.who.opp').classList.toggle('off', !oppOnline);
    $('#vCount').classList.add('on');
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  }
  if (!$('#vsGame').classList.contains('on')) { show('vsGame'); measure(); }
  paintConn();
}

function spawnChip(n){
  const it = V.entry(GM.lanes, GM.deck[n]);
  const el = document.createElement('div');
  el.className = 'chip'; el.textContent = it.inf;
  field.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  const c = { n, it, el, w, h, x:FW / 2 + rnd(-22, 22), y:-h - 6, r:rnd(-4, 4), drag:false, gone:false };
  GM.chips.set(n, c); place(c);
}
function lowest(){
  let b = null; GM.chips.forEach(c => { if (!b || c.y > b.y) b = c; }); return b;
}
function noteMissed(it){ if (!GM.missed.some(x => x.inf === it.inf)) GM.missed.push(it); }

function tick(){
  if (!GM || GM.over) { raf = 0; return; }
  raf = requestAnimationFrame(tick);
  const t = (serverNow() - GM.startAt) / 1000;
  if (t < 0) {
    const d = Math.min(3, Math.ceil(-t));
    if (d !== cdShown) { cdShown = d; $('#vCd').textContent = d; sfx.tap(); }
    return;
  }
  if (!GM.started) {
    GM.started = true;
    $('#vCount').classList.remove('on');
    toast('<div class="tf">Los!</div>', 700);
    sfx.good(4);
    measure();
  }
  while (GM.next < V.DECK_LEN && TL.spawn[GM.next] <= t) {
    const n = GM.next++;
    if (GM.done.has(n)) continue;
    if (t >= TL.deadline[n]) {   // fell while we were away; the server already charged it
      GM.done.add(n); noteMissed(V.entry(GM.lanes, GM.deck[n])); continue;
    }
    spawnChip(n);
  }
  for (const c of [...GM.chips.values()]) {
    const pr = (t - TL.spawn[c.n]) / TL.fall[c.n];
    if (pr >= 1) { missChip(c); continue; }
    if (!c.drag) { c.y = -c.h - 6 + pr * (FH + 6); place(c); }
  }
  const f = lowest();
  if (f !== GM.front) {
    if (GM.front) GM.front.el.classList.remove('front');
    if (f) f.el.classList.add('front');
    GM.front = f;
  }
}

function binEl(j){ return bins.children[j]; }
function reveal(it){
  toast(`<div class="tf">${it.inf} – ${it.past} – ${it.pp}</div><div class="tn">gehört in <b>${P[it.pat].label}</b></div>`, 2000);
  const cj = GM.lanes.indexOf(it.pat);
  if (cj >= 0) flash(binEl(cj), 'hint', 1600);
  if (save.speak) say(`${it.inf}, ${it.past}, ${it.pp}`);
}
function loseLocal(){
  const prev = GM.hearts[me];
  GM.hearts[me] = Math.max(0, prev - 1); GM.streak = 0;
  hearts($('#vMe'), GM.hearts[me], prev); paintCombo();
}
function retire(c){
  c.gone = true; c.drag = false;
  GM.chips.delete(c.n); GM.done.add(c.n);
  if (GM.front === c) GM.front = null;
  c.el.classList.remove('front', 'grab');
}

function sortChip(c, j){
  if (!c || !GM || GM.over || c.gone) return;
  retire(c);
  const ok = c.it.lane === j, n = GM.lanes.length, cx = (j + .5) * FW / n, el = c.el;
  tx({ t:'ans', n:c.n, lane:j });
  el.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1.15), opacity .3s .16s';
  void el.offsetWidth;
  el.style.transform = `translate3d(${cx - c.w / 2}px,${FH - c.h * .5}px,0) scale(.55)`;
  el.style.opacity = '0';
  if (!ok) el.classList.add('bad');
  setTimeout(() => el.remove(), 650);
  if (ok) {
    GM.streak++; GM.best = Math.max(GM.best, GM.streak);
    flash(binEl(j), 'pop', 420);
    fx.burst(cx, FH, LANE_HEX[j], GM.streak >= 5 ? 34 : 20);
    const f = document.createElement('div'); f.className = 'float';
    f.textContent = `${c.it.past} – ${c.it.pp}`; f.style.left = cx + 'px'; f.style.top = (FH - 6) + 'px';
    stage.appendChild(f); setTimeout(() => f.remove(), 1000);
    sfx.good(GM.streak);
    if (save.speak) say(`${c.it.inf}, ${c.it.past}, ${c.it.pp}`);
    paintCombo();
  } else {
    flash(binEl(j), 'nope', 420);
    sfx.bad(); noteMissed(c.it); loseLocal(); reveal(c.it);
  }
}
function missChip(c){
  retire(c);
  tx({ t:'miss', n:c.n });
  c.el.classList.add('bad');
  c.el.style.transition = 'opacity .4s'; c.el.style.opacity = '0';
  setTimeout(() => c.el.remove(), 450);
  sfx.bad(); noteMissed(c.it); loseLocal(); reveal(c.it);
}
function sortLowest(j){ const c = lowest(); if (c) sortChip(c, j); }

bindInput({
  stage, field, bins,
  live: () => GM && !GM.over && GM.started,
  chipFor: el => { for (const c of GM.chips.values()) if (c.el === el) return c; return null; },
  laneCount: () => GM.lanes.length,
  height: () => FH,
  sort: sortChip,
  sortLowest
});
document.addEventListener('keydown', e => {
  if (!GM || GM.over || !GM.started || !$('#vsGame').classList.contains('on')) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= GM.lanes.length) sortLowest(n - 1);
});

function onState(m){
  if (!GM) return;
  const oi = 1 - me, prevMe = GM.hearts[me], prevOpp = GM.hearts[oi];
  const mine = Math.min(prevMe, m.hearts[me]);
  GM.hearts[me] = mine; GM.hearts[oi] = m.hearts[oi];
  paintHearts(prevMe, prevOpp);
  const ev = m.ev;
  if (ev && ev.who === oi && GM.hearts[oi] < prevOpp) {
    const w = $('.who.opp'); w.classList.remove('hit'); void w.offsetWidth; w.classList.add('hit');
    sfx.good(2);
    toast(`<div class="tf">Gegner: −1 ♥</div><div class="tn">noch ${GM.hearts[oi]} von 3</div>`, 1400);
  } else if (ev && ev.who === me && mine < prevMe) {
    sfx.bad();   // charged by the server while we were not looking (e.g. background tab)
  }
}

/* ---------- end ---------- */
function onOver(m){
  lastOver = m; phase = 'over';
  if (GM && !GM.over) {
    GM.over = true; cancelAnimationFrame(raf); raf = 0;
    const prevMe = GM.hearts[me], prevOpp = GM.hearts[1 - me];
    GM.hearts = m.hearts.slice(); paintHearts(prevMe, prevOpp);
    const won = m.winner === me;
    if (won) {
      sfx.win();
      for (let k = 0; k < 5; k++) setTimeout(() => fx.burst(rnd(FW * .15, FW * .85), rnd(FH * .3, FH * .9), LANE_HEX[k % 3], 30), k * 130);
    } else {
      sfx.lose();
      GM.chips.forEach(c => { c.el.style.transition = 'opacity .4s'; c.el.style.opacity = '0'; });
    }
    setTimeout(() => { if (phase === 'over') showResult(); }, won ? 1100 : 1300);
  } else if (!GM || $('#vsResult').classList.contains('on')) {
    showResult();
  }
}
function heartRow(n){
  return [0, 1, 2].map(i => `<span class="${i >= n ? 'lost' : ''}">♥&#xFE0E;</span>`).join('');
}
function showResult(){
  const m = lastOver; if (!m) return;
  const win = m.winner === me, draw = m.winner === null;
  $('#vrTitle').textContent = draw ? 'Unentschieden' : win ? 'Gewonnen!' : 'Verloren';
  $('#vrLead').textContent = draw ? 'Ihr habt gleichzeitig das letzte Leben verloren.'
    : m.reason === 'left' ? 'Dein Gegner hat das Spiel verlassen.'
    : m.reason === 'deck' ? 'Alle Verben sind durch. Die meisten Leben zählen.'
    : win ? 'Dein Gegner hat alle Leben verloren.' : 'Alle deine Leben sind weg. Da geht noch was!';
  const card = (who, i) => `<div class="stat${m.winner === i ? ' win' : ''}"><h5>${who}</h5><span class="hr">${heartRow(m.hearts[i])}</span>` +
    `<b>${m.correct[i]}</b><span>richtig</span></div>`;
  $('#vrDuel').innerHTML = card('Du', me) + card('Gegner', 1 - me);
  const missed = GM ? GM.missed : [];
  $('#vrMissed').innerHTML = missed.length
    ? `<h4>Diese Verben üben wir nochmal (tippen zum Anhören):</h4>` +
      missed.map(x => `<button class="mv" data-say="${x.inf}, ${x.past}, ${x.pp}"><span>${x.inf} – ${x.past} – ${x.pp}</span><small>${P[x.pat].label}</small></button>`).join('')
    : '';
  show('vsResult'); $('#vsResult').scrollTop = 0;
  paintResult();
}
function paintResult(){
  const b = $('#btnRematch'), s = $('#vrStatus');
  if (!lastOver) return;
  const oi = 1 - me;
  b.disabled = false; b.textContent = 'Nochmal spielen';
  s.textContent = '';
  if (oppLeft) { b.disabled = true; s.textContent = 'Dein Gegner hat das Spiel verlassen.'; }
  else if (rematch[me]) { b.disabled = true; b.textContent = 'Warte auf Gegner …'; s.textContent = oppOnline ? '' : 'Dein Gegner ist gerade offline.'; }
  else if (rematch[oi]) s.textContent = 'Dein Gegner will nochmal! Tippe auf „Nochmal spielen“.';
  else if (!oppOnline) s.textContent = 'Dein Gegner ist gerade offline.';
}
$('#btnRematch').addEventListener('click', () => {
  if (phase !== 'over' || oppLeft) return;
  sfx.tap(); rematch[me] = true; paintResult(); tx({ t:'rematch' });
});
$('#vrMissed').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) say(b.dataset.say); });

/* ---------- boot ---------- */
(function boot(){
  const jp = new URLSearchParams(location.search).get('join');
  if (jp) {
    try { history.replaceState(null, '', location.pathname); } catch(e) {}
    $('#joinCode').value = jp.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    openEntry('');
    joinWith(jp);
    return;
  }
  session = loadSession();
  if (session) connect();   // reloaded mid-game: pick the room back up
})();
})();
