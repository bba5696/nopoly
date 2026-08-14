# Architecture

Why Nopoly is built the way it is. The code carries the local detail; this is
the shape of the thing and the decisions that would be expensive to reverse.

## The engine is authoritative and the client is a view

Every rule lives in `server/game/engine.js` — about 2,100 lines, no framework,
plain objects and pure-ish functions of the form `(room, playerId, …) → {} |
{ error }`. `server/index.js` does nothing but wire socket events to those
functions and broadcast the result.

The client mirrors a few calculations in `client/src/lib/rent.js` purely so a
button can be hidden before it would fail — never as the decision. If the two
disagree, the server wins.

`publicState()` is the single seam between them. It strips server-only state
(the card decks) and adds derived values the client would otherwise have to
recompute: net worth, live market prices, which side holds each completed set.

## One process, in memory, on purpose

Rooms live in a `Map` in one Node process. There is no database.

This is a real ceiling and an accepted one: the game cannot run as more than one
instance, because a second one would put players into two worlds that never see
each other. For a private group that is the right trade — no schema, no
migrations, no query layer, and every rule is a function call against an object
already in memory.

The consequence is handled rather than ignored. `server/persist.js` snapshots
every room to disk on a 15-second timer and on `SIGTERM`, and the server reads
it back at boot, so a redeploy is a blip rather than the end of everyone's game.
Snapshots older than six hours are discarded, and the file is deleted once
restored so a crash cannot replay a game the table has already moved past.

It also rules out serverless hosting entirely — see `deploy/README.md`.

## Spectators are kept out of `room.players`

Turn order, net worth, who has won and what a vote needs are all counted off
that list. Keeping watchers in a separate `room.spectators` makes them harmless
*by construction* rather than by remembering to exclude them in nine places. A
single guard in `act()` refuses everything they send, so an action added later
is refused without anyone having to think about it. Chat is the one deliberate
exception.

## Teams are one predicate, not a parallel code path

With teams on, deeds still belong to whoever bought them: they paid from their
own cash, only they may sell, and the log can still say who did what. What teams
change is who a deed *counts for* — and that is entirely `sameSide()`.

Sets, airport and utility tallies, win conditions, auction guards and trade
restrictions all route through that one function. Adding teams did not fork the
engine.

## The turn clock measures inactivity, not elapsed time

A flat sixty seconds from the start of a turn would cut off someone reading a
trade offer. It resets on any pointer move, key, scroll or tap, so the only
turns it ever ends are ones nobody is sitting in front of. The ping is throttled
to one per eight seconds and only sent by the player being timed.

When it fires it plays the **whole** turn at once — roll, decline, hand on —
because a minute per step means three minutes to pass one empty turn. It always
takes the passive option, so it can never spend your money. A debt is the
exception: only the player can choose what to sell, so the turn stays theirs.

## Building is turn-gated; selling is not

A deliberate asymmetry. Rent lands on you during *other people's* turns, so you
must be able to sell to clear a debt whenever it happens. Building on someone
else's turn was a real exploit — a set could be developed in the gap between a
rival landing on it and the rent being calculated.

## Debt is a state, not an immediate bankruptcy

`charge()` is the single funnel every payment goes through. Anything a player
cannot cover in cash becomes a debt they must clear themselves by selling; the
game never liquidates an estate on their behalf. Their turn is blocked until it
is settled, and bankruptcy follows only when the whole estate provably falls
short.

This is why there are two different valuations. `netWorth()` values buildings at
cost and is what the rail displays; `liquidValue()` values them at half, which
is what they actually raise. Deciding solvency on the first would tell a player
they can cover a debt they cannot.

An estate always returns to the bank rather than to a creditor, so nothing can
be handed to a friend on the way out and nobody wins by being owed money.

## Timers are absolute deadlines on state, scheduled separately

Auctions, vote-kicks and the turn clock all store an absolute `endsAt` on the
room, with the actual `setTimeout` held in `index.js` and re-armed after every
action. Anything that expired during a restart therefore resolves immediately at
boot instead of hanging forever, and a restore can hand every deadline a fresh
window — which it does, because a restart marks everyone disconnected and would
otherwise kick someone out for it.

## Colour picks are allowed to collide

Two players may both choose purple; the server spreads everyone sharing a colour
evenly across its lightness. Nobody keeps the exact shade once there is a clash,
because an even spread is the only arrangement that **cannot** put two players
on the same value when the chosen colour already sits near white or black.

## Payments are broadcast as an event with a sequence number

`room.lastPayment` carries a `seq` that increments on every charge. The same
player paying the same rival the same rent twice in a lap is common, and
comparing values would fire once.

## Sounds come from state transitions, not click handlers

