# Verb Drop

Irregular English verbs as a falling-words game for phones.

* **Einzelspiel**: four levels, progress is stored in the browser.
* **1 gegen 1**: two players get the same falling verbs and the same three random verb groups.
  Everyone has 3 lives; whoever loses all of them first loses. After the game both can tap
  "Nochmal spielen" to start a new round with the same room.

## Run

    npm install
    npm start                 # http://127.0.0.1:3000  (PORT / HOST env vars)
    npm test                  # end-to-end test of the 1v1 protocol (takes ~40 s)

## Deploy (pm2 + nginx)

    npm ci --omit=dev
    pm2 start ecosystem.config.js
    pm2 save && pm2 startup

Use `deploy/nginx.conf` for `https://irregular.derjure.de`. It forwards `/ws` with the WebSocket upgrade
headers. Run **exactly one** instance: rooms live only in the memory of the Node process, so a restart
ends running games (players see "Das Spiel gibt es nicht mehr").

## How 1v1 works

* One WebSocket at `/ws`. A host creates a room (4-character code) and shares the code or the link
  `/?join=CODE`. When the second player joins, both get a 3 s countdown.
* The server draws 3 non-conflicting verb groups and a 400-entry deck. The timeline (when each verb
  appears and when it hits the floor) is a pure function in `public/verbs.js`, so both clients render
  the same thing from the shared start time (clock offset is measured with pings).
* The server is authoritative: it validates every answer, deducts lives for wrong answers and for verbs
  that hit the floor (also when a player is away or offline), and decides the winner.
* A dropped connection is resumed automatically (token kept in `localStorage`); the game keeps running
  meanwhile, as in any real-time duel.
* Rooms are deleted after 10 min without connected players (2 h maximum).
