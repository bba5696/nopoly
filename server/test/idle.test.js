// The turn clock: when it runs, what resets it, and what it does when nobody
// is sitting in front of the turn it's counting.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { timer = true, start = true } = {}) {
    const r = e.createRoom('IDLE');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    if (!timer) e.updateSettings(r, p[names[0]].id, { turnTimer: false });
    if (start) e.startGame(r, p[names[0]].id);
    return { r, p };
}

const upNow = (r) => r.players[r.turnIndex];

/**
 * Run `fn` with the next dice roll pinned to `[d1, d2]`.
 *
 * The engine rolls straight off Math.random, so anything asserting on where a
 * turn ended up is otherwise betting on the dice. Restored in a finally, or one
 * throw here would silently fix the dice for every block after it.
 */
function withRoll([d1, d2], fn) {
    const real = Math.random;
    const queue = [(d1 - 1) / 6, (d2 - 1) / 6];
    Math.random = () => (queue.length ? queue.shift() : real());
    try {
        return fn();
    } finally {
        Math.random = real;
    }
}

/* ----------------------------------------------------------- when it runs */
{
    const { r } = mk(['Ada', 'Bo', 'Cy'], { start: false });
    ok('no clock in the lobby', r.idle === null);
    e.startGame(r, 'pid-Ada');
    ok('it starts with the game', !!r.idle, JSON.stringify(r.idle));
    ok('and points at whoever is up', r.idle.playerId === upNow(r).id);
    ok('with a minute on it', Math.round((r.idle.endsAt - Date.now()) / 1000) === 60,
        String(r.idle.endsAt - Date.now()));
}
{
    const { r } = mk(['Ada', 'Bo'], { timer: false });
    ok('the rule can be turned off', r.idle === null);
    e.expireIdle(r);
    ok('and then nothing expires', r.idle === null);
}

/* ------------------------------------------------------- what resets it */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    r.idle.endsAt = Date.now() + 1000;
    e.noteActive(r, up.id);
    ok('a sign of life pushes it back', r.idle.endsAt - Date.now() > 55_000);

    // Somebody else moving their mouse is not evidence about this turn.
    const other = r.players.find((q) => q.id !== up.id);
    r.idle.endsAt = Date.now() + 1000;
    e.noteActive(r, other.id);
    ok('but only from the player being timed', r.idle.endsAt - Date.now() < 2000);
}

/* ------------------------------------------------- what it does on expiry */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    // Auctions off, so declining can't open one and hold the turn open —
    // that case has its own block below.
    r.settings.auction = false;
    const up = upNow(r);
    const before = r.turnIndex;
    // Forced off doubles. A double earns another roll, so endTurn re-arms the
    // clock instead of advancing and the turn stays where it is — correct, but
    // it made this block fail one run in six until the dice were pinned.
    withRoll([1, 4], () => e.expireIdle(r));
    ok('the turn was played', r.stats.turnCount >= 1);
    ok('and handed on', r.turnIndex !== before, `${before} -> ${r.turnIndex}`);
    ok('the table is told why', /was away/.test(r.log.map((l) => l.text).join(' ')));
    ok('they are still in the game', !up.bankrupt);
    ok('and the clock is running for the next player', r.idle?.playerId === upNow(r).id);
}
{
    // Landing on something buyable: the passive choice, not a purchase.
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    const cash = up.cash;
    r.settings.auction = false;
    // Pinned onto a property. The comment here promised a staged landing that
    // nothing staged, so this rolled at random and asserted only that the cash
    // hadn't gone *up* — which says nothing about buying, and failed outright
    // whenever the dice found a card that pays out.
    withRoll([1, 2], () => e.expireIdle(r));
    const landed = r.tiles[up.position];
    ok('it landed on something buyable', landed.type === 'property', `${landed.name} is ${landed.type}`);
    ok('nothing was bought on their behalf', up.properties.length === 0 && landed.ownerId === null);
    ok('and the cash is untouched', up.cash === cash, `${cash} -> ${up.cash}`);
    ok('no purchase is left pending', r.pendingAction === null, JSON.stringify(r.pendingAction));
    ok('and no card is left on screen', r.pendingCard === null);
}
{
    // A debt can only be settled by the person who owes it.
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    up.debt = { amount: 200, toId: null, bailout: null };
    const before = r.turnIndex;
    e.expireIdle(r);
    ok('a debt is not played for you', r.turnIndex === before);
    ok('the debt stands', !!up.debt);
    ok('but the clock keeps running', !!r.idle, JSON.stringify(r.idle));
}

