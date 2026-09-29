/* Verb data plus the deterministic deck/timeline used by the 1v1 mode.
   Loaded by the browser (window.Verbs) and by the server (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Verbs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const v = s => s.trim().split(/\s+/).map(x => x.split('-'));
  const P = {
    same:  { label:'A · A · A',  name:'Alle drei gleich',       ex:'cut – cut – cut',
             tip:'Infinitiv, Simple Past und Past Participle sehen genau gleich aus.',
             verbs:v('cut-cut-cut put-put-put hit-hit-hit let-let-let set-set-set hurt-hurt-hurt cost-cost-cost shut-shut-shut') },
    iau:   { label:'i · a · u',  name:'i – a – u',              ex:'sing – sang – sung',
             tip:'Der Vokal wandert: erst i, dann a, dann u.',
             verbs:v('sing-sang-sung swim-swam-swum drink-drank-drunk begin-began-begun ring-rang-rung sink-sank-sunk spring-sprang-sprung') },
    ought: { label:'…ought',     name:'ought / aught',          ex:'buy – bought – bought',
             tip:'Past und Participle sind gleich und enden auf -ought oder -aught.',
             verbs:v('buy-bought-bought bring-brought-brought think-thought-thought catch-caught-caught teach-taught-taught fight-fought-fought') },
    oen:   { label:'o · o-en',   name:'o und -en',              ex:'speak – spoke – spoken',
             tip:'Simple Past mit o, Participle mit o und -en am Ende.',
             verbs:v('speak-spoke-spoken break-broke-broken choose-chose-chosen steal-stole-stolen freeze-froze-frozen wake-woke-woken') },
    ioi:   { label:'i-en',       name:'3. Form mit i + en',     ex:'write – wrote – written',
             tip:'Das Participle hat ein i vor -en: written, ridden, driven, risen, bitten, hidden.',
             verbs:v('write-wrote-written ride-rode-ridden drive-drove-driven rise-rose-risen bite-bit-bitten hide-hid-hidden') },
    ewn:   { label:'ew · n',     name:'-ew und -n',             ex:'know – knew – known',
             tip:'Simple Past endet auf -ew, das Participle auf -n.',
             verbs:v('know-knew-known grow-grew-grown throw-threw-thrown blow-blew-blown fly-flew-flown draw-drew-drawn') },
    bb:    { label:'A · B · B',  name:'Past = Participle',      ex:'make – made – made',
             tip:'Simple Past und Participle sind gleich, nur der Infinitiv ist anders.',
             verbs:v('make-made-made feel-felt-felt keep-kept-kept sleep-slept-slept meet-met-met send-sent-sent build-built-built sell-sold-sold tell-told-told find-found-found hold-held-held lose-lost-lost win-won-won sit-sat-sat stand-stood-stood leave-left-left') },
    aba:   { label:'A · B · A',  name:'Infinitiv = Participle', ex:'come – came – come',
             tip:'Nur das Simple Past ist anders. Infinitiv und Participle sind gleich.',
             verbs:v('come-came-come become-became-become run-ran-run overcome-overcame-overcome') },
    en:    { label:'+ en',       name:'Infinitiv + en',         ex:'eat – ate – eaten',
             tip:'Das Participle ist der Infinitiv mit -en oder -n am Ende.',
             verbs:v('eat-ate-eaten take-took-taken see-saw-seen fall-fell-fallen shake-shook-shaken beat-beat-beaten') }
  };
  /* Patterns that would be ambiguous when mixed in one round */
  const CONFLICT = [['ought','bb'],['en','oen'],['en','ioi']];

  function shuffle(a, rand) {
    rand = rand || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickGroups(n, rand) {
    const keys = Object.keys(P);
    for (let t = 0; t < 300; t++) {
      const s = shuffle(keys.slice(), rand).slice(0, n);
      if (!CONFLICT.some(([a, b]) => s.includes(a) && s.includes(b))) return s;
    }
    return ['same', 'iau', 'oen', 'aba'].slice(0, n);
  }

  /* ---- 1v1 deck ----
     An entry is lane * ENTRY_BASE + verbIndex (verbIndex into P[lanes[lane]].verbs). */
  const ENTRY_BASE = 64;
  const DECK_LEN = 400;

  function buildDeck(lanes, N, rand) {
    rand = rand || Math.random;
    const pools = lanes.map(() => ({ pool: [], last: -1 }));
    const nextVerb = j => {
      const st = pools[j], size = P[lanes[j]].verbs.length;
      if (!st.pool.length) {
        st.pool = shuffle([...Array(size).keys()], rand);
        if (size > 1 && st.pool[st.pool.length - 1] === st.last) {
          [st.pool[0], st.pool[st.pool.length - 1]] = [st.pool[st.pool.length - 1], st.pool[0]];
        }
      }
      st.last = st.pool.pop();
      return st.last;
    };
    const deck = [];
    while (deck.length < N) {
      shuffle([...Array(lanes.length).keys()], rand).forEach(j => deck.push(j * ENTRY_BASE + nextVerb(j)));
    }
    deck.length = N;
    return deck;
  }

  function entry(lanes, e) {
    const lane = Math.floor(e / ENTRY_BASE), x = P[lanes[lane]].verbs[e % ENTRY_BASE];
    return { inf:x[0], past:x[1], pp:x[2], pat:lanes[lane], lane };
  }

  /* ---- timeline (seconds after the game start) ----
     Chip n appears at spawn[n], hits the bottom at deadline[n] = spawn[n] + fall[n].
     Both grow monotonically, so a server can sweep for missed chips in order. */
  const FIRST_SPAWN = 0.9;
  function timeline(N) {
    const spawn = [], fall = [], deadline = [];
    let t = FIRST_SPAWN;
    for (let n = 0; n < N; n++) {
      spawn.push(t);
      fall.push(Math.max(3.2, 7.4 - n * 0.085));
      deadline.push(t + fall[n]);
      t += Math.max(1.15, 2.4 - n * 0.03);
    }
    return { spawn, fall, deadline };
  }

  return { P, CONFLICT, shuffle, pickGroups, buildDeck, entry, timeline, ENTRY_BASE, DECK_LEN, FIRST_SPAWN };
});
