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

## A board is as big as a square can be

Boards live in `server/game/boards`, and adding one is adding a file: geometry
is derived from the length of the layout, so the grid, the corners and the lap
all follow from how many tiles are in it. What does not scale is the drawing.
The ring is a square sized to the window, so every tile added takes width off
every other one — at sixteen tiles a side the names break mid-word on a laptop
and a phone is hopeless. That was the ceiling until the viewport below, which
lifts it by letting the board be bigger than the window.

What a big table actually needs is deeds: twelve people on a forty-tile board
run out of property long before they run out of players. Grand Tour is 52 tiles
and 31 deeds over twelve countries, mostly pairs — seven sets of two, three of
three, two of four — because a table of twelve rarely assembles three of
anything by luck, and a board where nobody completes a set is a board where
nobody builds. Sixty-four was tried once the viewport made it possible, and was
still too much board to look at; the deeds a shorter lap cannot carry are found
in the exchange instead.

Past that, the board stops shrinking and the window starts moving.
`BoardViewport` measures the space it has, works out the width at which a
middle slot is 34px across — the floor for a name being a name rather than a
smudge — and lays the board out at the larger of the two, scrolling if that
overflows. A finger drags it, ctrl+wheel or a trackpad pinch resizes it, and
Fit puts the whole board back on screen to see who owns what. Real layout
rather than a CSS transform, so the text is rendered at the size it is read
at. On a laptop, and for Classic on a phone, the board already clears the
floor and none of this shows up.

## An auction happens on the board, not over it

An auction used to be a modal: a dialog in the middle of a blacked-out screen,
which is the obvious way to make something impossible to ignore. It also covered
the board — and the question a table actually argues about while the clock runs
is whether the player in front is about to finish a country, which is a question
about the board.

So it runs in the hole in the middle of the ring instead. `BoardCenter` already
switches what it shows by state; during an auction it hands the whole middle to
`AuctionPanel` and puts the dice, the status line and the feed away, none of
which have anything to say mid-auction. Every tile stays visible and stays
clickable.

The board answers the set question itself. `Board` works out one `focus` — which
tiles to light and in what colour — from the auction if there is one and from the
roster hover otherwise, and the auction wins, because an auction holds up the
whole table. The country is lit and everything else dropped back; the lot pulses
in its own slot; and the moment the leader's next bid would complete the set, the
country is lit in *their* colour rather than the country's. `lib/auction.js`
decides that, and the panel says the same thing in words underneath.

Turning a tile down bars you from bidding on it — `passNoBid`, a house rule the
host can switch off, on by default. Declining and then winning the same tile for
less than the asking price was the cheapest way to buy anything on the board,
and it made the number printed on the deed a suggestion. The bar covers your
whole side, or with teams on it would be one player passing and their partner
buying it cheap. The auction that happens because somebody landed on a tile they
*cannot afford* bars nobody: nothing was chosen there, and if the money turns up
mid-clock the bid stands. With the rule off, `barredId` is simply never set,
which is the same state as nobody having passed — the client needs no branch for
it.

Anyone can fold the panel away to a chip — the lot, the price and the countdown,
one press from being back. Somebody who is not bidding still has a game to watch
and the panel is sitting on their board while they wait. It is per-auction
rather than a preference: the next lot arrives open however the last one was
left.

What the backdrop was really doing was making an auction unmissable, so that is
paid for elsewhere: the panel arrives hard and breathes in the country's colour,
the last three seconds of the clock go red, a gavel sounds for everybody, and
anything you had open is held until it is over. The clock itself went from six
seconds to ten — six was right when there was nothing to look at but the bid.

Bidding lives in `AuctionBids`, which the panel renders inside the ring at `xl`
and the screen renders in the bar under the board below it. That is the same call
the turn's own controls make, and for the same reason: on a phone the ring's
middle is a couple of hundred pixels across, and a button you cannot reach with a
thumb is not a button.

## Past games live on the device, not on the server

A room is reclaimed within the hour and there is no database behind any of
this, so a finished game used to exist only for as long as the tab stayed open.
The history keeps the numbers the end screen was drawn from in localStorage
instead: the last twenty-five games, each with its standings, its chart, its
stats and whatever name it was given.

The trade is deliberate. A per-device history is private by default, needs no
endpoint, no account and no retention policy, and cannot leak a game to anyone
who was not sitting at that browser. What it cannot be is one shared archive:
four people who played the same game each keep their own copy, and clearing
site data clears it. Sharing is therefore a picture rather than a link, which
is what the share card already made for the end screen — it now carries the
game's name, and the file is dated the day the game was played.

`Scoreboard` draws the end screen from a plain record rather than from the live
room, and both `GameOver` and the history render it. Two renderings of the same
numbers would drift, and the point of keeping a game is looking at the screen
you remember.