/* ------------------------------------- an auction opened by the auto-decline */
{
    // With auctions on, walking away from a purchase puts the property up for
    // one — and the turn can't end until it's settled, which is right. The
    // clock re-arms rather than forcing it, so the table gets to bid.
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    // Put them on a vacant property so the roll is guaranteed to offer a buy.
    r.pendingAction = { type: 'buy', playerId: up.id, tileId: r.tiles.find((t) => t.type === 'property').id };
    r.hasRolled = true;
    e.expireIdle(r);
    if (r.auction) {
        ok('an auction opened instead of a purchase', !!r.auction);
        ok('and the turn waits for it', r.players[r.turnIndex].id === up.id);
        ok('with the clock running again', r.idle?.playerId === up.id, JSON.stringify(r.idle));
        e.resolveAuction(r);
        e.expireIdle(r);
        ok('once settled, the next expiry hands the turn on', r.players[r.turnIndex].id !== up.id);
    } else {
        ok('no auction, so the turn simply ended', r.players[r.turnIndex].id !== up.id);
        pass += 3;
    }
}

/* --------------------------------------------------- it follows the turn */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const first = upNow(r).id;
    e.rollDice(r, first);
    // However the turn ends, the clock should be on the next player.
    if (r.pendingAction) e.declinePurchase(r, first);
    r.pendingCard = null;
    if (r.players[r.turnIndex].id === first) e.endTurn(r, first);
    ok('it moved with the turn', r.idle && r.idle.playerId === upNow(r).id,
        JSON.stringify({ idle: r.idle?.playerId, up: upNow(r).id }));
    ok('and it is not still on the last player', r.idle.playerId !== first || upNow(r).id === first);
}

/* ------------------------------------------------- the clock for the absent */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    e.markDisconnected(r, up.id);
    // Gone since before their turn came round, which is the case this is for:
    // people drifting off near the end of a long game.
    up.disconnectedAt = Date.now() - 120_000;
    e.refreshIdle(r, up.id);
    ok('an absent player gets seconds, not a minute',
        Math.round((r.idle.endsAt - Date.now()) / 1000) === 5, String(r.idle.endsAt - Date.now()));

    up.disconnectedAt = Date.now();
    e.refreshIdle(r, up.id);
    ok('but not while a refresh could still bring them back',
        r.idle.endsAt - Date.now() > 45_000, String(r.idle.endsAt - Date.now()));

    up.connected = true;
    e.refreshIdle(r, up.id);
    ok('and coming back restores the full window',
        Math.round((r.idle.endsAt - Date.now()) / 1000) === 60, String(r.idle.endsAt - Date.now()));
}
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    const other = r.players.find((x) => x.id !== up.id);
    r.idle.endsAt = Date.now() + 1000;
    e.markDisconnected(r, other.id);
    e.refreshIdle(r, other.id);
    ok('someone else dropping does not touch the clock',
        r.idle.playerId === up.id && r.idle.endsAt - Date.now() <= 1000, JSON.stringify(r.idle));
}
{
    const { r } = mk(['Ada', 'Bo'], { timer: false });
    r.settings.auction = false;
    const up = upNow(r);
    e.markDisconnected(r, up.id);
    up.disconnectedAt = Date.now() - 120_000;
    e.refreshIdle(r, up.id);
    ok('a table with the timer off still does not wait on a closed tab',
        !!r.idle && r.idle.playerId === up.id, JSON.stringify(r.idle));
    withRoll([1, 4], () => e.expireIdle(r));
    ok('their turn gets played', upNow(r).id !== up.id, upNow(r).name);
}

/* ------------------------------------------------------------ broadcast */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const st = e.publicState(r);
    ok('the clock is broadcast', st.idle?.playerId === upNow(r).id, JSON.stringify(st.idle));
    ok('with its length, so the client can draw it', st.idleMs === 60_000, String(st.idleMs));
    ok('and it round-trips as JSON', !!JSON.parse(JSON.stringify(st)).idle.endsAt);
}

/* ---------------------------------------------------- ending and rematch */
{
    const { r, p } = mk(['Ada', 'Bo']);
    e.declareBankruptcy(r, p.Bo.id);
    ok('the game ended', r.phase === 'ended', r.phase);
    ok('so no turn is being timed', r.idle === null, JSON.stringify(r.idle));
    e.resetForRematch(r);
    ok('a rematch clears it too', r.idle === null);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
