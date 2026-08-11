# nopoly

A real-time multiplayer property-trading board game for a private friend group.
No player caps, no paywalls, no ads.

Inspired by [richup.io](https://richup.io). Not affiliated with, endorsed by, or
derived from Hasbro's Monopoly — the board layouts, rules, and artwork here are
original.

## Stack

**Client** — React 19, Vite, Tailwind v4, shadcn, Framer Motion, Recharts
**Server** — Node, Express 5, Socket.IO 4

The server is authoritative: every rule lives in `server/game/engine.js`, and
`server/index.js` only wires sockets to it and broadcasts the resulting state.
Clients render what they're told and never compute an outcome themselves.

Game state is held **in memory**. There's no database, so a restart ends any
game in progress and the server cannot run as more than one process.

## Features

- Multiple board layouts (classic and worldwide)
- Property trading, auctions, houses and hotels, jail, bankruptcy
- Reconnect into your seat after a refresh or a dropped connection, with a grace
  period before the table skips you
- Pause, in-game chat, and an event feed
- End-of-game stats with net worth charted over time
- A shared password gate for the whole site

## Running locally

Two terminals:

```bash
cd server && npm install && npm run dev     # :3000
cd client && npm install && npm run dev     # :5173
```

Set `NOPOLY_PASSWORD` to require a password; leave it unset and the server runs
open, which is convenient locally and refused outright in production.

## Deploying

See [`deploy/README.md`](deploy/README.md). One VM runs everything — Node serves
both the API and the built client, with Nginx terminating TLS in front.
