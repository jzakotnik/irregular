'use strict';
/* Verb Drop server: static files + WebSocket rooms for the 1v1 mode.
   All state lives in memory. The server owns lives and decides the winner. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const V = require('./public/verbs.js');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');

const LIVES = 3;
const COUNTDOWN_MS = 3200;   // from "start" message until chip time 0
const GRACE = 1.2;           // s a chip may be answered/reported after it hit the bottom
const ANSWER_EARLY = 0.6;    // s slack for clock drift when answering a just-spawned chip
const MISS_EARLY = 0.4;      // s slack for a client-reported miss
const MAX_ROOMS = 2000;
const ROOM_IDLE_EMPTY_MS = 10 * 60 * 1000;
const ROOM_IDLE_MAX_MS = 2 * 60 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TL = V.timeline(V.DECK_LEN);

/* ---------- static files ---------- */
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.json':'application/json', '.webmanifest':'application/manifest+json'
};
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (_) { res.writeHead(400); return res.end(); }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type':'text/plain' }); return res.end('ok'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type':'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Last-Modified': st.mtime.toUTCString()
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

/* ---------- rooms ---------- */
const rooms = new Map();

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
function newPlayer(ws) { return { token: crypto.randomBytes(12).toString('hex'), ws, left: false }; }
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj) { room.players.forEach(p => p && send(p.ws, obj)); }
function present(room) { return [0, 1].map(i => !!(room.players[i] && room.players[i].ws && !room.players[i].left)); }
function sendLobby(room) { broadcast(room, { t:'lobby', present:present(room) }); }

function startGame(room) {
  const lanes = V.pickGroups(3);
  room.game = {
    startAt: Date.now() + COUNTDOWN_MS,
    lanes,
    deck: V.buildDeck(lanes, V.DECK_LEN),
    N: V.DECK_LEN,
    hearts: [LIVES, LIVES],
    correct: [0, 0],
    streak: [0, 0],
    best: [0, 0],
    handled: [new Set(), new Set()],
    next: [0, 0],
    over: false
  };
  room.phase = 'play';
  room.rematch = [false, false];
  room.players.forEach((p, slot) => p && sendStart(room, slot));
}
function sendStart(room, slot) {
  const g = room.game, p = room.players[slot];
  send(p.ws, {
    t:'start', you:slot, now:Date.now(), startAt:g.startAt, lanes:g.lanes, deck:g.deck,
    hearts:g.hearts, done:[...g.handled[slot]]
  });
}
function sendOver(room, ws) {
  const g = room.game;
  send(ws, { t:'over', winner:g.winner, reason:g.reason, hearts:g.hearts, correct:g.correct, best:g.best });
}
function finish(room, winner, reason) {
  const g = room.game;
  if (!g || g.over) return;
  g.over = true; g.winner = winner; g.reason = reason;
  room.phase = 'over'; room.rematch = [false, false];
  broadcast(room, { t:'over', winner, reason, hearts:g.hearts, correct:g.correct, best:g.best });
}
function checkEnd(room) {
  const g = room.game;
  if (!g || g.over) return;
  const dead = g.hearts.map(h => h <= 0);
  if (dead[0] && dead[1]) finish(room, null, 'lives');
  else if (dead[0]) finish(room, 1, 'lives');
  else if (dead[1]) finish(room, 0, 'lives');
  else if (g.next[0] >= g.N && g.next[1] >= g.N) {
    finish(room, g.hearts[0] === g.hearts[1] ? null : (g.hearts[0] > g.hearts[1] ? 0 : 1), 'deck');
  }
}
function loseLife(room, slot, kind, n) {
  const g = room.game;
  g.hearts[slot]--; g.streak[slot] = 0;
  broadcast(room, { t:'state', hearts:g.hearts, ev:{ who:slot, k:kind, n } });
}
const gameTime = g => (Date.now() - g.startAt) / 1000;

function onAnswer(room, slot, m) {
  const g = room.game;
  if (!g || g.over) return;
  const n = m.n, lane = m.lane;
  if (!Number.isInteger(n) || n < 0 || n >= g.N || !Number.isInteger(lane) || lane < 0 || lane >= g.lanes.length) return;
  if (g.handled[slot].has(n)) return;
  const t = gameTime(g);
  if (t < TL.spawn[n] - ANSWER_EARLY || t > TL.deadline[n] + GRACE) return;
  g.handled[slot].add(n);
  if (Math.floor(g.deck[n] / V.ENTRY_BASE) === lane) {
    g.correct[slot]++; g.streak[slot]++; g.best[slot] = Math.max(g.best[slot], g.streak[slot]);
  } else {
    loseLife(room, slot, 'wrong', n);
  }
  checkEnd(room);
}
function onMiss(room, slot, m) {
  const g = room.game;
  if (!g || g.over) return;
  const n = m.n;
  if (!Number.isInteger(n) || n < 0 || n >= g.N || g.handled[slot].has(n)) return;
  if (gameTime(g) < TL.deadline[n] - MISS_EARLY) return;
  g.handled[slot].add(n);
  loseLife(room, slot, 'miss', n);
  checkEnd(room);
}
/* Chips nobody answered or reported (backgrounded tab, dropped connection) still cost a life. */
function sweep(room) {
  const g = room.game;
  if (!g || g.over) return;
  const t = gameTime(g);
  for (let slot = 0; slot < 2; slot++) {
    while (g.next[slot] < g.N && t >= TL.deadline[g.next[slot]] + GRACE) {
      const n = g.next[slot]++;
      if (!g.handled[slot].has(n)) {
        g.handled[slot].add(n);
        if (g.hearts[slot] > 0) loseLife(room, slot, 'miss', n);
      }
    }
  }
  checkEnd(room);
}
setInterval(() => { rooms.forEach(r => { if (r.phase === 'play') sweep(r); }); }, 250);

