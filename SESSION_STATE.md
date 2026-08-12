# Nopoly — session handoff

Written at commit `b1692c2`. Working tree clean, `main` in sync with `origin/main`.

Nopoly is a real-time multiplayer Monopoly-style game for a private friend group.
Live at **nopoly.duckdns.org** on a free Oracle Cloud VM.

---

## 1. What has been built

### Stack and shape

| Part | What |
|---|---|
| `client/` | React 19, Vite 8, Tailwind v4, shadcn (Base UI), Framer Motion v13, socket.io-client |
| `server/` | Node, Express 5, Socket.IO 4 |
| `server/game/engine.js` | The authoritative game. ~2000 lines, no framework, plain objects |
| `server/persist.js` | Room snapshots to disk so a redeploy doesn't end everyone's game |
| `server/auth.js` | Single shared password, verified on the socket handshake |

One process serves the API **and** `client/dist`, so there is no cross-origin
config to get wrong.

### Game features

- **Boards** — two (`classic`, `worldwide`), swappable in the lobby.
- **Core Monopoly** — buy, rent, sets, houses/hotels, jail, cards, auctions,
  trades, bankruptcy.
- **Teams (beta)** — 2v2. Shared property and monopolies, separate cash,
  interleaved turns, prompted bailouts when a teammate can't cover a debt.
- **Beta rules** — dynamic property values, auction balance, teams.
- **Vote-kick** — everyone else still in must agree, capped at 4, floored at 2.
- **Abandonment countdown** — a kick called on someone already disconnected
  becomes a 5-minute clock instead of a ballot.
- **Turn clock** — a turn nobody is sitting in front of plays itself after 60s.
- **Spectating** — join a running game, or come back to one you resigned from.
- **Profiles** — up to three initials and a colour, editable from the home
  screen or the lobby, carried between rooms.
- **Presence** — live "N players online · M games" on the home screen and lobby.
- **Live update** — a client polls `/version` and reloads itself after a deploy.
- **Persistence** — rooms survive a server restart.
- **Audio** — full sound set including sounds for what *other* people do, plus
  an optional background pad. Bench at `/sounds.html`.
- **Payment flash** — rent and tax shown large on the board as they happen.
- **Mobile** — the turn's controls live in a bar under the board below `xl`.

### Deploying

```bash
# On the VM, in ~/nopoly
git pull && npm --prefix client run build
sudo systemctl restart nopoly     # ONLY if anything under server/ changed
```

`express.static` reads from disk per request, so a **client-only** change is
live the moment the build finishes — no restart, and open tabs reload
themselves via the live-update poll.

### Things worth knowing about the deployment

- Repo `bba5696/nopoly` is **private**, by deliberate choice.
- The VM authenticates with a **read-only deploy key**. It only ever pulls.
- `/etc/nopoly.env` holds `NOPOLY_PASSWORD`, root-owned, `chmod 600`.
- The unit declares `StateDirectory=nopoly`, which is the only writable path
  under `ProtectSystem=strict` and is where snapshots go.
- The server **refuses to start** in production without `NOPOLY_PASSWORD`. An
  open server on the internet is not a warning-in-a-log situation.

---

## 2. Architectural decisions, and why

### The engine is authoritative and the client is a view

Every rule lives in `server/game/engine.js`. The client mirrors a few
calculations (`client/src/lib/rent.js`) purely so buttons can be hidden before
they'd fail — never as the decision. If the two disagree, the server wins.

### Spectators are kept out of `room.players`

Turn order, net worth, who has won, and what a vote needs are all counted off
that list. Keeping watchers in a separate `room.spectators` makes them harmless
*by construction* rather than by remembering to exclude them in nine places. A
single guard in `act()` refuses everything they send, so an action added later
is refused without anyone thinking about it. Chat is the one deliberate
exception.

### The turn clock measures inactivity, not elapsed time

