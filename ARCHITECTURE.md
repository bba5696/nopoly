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

Because it is a predicate and not a shape, nothing in it cares how many people
are on a side. Sides can be any size and don't have to match — two against
three is a game people deliberately set up, and the old "exactly two" rule only
ever sent the odd player home. What used to cap a team game at eight was the
four pairs of shades written down for the four teams; the shades are now worked
out from a team's hue when the sides are dealt, so the limit is the room's own
player limit. The one rule left is that at least two sides have to have somebody
on them, because one side is not a game.

A debt is judged against the whole side, too: everyone still playing on it is
counted before anyone goes bankrupt, since with four teammates the money that
saves the debtor may be sitting with the one nobody asked.

The shape of the sides is two numbers the host sets: how many sides are in play
(`maxTeams`) and the most one may hold (`maxTeamSize`, zero for no limit). They
are limits rather than a layout, but between them they say what to do — four
sides out of twelve players deals three each, six sides deals pairs — so the
deal, the sections the lobby lays out and the start check all read the same two
numbers. Sides are set by dragging a player onto one: the lobby draws every
letter in play as a section, empty ones included, so an empty side is simply
somewhere to drop somebody.
Changing either re-deals, because the alternative is leaving people on a letter
that is no longer in play and making the host go find them.

## The host's door is the lobby's, and only the lobby's

The host can remove somebody before the game starts; after it starts the same
thing takes a vote. The line is who has a stake. In the lobby nothing has
happened yet, the room is the host's to set up, and without this the answer to a
stranger wandering in on a shared code is to abandon the code. Once play begins
everyone at the table has a game they are invested in, and one person deciding
who is still in it is exactly what the vote rules exist to prevent. The kicked
player's socket is taken out of the room and told, rather than left drawing a
lobby its owner is no longer in.

## The turn clock measures inactivity, not elapsed time

A flat sixty seconds from the start of a turn would cut off someone reading a
trade offer. It resets on any pointer move, key, scroll or tap, so the only
turns it ever ends are ones nobody is sitting in front of. The ping is throttled
to one per eight seconds and only sent by the player being timed.

When it fires it plays the **whole** turn at once — roll, decline, hand on —
because a minute per step means three minutes to pass one empty turn. It always
takes the passive option, so it can never spend your money. A debt is the
exception: only the player can choose what to sell, so the turn stays theirs.

**Nobody waits a minute on a closed tab.** A player whose socket has gone gets
seconds instead — nothing is going to move a mouse that isn't there, and near
the end of a long game most of the remaining turns belong to people who have
drifted off. That shorter clock is floored at the disconnect grace period, so
someone who dropped *during their own turn* still has their full window to
refresh back in; it only bites once they have been gone longer than a refresh
takes. It runs even at a table that switched the turn timer off, because that
setting is a rule about how long a person may take, not a reason for the game to
stop dead for someone who has left.

## A kick has to be about the clock

Vote-kick was being used for the thing it looks like it's for and isn't: getting
rid of whoever is winning. Four rules now stand between wanting that and doing
it, and all four live in `startVoteKick`.

**You can only vote out someone the turn clock has had to play for.** Every
expiry stamps `stalls` and `lastStallAt` on the player, and a ballot is refused
against anyone without a recent one. Being ahead isn't grounds; being slow is
the only thing that is. The stamp expires after ten minutes, or one blip at
minute ten would leave you kickable for the rest of the game — which is the
whole loophole back in, just with a wait attached.

**Nothing can be called in the opening minutes** — two, plus one per player at
the table. It's really a count of turns: you can't know someone is stalling
until you've watched them take a few, and eight people take four times as long
to come round as two. Every vote called inside that window was somebody
reacting to a bad roll.

**The caller waits five minutes afterwards, win or lose.** The old cooldown
protected the target only, which left one person free to work down the table a
name at a time; and a vote that passes is still five minutes of everyone's game,
so winning isn't a way round it either.

**Everything is on the record.** The log names who called the vote, how many
turns the clock had played for the target, and who voted which way. Among
friends that's the part that actually works — four people could do this
anonymously before, and the tally on its own made it deniable.

None of it applies to a player who has dropped out. That path isn't a ballot at
all but a countdown they can end by coming back, it's the room's only way of
shedding an empty seat, and someone who isn't there can't be waited on or
stalled at. The lobby is exempt from the stall rule for the same reason in
reverse: nobody has had a turn to be slow about, and a stranger in the room is
the one thing a vote is genuinely for there.

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

## The souvenir is drawn, not uploaded

The end screen's net-worth chart can be saved as a picture. A room is gone the
moment the server reclaims it, and there is no database and no object store, so
there was never a URL that could still resolve tomorrow — a "share link" would
have meant inventing storage for the one feature that wants it least.

So `client/src/lib/share-card.js` composes the card on a canvas from state the
client already has, and hands the player a PNG. Nothing is uploaded, nothing
outlives the room, and the feature works the same on a server with the disk
turned off. Copy, the share sheet and a download are all offered because no one
of them exists everywhere; whichever the browser lacks is not shown.

It draws the card rather than screenshotting the page. The on-screen chart is an
SVG full of CSS variables and web fonts, and every DOM-to-image route for that is
a dependency plus a list of things that quietly come out blank.

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

## Nothing ever says a game is over

Rooms live in a `Map`, and no player action removes one. Leaving is "gone for
now", because a refresh is indistinguishable from quitting; winning leaves the
end screen up; closing the tab tells the server a socket dropped, not that the
table is finished. So the only thing standing between the Map and the life of
the process is a sweep, and it has to recognise three different shapes of
"nobody is using this":

- **empty** — no player's socket is attached for thirty minutes. Timed rather
  than immediate, because the disconnect grace period and the abandonment
  countdown both depend on a seat outliving its socket.
- **finished** — someone won and nothing has been asked of the room for thirty
  minutes. Measured from the last request rather than from the win, so reading
  the stats or starting a rematch keeps it.
- **stale** — sockets are attached and none of them belongs to a person any
  more. A tab left open on a phone in a pocket never disconnects, so the first
  two rules never see it; worse, the turn clock keeps playing turns for a table
  nobody is sitting at, which makes the room look busy while being completely
  abandoned. Three hours without a single request closes it.

Staleness is measured from the last thing a **client asked for** — `act()` is
the one place that records it, and nothing the server does on its own timers
counts. Anything else and the turn clock would keep an abandoned room alive by
talking to itself.

Closing a room is more than deleting the key. Its three timers hold the object
being freed, its players' grace timers hold it for another forty-five seconds,
and — uniquely for the stale case — there are live sockets sitting in a room
that no longer exists. All of that is unwound together, and the clients are
told, because a board that silently stops answering reads as a broken server.

## Testing

`server/test/` holds 24 suites, run with `npm test` from `server/`. They are
plain scripts rather than a framework: each counts its own assertions and exits
non-zero.

`test/run.js` handles what each kind needs — engine suites run bare, the socket
suites share one server it boots on `:3001` with the idle and away windows
shortened, and `redeploy`, `limits` and `cleanup` run last because they spawn servers of
their own: one to `SIGTERM` the way systemd does, one booted with the room caps
turned low enough to actually reach, one with room lifetimes measured in
milliseconds. `test/fixture.js` writes staged rooms as a snapshot the server restores
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