Originally every sound was played locally by the person doing the thing, which
meant waiting for your turn was completely silent — and this game spends most of
its time waiting. `use-table-sounds.js` derives events from state changes and
plays them for everyone; your own actions are skipped there because your click
already played them.

Two hard-won audio facts live in `client/src/lib/sound.js`:

- A sine wave has no harmonics, so it can only ever beep. The set fanfare uses a
  `PeriodicWave` bell spectrum, two detuned voices and a generated convolver
  reverb. The reverb is most of what makes it sound like an instrument.
- **Noise needs roughly twice the gain of a tone** to land as equally loud,
  because a bandpass discards everything outside its band. Getting this wrong is
  why the dice and jail sounds were once nearly inaudible.

## Boards are data, and geometry is derived

A board is a plain definition in `server/game/boards/`. Everything positional —
grid size, where the corners fall, how long a lap is — is derived from the
length of its layout, so adding a board is adding a file. The client mirrors the
same derivation to lay out its CSS grid.

Card destinations are bound by tile *name* per board, since boards differ in
length. A name that does not exist on a board falls back to Start.

## Access

One shared password for the whole site, set as `NOPOLY_PASSWORD`. The check that
matters is the Socket.IO handshake, not the login screen — the game server is
the actual resource, and a client-side gate is bypassed by opening a socket
straight at it. Signing in over HTTP only mints the token the handshake demands.

Tokens are HMACs keyed by the password itself, so they survive a restart and all
of them stop working the moment the password changes. The server refuses to
start in production without a password rather than logging a warning nobody
reads.

## The password was also the rate limiter

`NOPOLY_PASSWORD` gates the site, but for a long time it was doing a second job
nothing named: standing in front of `room:create`, the one call an unknown
caller can make that costs this process memory. Empty rooms are swept after
thirty minutes, which bounds growth over an evening but not over a minute — a
loop can allocate boards far faster than the sweep reclaims them, and there is
one gigabyte and no second instance.

So opening the game up meant replacing that job rather than simply removing it.
Two limits, because they fail differently:

- **A global cap on `rooms.size`.** The one that actually protects the box:
  whatever gets past a per-IP limit — a proxy, many machines — still cannot
  exhaust memory. It bounds the autosave too, since `JSON.stringify` runs over
  every live room.
- **A per-IP creation limit,** same shape as the login limiter in `auth.js`.
  The cap alone would let one script fill every slot and lock the friend group
  out; this is what keeps the cap's slots available to actual people.

Both are far above anything a friend group produces, and both are env-tunable.
If a real game is ever refused, they are too low and are meant to be raised.

Running without a password is now allowed but must be **stated**, via
`NOPOLY_OPEN=1`. The boot guard used to refuse outright; deleting it would have
meant a typo in `/etc/nopoly.env` silently publishing the site. Opening on
purpose and opening by accident must not look the same to the server.

## The legal page is a claim about the code

`client/legal.html` states exactly what is stored, where, and for how long — the
five `localStorage` keys by name, the six-hour snapshot, the ten-minute
rate-limit window. That specificity is the point: a policy vague enough to never
be wrong is also vague enough to be useless.

The cost is that it is the one document that can be made *false* by a code
change. Adding a storage key, logging a new field, or changing a retention
window makes it inaccurate until it is edited too. It is a plain page outside the
React app for the same reason `sounds.html` is, plus one of its own: it has to be
readable **before** the password gate, since terms you can only reach by first
agreeing to them are not terms.

## Testing

`server/test/` holds 23 suites, run with `npm test` from `server/`. They are
plain scripts rather than a framework: each counts its own assertions and exits
non-zero.

`test/run.js` handles what each kind needs — engine suites run bare, the socket
suites share one server it boots on `:3001` with the idle and away windows
shortened, and `redeploy` and `limits` run last because they spawn servers of
their own: one to `SIGTERM` the way systemd does, one booted with the room caps
turned low enough to actually reach. `test/fixture.js` writes staged rooms as a snapshot the server restores
at boot, which is how a deterministic mid-game position is set up; rolling your
way to a particular tile is a coin flip dressed up as a test.

## Conventions

- **Commit messages explain the *why*,** not the what.
- **Comments explain decisions and traps,** never restate the code.
- **Verify in the browser, not just in tests.** Several bugs here — a hidden
  Upgrade button, mid-word tile names, an overflowing board centre, a clipped
  tax label — were invisible to unit tests and obvious on screen.
- **Prefer a snapshot to a scripted game when staging a scenario.**
- **If you change what is stored or logged, update `client/legal.html`.** It
  names the storage keys and retention windows explicitly, so it goes stale
  silently.