A flat 60s from the start of the turn would cut off someone reading a trade
offer. It resets on any mouse move, key, scroll or tap, so the only turns it
ever ends are ones nobody is in front of. The ping is throttled to one per 8s
and only sent by the player being timed.

When it fires it plays the **whole** turn at once — roll, decline, hand on —
because a minute per step means three minutes to pass one empty turn. It always
takes the passive option, so it can never spend your money. **A debt is the
exception**: only the player can choose what to sell, so the turn stays theirs.

### Building is turn-gated; selling is not

Deliberate asymmetry. Rent lands on you during *other people's* turns, so you
must be able to sell to clear a debt whenever it happens. Building on someone
else's turn was a real exploit — you could develop a set in the gap between a
rival landing on it and the rent being calculated.

**Note:** turn-gated building is a departure from the paper rules, made at the
user's explicit request.

### Taxes are a share of net worth, capped at the old flat fee

Income Tax 10% (max $200), Luxury Tax 5% (max $100). The cap guarantees this is
only ever a discount — the ask was to *nerf* them. Uncapped, a percentage
becomes a four-figure bill that a property-rich, cash-poor player has to sell
buildings to pay, which is a buff.

**Consequence the user knows about:** both caps bind at $2,000 net worth, which
you cross after about one purchase. For most of a game they are effectively flat
again. Raising the caps is a two-number change in
`server/game/boards/classic.js`.

### Colour picks are allowed to collide

Two people can both choose purple; the server spreads everyone sharing a colour
evenly across its lightness. Nobody keeps the exact shade once there's a clash,
because an even spread is the only arrangement that **cannot** put two players
on the same value when the chosen colour already sits near white or black.

### Payments are broadcast as an event with a sequence number

`room.lastPayment` carries a `seq` that increments on every charge. The same
player paying the same rival the same rent twice in a lap is common, and
comparing values would animate it once.

### Sounds fire from state transitions, not from click handlers

Originally every sound was played locally by the person doing the thing, which
meant waiting for your turn was **completely silent**. `use-table-sounds.js`
derives events from state changes and plays them for everyone; your own actions
are skipped there because your click already played them.

Two hard-won audio facts:

- A sine wave has no harmonics, so it can only ever beep. The set fanfare uses
  a `PeriodicWave` bell spectrum, two detuned voices, and a generated convolver
  reverb. The reverb is most of what makes it sound "angelic".
- **Noise needs roughly twice the gain of a tone** to land as equally loud,
  because a bandpass discards everything outside its band. Getting this wrong
  is why the dice and jail sounds were once nearly inaudible.

### Kicked players cannot spectate; resigned and bankrupt players can

A vote-kick is the table saying they don't want you here, and a window back into
the same game undoes it. Resigning and going bankrupt are the *game* ending for
you, not the room closing.

### Snapshot restore refreshes every deadline

A restore hands back every player disconnected — which is exactly what the
abandonment countdown and the turn clock are watching for. Both get a fresh
window at boot, or the restart itself would kick someone out.

---

## 3. Active bugs, blockers and untested paths

### ⚠️ BLOCKER — the test suite lives in a temp directory that will be lost

Roughly **500 assertions** across 19 suites are in a session-scoped scratchpad:

```
C:\Users\Adel\AppData\Local\Temp\claude\C--Users-Adel-Desktop-nopoly\
  93d139ce-88b9-4403-9a71-f4ca71b00d93\scratchpad\
```

Engine suites (`node <file>`, no server needed): `payment` 21, `idle` 31,
`spectate` 39, `build` 26, `teams` 51, `vote` 57, `abandon` 34, `profile` 44,
`leave` 26, `jail-persist` 27, `tax` 19, `presence` 22, `redeploy` 22,
`lopsided.mjs` 20.

Socket suites (need a server on **:3001**): `votewire` 8, `leavewire` 6,
`abandonwire` 9, `spectatewire` 16, `idlewire` 10.

**They are not in the repo and the next session will not know where they are.**
Nothing else guards the engine. Moving them into `server/test/` with an npm
script should be the first thing anyone does.