/* Housekeeping: drop abandoned rooms */
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r, code) => {
    const anyone = r.players.some(p => p && p.ws && !p.left);
    if (now - r.lastActive > ROOM_IDLE_MAX_MS || (!anyone && now - r.lastActive > ROOM_IDLE_EMPTY_MS)) rooms.delete(code);
  });
}, 30 * 1000);

/* ---------- websocket ---------- */
const wss = new WebSocketServer({ server, path:'/ws', maxPayload:1024 });

function detach(ws) {
  const { room, slot } = ws.ctx;
  ws.ctx = { room:null, slot:-1 };
  if (!room) return;
  const p = room.players[slot];
  if (p && p.ws === ws) {
    p.ws = null;
    const other = room.players[1 - slot];
    if (other) send(other.ws, { t:'opp', connected:false });
    if (room.phase === 'lobby') sendLobby(room);
  }
}
function attach(ws, room, slot) {
  ws.ctx = { room, slot };
  room.players[slot].ws = ws;
  room.lastActive = Date.now();
}
function leaveRoom(ws) {
  const { room, slot } = ws.ctx;
  if (!room) return;
  const p = room.players[slot];
  if (p) p.left = true;
  detach(ws);
  const other = room.players[1 - slot];
  if (room.phase === 'play') finish(room, 1 - slot, 'left');
  if (other) send(other.ws, { t:'oppleft' });
  if (!room.players.some(q => q && !q.left)) rooms.delete(room.code);
}

function handle(ws, m) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'ping') return send(ws, { t:'pong', c:m.c, s:Date.now() });
  const ctx = ws.ctx;
  if (ctx.room) ctx.room.lastActive = Date.now();

  switch (m.t) {
    case 'create': {
      if (ctx.room) leaveRoom(ws);
      if (rooms.size >= MAX_ROOMS) return send(ws, { t:'error', code:'busy', msg:'Gerade zu viel los. Versuch es gleich nochmal.' });
      const room = { code:newCode(), players:[null, null], phase:'lobby', game:null, rematch:[false, false], lastActive:Date.now() };
      room.players[0] = newPlayer(ws);
      rooms.set(room.code, room);
      attach(ws, room, 0);
      send(ws, { t:'joined', code:room.code, you:0, token:room.players[0].token });
      sendLobby(room);
      return;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(code);
      if (!room || room.players[0].left) return send(ws, { t:'error', code:'nf', msg:'Diesen Code gibt es nicht (mehr).' });
      if (room.players[1]) return send(ws, { t:'error', code:'full', msg:'Das Spiel ist schon voll.' });
      if (ctx.room) leaveRoom(ws);
      room.players[1] = newPlayer(ws);
      attach(ws, room, 1);
      send(ws, { t:'joined', code, you:1, token:room.players[1].token });
      sendLobby(room);
      if (room.phase === 'lobby') startGame(room);
      return;
    }
    case 'resume': {
      const room = rooms.get(String(m.code || '').toUpperCase());
      const slot = room ? room.players.findIndex(p => p && p.token === m.token && !p.left) : -1;
      if (slot < 0) return send(ws, { t:'error', code:'gone', msg:'Das Spiel gibt es nicht mehr.' });
      if (ctx.room) detach(ws);
      const old = room.players[slot].ws;
      if (old && old !== ws) { old.ctx = { room:null, slot:-1 }; old.close(); }
      attach(ws, room, slot);
      send(ws, { t:'joined', code:room.code, you:slot, token:m.token, resumed:true });
      const other = room.players[1 - slot];
      if (other) send(other.ws, { t:'opp', connected:true });
      if (room.phase === 'play') { sendStart(room, slot); send(ws, { t:'opp', connected:!!(other && other.ws) }); }
      else if (room.phase === 'over') {
        sendOver(room, ws);
        send(ws, { t:'rematch', ready:room.rematch });
        if (other && other.left) send(ws, { t:'oppleft' });
      } else sendLobby(room);
      return;
    }
    case 'ans': if (ctx.room && ctx.room.phase === 'play') onAnswer(ctx.room, ctx.slot, m); return;
    case 'miss': if (ctx.room && ctx.room.phase === 'play') onMiss(ctx.room, ctx.slot, m); return;
    case 'rematch': {
      const room = ctx.room;
      if (!room || room.phase !== 'over') return;
      const other = room.players[1 - ctx.slot];
      if (!other || other.left) return;
      room.rematch[ctx.slot] = true;
      broadcast(room, { t:'rematch', ready:room.rematch });
      if (room.rematch[0] && room.rematch[1]) startGame(room);
      return;
    }
    case 'leave': leaveRoom(ws); return;
  }
}

wss.on('connection', ws => {
  ws.ctx = { room:null, slot:-1 };
  ws.alive = true;
  ws.tokens = 40; ws.tokenAt = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    const now = Date.now();
    ws.tokens = Math.min(40, ws.tokens + (now - ws.tokenAt) / 50); ws.tokenAt = now;   // 20 msg/s
    if (ws.tokens < 1) return;
    ws.tokens--;
    let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    handle(ws, m);
  });
  ws.on('close', () => detach(ws));
  ws.on('error', () => {});
});
/* Keep connections alive through nginx and drop dead ones */
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) return ws.terminate();
    ws.alive = false; ws.ping();
  });
}, 25 * 1000);

server.listen(PORT, HOST, () => console.log(`Verb Drop listening on http://${HOST}:${PORT}`));