## A shared game is a link with a deadline

The history is per-device, which is no use for showing somebody else, so Link
posts the end screen to the server. It is held in memory under an unguessable
id and dropped at the deadline whether it was opened or not — an hour by default,
`NOPOLY_SHARE_MS`. Nothing is written to disk, nothing survives a
restart, and there is no endpoint that lists what exists: a link is the only
way in, and only the person who pressed the button has one. An id that is gone
answers 410 rather than 404, because "you are too late" and "never existed" are
different things to be told.

One game, one link. Everyone at a table can share the same game from their own
history, and pressing Share twice used to make a second copy under a second
address. The server fingerprints what `cleanShare` keeps and, if a live link
already holds exactly that, hands it back with its hour started again — whoever
pressed Share is about to send it to somebody. A name given to the game makes it
different data and so a different link. Handing back an existing link is checked
before the limits, since it costs nothing and should never be refused. On a
shared page itself, Share copies that page's address instead of asking at all.

Three limits, for the same reason the room caps exist: a global cap on how many
are live, a per-IP cap on how many can be made, and a 96kb body — this is the
one route in the process that a stranger can put bytes into. What is stored is
rebuilt field by field from the request rather than kept as sent, so what comes
back out is the shape the client expects and nothing else is parked in memory
under the name of a game.

The page renders before the password gate and opens no socket. Whoever holds
the link was sent it, asking them for the room's password to look at a
scoreboard would be theatre, and a connection would put a spectator nobody
invited into the presence count. Making a link is therefore a decision, which
is why it is a button and not something that happens when a game ends.

## One room, two games

The expensive half of this project was never the property rules. It is rooms,
codes, reconnecting into a seat, presence, chat, kick, spectating, the turn
clock, snapshots, past games and share links — about a thousand of engine.js's
lines and most of index.js — and none of it cares what is being played. A
second game is worth having only if it costs the rules and nothing else.

So a room carries a `game`, and `server/game/rules.js` is a registry shaped
like `board.js`: keyed by id, a getter that falls back rather than throwing, a
list precomputed for the picker. A rules module owns six things — `createRoom`,
`addPlayerFields`, `startGame`, `playIdleTurn`, `removeFromPlay`, `view` — plus
its own actions and, optionally, its own deadline. Everything else stays put.

The property game is one of those modules and it lives inside engine.js,
because `advanceTurn`, `goBankrupt` and `snapshotNetWorth` are internals and
exporting a dozen of them to satisfy a wrapper in another file would widen the
module's surface for nobody. What the seam is worth is not where the code sits;
it is that engine.js no longer decides what "start" or "an idle turn" mean.

`turnIndex` deliberately stayed generic. Both games have a seat order, and the
client reads `players[turnIndex]` to know who is playing — so the whole
context, `current` and `isMyTurn` included, works for both with no branch.

An old snapshot has no `game` field and resumes as nopoly. `persist.js` needed
no change at all: it stringifies whole rooms and validates only the code.

## A hand is not a board

A board is on the table and one broadcast is the whole truth. A hand is true
for exactly one person, which is the only structural difference the card game
makes.

The state the room is sent carries `handCount` and never `hand` — built key by
key rather than spread-and-delete, because the one line in this project that
must never leak should not depend on how an encoder treats `undefined`. The
cards go down a second, smaller event to one socket each.

A second channel rather than a per-viewer `state`: the client is built on one
payload replacing the whole state, and tailoring that per seat would cost a
serialisation per player on every action to say the same thing twelve different
ways. This is additive — a game with no secrets sets `privateFor` to null and
`broadcast` skips the walk entirely, so nopoly pays nothing. Spectators are
never on the channel, and `seat()` pushes a hand on the way in or a reconnecting
player would stare at an empty fan until somebody else moved.

The snapshot on disk now contains hands. It always contained everything.

## Net worth, itemised

`worthOf` returns the parts and `netWorth` returns their sum, so there is one
calculation rather than two that can drift. Cash, every deed at what the board
says it is worth now, houses and hotels at what they cost to put up — all five
levels — shares at what was paid, and a get-out-of-jail card at the fine it
saves. An unsettled debt comes off, because a bill you cannot pay is a real
liability and leaving it out ranks somebody above a rival they cannot afford to
stay in the game against.

Three numbers, not one, because they answer different questions and mixing them
up is what made the rail confusing. `estate` is what a player holds. `total` is
that less what they owe, and is the number worth ranking people by. `liquid` is
neither: it is what selling would actually raise, with buildings coming back at
half, and it is the figure the engine checks before anyone goes bankrupt.

That is why a player can owe $500, show a net worth of $307, and pay the bill
anyway — the debt has already been taken off the figure on the rail, and the
buildings they sell to cover it were never counted at half there. The debt
notice now says what a sale would raise and whether it is enough, rather than
leaving the net figure to be read as an answer to a question it isn't
answering.

