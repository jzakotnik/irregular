'use strict';
/* End-to-end test against a real server process: node test/e2e.js */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const V = require('../public/verbs.js');

const PORT = 3100 + Math.floor(Math.random() * 500);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };

class Client {
  constructor(name) { this.name = name; this.q = []; this.waiters = []; }
  connect() {
    return new Promise(res => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', res);
      this.ws.on('message', d => {
        const m = JSON.parse(d); this.q.push(m);
        this.waiters = this.waiters.filter(w => { const hit = this.q.find(w.pred); if (hit) { this.q.splice(this.q.indexOf(hit), 1); w.res(hit); return false; } return true; });
      });
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(t, pred = () => true, ms = 20000) {
    const p = m => m.t === t && pred(m);
    const hit = this.q.find(p);
    if (hit) { this.q.splice(this.q.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const w = { pred: p, res }; this.waiters.push(w);
      setTimeout(() => rej(new Error(`${this.name}: timeout waiting for ${t}`)), ms);
    });
  }
  close() { this.ws.close(); }
}
const correctLane = (start, n) => Math.floor(start.deck[n] / V.ENTRY_BASE);

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, HOST: '127.0.0.1' }, stdio: 'inherit' });
  await sleep(600);
  try {
    const A = new Client('A'), B = new Client('B');
    await A.connect(); await B.connect();

    A.send({ t:'create' });
    const ja = await A.wait('joined');
    ok(/^[A-Z2-9]{4}$/.test(ja.code) && ja.you === 0, 'host gets a 4 char code, slot 0');
    await A.wait('lobby', m => !m.present[1]);

    B.send({ t:'join', code:'ZZZZ' });
    ok((await B.wait('error')).code === 'nf', 'unknown code rejected');

    B.send({ t:'join', code:ja.code.toLowerCase() });
    const jb = await B.wait('joined');
    ok(jb.you === 1, 'guest joins with lower-case code');
    const sa = await A.wait('start'), sb = await B.wait('start');
    ok(sa.startAt === sb.startAt && JSON.stringify(sa.deck) === JSON.stringify(sb.deck), 'both get identical deck and start time');
    ok(sa.lanes.length === 3 && new Set(sa.lanes).size === 3, 'three distinct groups: ' + sa.lanes.join(','));
    ok(!V.CONFLICT.some(([x, y]) => sa.lanes.includes(x) && sa.lanes.includes(y)), 'no conflicting groups');
    ok(sa.deck.length === V.DECK_LEN && sa.hearts.join() === '3,3', 'deck length and 3 lives each');
    const cd = sa.startAt - sa.now;
    ok(cd > 2500 && cd < 4000, `countdown ~3s (${cd}ms)`);

    const C = new Client('C'); await C.connect();
    C.send({ t:'join', code:ja.code });
    ok((await C.wait('error')).code === 'full', 'third player rejected');
    C.close();

    // early answer (before the chip exists) is ignored
    A.send({ t:'ans', n:5, lane:0 });
    // wait until chip 0 exists
    await sleep(Math.max(0, sa.startAt - Date.now() + 400));
    // A: wrong answer for chip 0
    const wrong = (correctLane(sa, 0) + 1) % 3;
    A.send({ t:'ans', n:0, lane:wrong });
    const st = await B.wait('state');
    ok(st.hearts[0] === 2 && st.hearts[1] === 3 && st.ev.who === 0, 'opponent is told A lost a life (2 left)');
    ok((await A.wait('state')).hearts[0] === 2, 'A gets the same state');
    A.send({ t:'ans', n:0, lane:wrong });                       // duplicate
    B.send({ t:'ans', n:0, lane:correctLane(sa, 0) });          // correct, no life lost
    A.send({ t:'miss', n:1 });                                  // too early -> ignored
    await sleep(300);
    ok(!A.q.some(m => m.t === 'state') && !B.q.some(m => m.t === 'state'), 'duplicate / early / correct messages change nothing');

    // A loses the remaining lives with wrong answers on chips 1 and 2
    await sleep(Math.max(0, sa.startAt + 2900 - Date.now()));
    A.send({ t:'ans', n:1, lane:(correctLane(sa, 1) + 1) % 3 });
    await sleep(Math.max(0, sa.startAt + 5100 - Date.now()));
    A.send({ t:'ans', n:2, lane:(correctLane(sa, 2) + 1) % 3 });
    const over = await B.wait('over');
    ok(over.winner === 1 && over.reason === 'lives' && over.hearts.join() === '0,3', 'B wins when A hits 0 lives');
    ok(over.correct[1] === 1, 'B has 1 correct answer');
    await A.wait('over');

    // rematch needs both
    A.send({ t:'rematch' });
    ok((await B.wait('rematch')).ready.join() === 'true,false', 'rematch flag broadcast');
    B.send({ t:'rematch' });
    const s2a = await A.wait('start'), s2b = await B.wait('start');
    ok(s2a.startAt > sa.startAt && s2a.hearts.join() === '3,3' && s2b.you === 1, 'rematch starts a fresh game with the same players');

    // reconnect: A answers chip 0 correctly, drops and resumes
    await sleep(Math.max(0, s2a.startAt - Date.now() + 400));
    A.send({ t:'ans', n:0, lane:correctLane(s2a, 0) });
    await sleep(150);
    A.close();
    ok((await B.wait('opp')).connected === false, 'B sees A go offline');
    const A2 = new Client('A2'); await A2.connect();
    A2.send({ t:'resume', code:ja.code, token:ja.token });
    const r = await A2.wait('start');
    ok(r.startAt === s2a.startAt && r.done.includes(0), 'A resumes the running game and keeps its answered chips');
    ok((await B.wait('opp')).connected === true, 'B sees A come back');
    const bad = new Client('bad'); await bad.connect();
    bad.send({ t:'resume', code:ja.code, token:'nope' });
    ok((await bad.wait('error')).code === 'gone', 'resume with wrong token rejected');
    bad.close();

    // nobody answers anything more: the server charges unanswered chips and ends the game
    const over2 = await B.wait('over', () => true, 25000);
    ok(over2.reason === 'lives' && over2.winner === 0 && over2.hearts[1] === 0, 'server sweep ends the game (B never answered) -> A wins');

    // leaving mid game forfeits
    await A2.wait('over');
    A2.send({ t:'rematch' }); B.send({ t:'rematch' });
    await A2.wait('start'); await B.wait('start');
    B.send({ t:'leave' });
    const o3 = await A2.wait('over');
    ok(o3.winner === 0 && o3.reason === 'left', 'leaving forfeits the game');
    await A2.wait('oppleft');
    A2.send({ t:'rematch' });
    await sleep(200);
    ok(!A2.q.some(m => m.t === 'start'), 'no rematch after opponent left');
    A2.close(); B.close();
  } catch (e) { console.error(e); failed++; }
  srv.kill();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