Two need environment overrides to run quickly:
`NOPOLY_AWAY_MS=3000` (presence), `NOPOLY_IDLE_MS=3000` (idlewire).

### Known open issues

1. **Two pre-existing lint errors**, present all session and never addressed:
   `client/src/components/board/TileIcon.jsx:147` and
   `client/src/components/ui/button.jsx:57`, both
   `react-refresh/only-export-components`. Fix by moving the non-component
   export into its own file. Every "lint is clean" claim in this session means
   "clean apart from these two".

2. **Mobile side-tile names are unreadable.** Rotated inside a ~25px slot.
   Fixing it properly means dropping names on the left and right rows and
   leaning on the colour bar and flag — a real design change, deliberately not
   made unilaterally.

3. **The SIGTERM save path has never been executed.** Node on Windows
   terminates on SIGTERM *without running exit handlers*, so it cannot be tested
   locally. `redeploy.test.js` covers the same `persist.save()` via the 15s
   autosave instead. The graceful-shutdown branch itself is unverified.

4. **Persistence has never been round-tripped on the VM.** First boot printed
   `State: no rooms to resume`, which is correct but proves only the empty case.
   Nobody has confirmed `State: resumed N room(s)` in production.

5. **An auto-declined purchase that opens an auction costs another full 60s.**
   The turn can't end until the auction resolves, so the clock re-arms and fires
   again. Correct, but slow. Documented in `idle.test.js`.

6. **Background music is unjudged by ear over time.** The user approved the
   sound effects ("i think the sounds are set"). Nobody has listened to the pad
   for the twenty-plus minutes it would take to know whether the loop becomes
   obvious. It's off by default, which limits the blast radius.

---

## 4. Exact next steps

### First, in order

1. **Deploy `b1692c2`.** It touches `server/`, so it needs the restart:
   ```bash
   git pull && npm --prefix client run build && sudo systemctl restart nopoly
   ```
2. **Rescue the tests.** Copy the scratchpad suites into `server/test/`, add
   `"test": "node --test"` or a small runner to `package.json`, and commit. This
   is the single highest-value thing available and it is currently one temp
   sweep away from being lost.
3. **Play a real game with friends** and watch two things specifically:
   - Does the 60s turn clock ever fire on someone who *is* paying attention?
     If so, the activity ping is missing an interaction type.
   - Is the payment flash satisfying, or is it in the way? It sits at `top-26%`
     of the board for 1.7s (`client/src/components/board/PaymentFlash.jsx`).

### Then — the open product question

The user was asked which QoL features to build next and answered:

| Idea | Verdict |
|---|---|
| Emote reactions | **No** — "we just use Discord" |
| Turn clock | **Done** (`b1692c2`) |
| Make rent land | **Done** (`b1692c2`) |
| Mortgaging | **No** — declined on religious grounds (riba). Do not re-propose. |
| Season leaderboard | **Undecided** — "might be good but not sure" |

So the open item is the **season leaderboard**: wins per player across games,
persisted in the state directory that already exists. Ask before building it.

### Smaller things raised but never scheduled

- End-of-game awards derived from stats already collected (`room.stats` already
  tracks visits per tile, jail visits, doubles, trades, chat messages, and a
  net-worth history — the end screen already charts the last one).
- A roll-for-turn-order ritual at the start of a game.
- Build and sell straight from the You rail without opening each tile.

---

## Conventions to keep

- **Commit messages explain the *why*,** not the what. Read a few with
  `git log` before writing one.
- **Comments explain decisions and traps,** never restate the code.
- **Verify in the browser, not just in tests.** Several bugs this session —
  the hidden Upgrade button, the mid-word tile names, the overflowing board
  centre — were invisible to unit tests and obvious on screen.
- **Prefer a snapshot to a scripted game when staging a scenario.** Writing
  `.state/rooms.json` and booting the server gives a deterministic mid-game
  position; driving it with dice does not. Kill the server *before* writing the
  file or its autosave will overwrite you.