Landmarks are deliberately absent — nothing will buy one, so any figure put on
one would be invented.

The client is sent the parts alongside the total and shows them when the number
is tapped, so "why is my net worth that?" has an answer on screen.

## The exchange: a stake in somebody else's country

A monopoly is the only thing on a normal board worth having, and at twelve
players most of the table never gets one — the deeds run out first. Grand Tour
puts four exchange squares on the ring, one a side. Landing on one opens a
market in every country at once, rather than a market in the one country the
tile happens to name, which would be dead four times in five.

A share is a quarter of every rent that country's tiles collect, bought from
the bank, with the deed left where it is. Two to a country. The cut comes out
of the rent rather than out of the bank: the payer pays what they always paid,
and no new money enters a game that already inflates through Start. A rent
half-paid divides what actually arrived, not what was owed — the shortfall is
the payer's debt, not the shareholder's claim.

A share is priced off what the country earns, not what its deeds cost. The
first version pegged it to a fifth of the deeds, and that was right on turn
five and meaningless by turn fifty: rent climbs up to a hundredfold with
building and the price did not move, so a $170 stake in a hotel country paid
for itself three times over on one landing, and the owner could shake it off
for $255. Late in a game neither buying a share nor buying one back was a
decision. The price is now the country's average live rent times the four
landings a stake should take to pay back — floored at the old fifth, so a bare
country's share is as cheap as it always was. The consequence worth having is
that the bargain is buying *before* the owner builds.

Whoever holds the deeds can buy a share back, and the shareholder has no say —
but the owner is racing a window. The price is a multiple of what the stake is
worth today (or what was paid, if that is higher, so a shareholder is bought
out and never robbed), and the multiple climbs with every lap the shareholder
completes: half again, then double, then triple, and after three laps it
cannot be taken at all. Laps are the holder's, counted as they pass Start, so
the table can see the window closing. An owner is taxed forever only if they
let it happen.

It also costs a turn. A buy-back happens on your own turn, once, and is that
turn's building — so the owner of a developed country chooses between the next
hotel and the stake draining it, rather than doing both between rolls. Trades
are untouched, since they happen off-turn and a share can be bought out of one
at whatever price the two players agree.

Shares count in net worth and in liquid value, and the bank buys them back at
what they cost — never at what they are worth now, or buying a bare country's
stake and selling it back after the hotels went up would print money. That is deliberate: a share is money a player can reach, so it
belongs in the test for whether a debt can be covered rather than only in the
ranking. A share held in your own country pays you nothing and is still worth
buying, because it is one of the two.

## Landmarks: the one square money cannot buy

Everything else on the board rewards being ahead. Rent needs deeds, shares need
cash, and a player who started badly is priced out of both — which is exactly
the player most likely to stop playing. A landmark is claimed by standing on
it, costs nothing, and is not exclusive: the second person to reach it gets the
same thing the first did, and landing on it twice is worth nothing extra. It is
the one race a losing player can still win, and winning it takes nothing from
anybody.

Two kinds, named in the layout's `extra` and carried on the tile as `boon`: a
larger payout every time you pass Start, or a standing discount on rent you pay.
Both are permanent and neither can be traded, sold or taken. The discount comes
off before anyone is charged, so the payer pays less and the owner and any
shareholders divide what is left — a discount is the payer's, not something a
landlord pays for twice. `boonsOf` reads the totals from the tiles each time
rather than keeping a running number on the player, so a snapshot written before
landmarks existed cannot leave a stale bonus attached to somebody.

Grand Tour carries two and three exchanges; Worldwide carries one of each,
enough that a long game meets both without becoming a different board; Classic
carries neither, and is left exactly as people already know it.

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

## A kick is a majority, and not much else

Vote-kick once carried four rules meant to stop it being used on whoever was
winning: a ballot only on someone the turn clock had had to play for, an opening
window that grew with the table, a cooldown on the target, and another on the
caller. In play they mostly stopped a table removing somebody it plainly wanted
gone — "sometimes it just doesn't let you" — so three of them went.

What is left, all in `startVoteKick`:

**Nothing can be called in the first five minutes.** Every vote called inside
that window was somebody reacting to a bad opening roll.

**A ballot needs at least three players in the game.** Below that, calling the
vote *is* the vote, and one person would be removing another.

**It still takes a majority** — everyone else still in the game, to a ceiling
of four — **and everything is on the record.** The log names who called it and
who voted which way. Among friends that is the part that actually keeps it
honest.

None of it applies to a player who has dropped out. That path isn't a ballot at
all but a two-minute countdown they end by coming back — the room's only way of
shedding an empty seat. Nor can any vote run while a game is paused: somebody
gone from a paused game is somebody the pause is waiting for.

## Building is turn-gated; selling is not

A deliberate asymmetry. Rent lands on you during *other people's* turns, so you
must be able to sell to clear a debt whenever it happens. Building on someone
else's turn was a real exploit — a set could be developed in the gap between a
rival landing on it and the rent being calculated.

## A country is built in one action, not fifteen

`buildHouse` puts up one house on one tile, which is the rule; it was also the
only way to spend money on a set, through that tile's own card. Taking three
tiles to hotels was fifteen trips through a modal, in the order even building
dictates anyway, and fifteen lines in the feed.

`buildSetTo(room, playerId, groupId, level)` runs the same rule in a loop:
always on the tile with the fewest houses, stopping the moment `canBuild` says
no. Running out of cash halfway is a result rather than an error — taking a
country as far as the money goes is a thing people mean to do — so it reports
what it actually reached, and the feed gets one line saying so. `sellSetTo` is
the mirror, off the most-built first, and like `sellHouse` it is neither
turn-gated nor blocked by debt: rent lands on you during other people's turns,
and this is how it gets paid.

The client side of it is `SetsModal`, which opens on a tap on a country you
hold — but only once you hold two or more. With a single set there is nothing
to switch between and the deed's own card is still the better screen, so
nothing changes for the player who has just completed their first country. The
panel shows every completed set with what each tile charges now and what it
would charge at the level being considered, since the second number is the
reason anybody builds. Selling asks twice, because it is the one button there
that turns buildings into half their money.

## Debt is a state, not an immediate bankruptcy

`charge()` is the single funnel every payment goes through. Anything a player
cannot cover in cash becomes a debt they must clear themselves by selling; the
game does not liquidate an estate on behalf of someone who is there to choose.
Their turn is blocked until it is settled, and bankruptcy follows only when the
whole estate provably falls short.

The exception is a turn the clock plays for someone who has gone. A debt used to
stop the clock dead, which meant one player walking away owing money froze the
table until somebody voted them out. `sellToCover` now sells for them in the
order that costs least — shares at cost, loose deeds, buildings evenly, then
the sets — and stops the moment the debt is clear. If even that falls short
they go bankrupt rather than leaving the table stuck. The one thing the clock
still waits on is a teammate who has been asked to bail them out.

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

## The admin panel is a key, not a device

Room codes are the only access control a game has once the password is off, so
anything that lists them is a list of every open door on the server. For a long
time the answer was that nothing did: to see what was running you read the
snapshot over SSH. The panel at `/admin` changes that on purpose — kicking a
player from a phone is worth having — so it is built as the most guarded thing
on the server rather than a convenience.

It was asked for as "only my hardware ID", and that is the part a web page
cannot do. A browser exposes no hardware identity, and the browser id the client
does send (`pid`) is a value it reports about itself — anybody can put any
string there. So "only my device" is a secret only your device has: a key set as
`NOPOLY_ADMIN_KEY`, entered once, kept in that browser as a week-long token.

Built like the password gate and sharing none of it. Tokens are HMACs keyed by
the admin key, so a player's token is never an admin's and changing the key
signs everyone out. Unset means *closed*, where an unset password means open —
a panel nobody configured must not be the one reachable by default. Keys under
sixteen characters are refused, five wrong guesses lock an address out for
fifteen minutes, and every attempt is logged, because exactly one person should
ever be making one.

The API lives under `/api/admin` so the page at `/admin` stays the client's, and
is plain HTTP polling rather than a socket: it is a tab opened now and then, and
must never count as a presence in a room or keep an abandoned one alive. A kick
goes through `ejectPlayer`, the same exit a passed vote takes — banned from the
room, estate returned rather than left with a friend — and says so in the feed,
because a player vanishing mid-game with no explanation looks like a bug to the
people still at the table.

The rest of the panel is for a game that is stuck rather than a player who is
the problem: pause, play the current turn, close an auction, lift a ban. Playing
a turn deliberately reuses the turn clock's idle turn rather than advancing the
seat — a bare skip can leave a card game halfway through naming a suit or a
board with a purchase still on screen, and the idle turn is the path already
written and tested to leave neither. It takes the passive option at every step,
so an admin can unstick a game without making a decision for anybody.

What it cannot do is as deliberate. It never edits a player's cash or deeds —
a result the key holder could have changed is a result nobody at the table can
trust, and "fix a bug mid-game" is exactly the reason someone would reach for
it. It never reads chat, because the terms say nobody does, and its view of a
room is the spectator's, so no hand is ever in it. Every action lands in the
room's feed and in an audit log with its address, so a leaked key shows up as
things its owner did not do.

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

`server/test/` holds 34 suites, run with `npm test` from `server/`. They are
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
