// Who may build, on whose property, and when.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { teams = false } = {}) {
    const r = e.createRoom('BILD');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    if (teams) e.updateSettings(r, p[names[0]].id, { teams: true });
    e.startGame(r, p[names[0]].id);
    return { r, p };
}

/** The first complete colour set on the board, as a list of tiles. */
function aSet(r) {
    const byGroup = new Map();
    for (const t of r.tiles) {
        if (t.type !== 'property' || !t.groupId) continue;
        if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
        byGroup.get(t.groupId).push(t);
    }
    return [...byGroup.values()].find((g) => g.length >= 2);
}

/** Hand a set to a player outright. */
function give(r, player, tiles) {
    for (const t of tiles) {
        t.ownerId = player.id;
        if (!player.properties.includes(t.id)) player.properties.push(t.id);
    }
}

/** Whoever the engine says is up. */
const upNow = (r) => r.players[r.turnIndex];

/* ---------------------------------------------------------- your own turn */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    const set = aSet(r);
    // Give it to whoever is *not* up first.
    const idle = r.players.find((q) => q.id !== upNow(r).id);
    give(r, idle, set);
    idle.cash = 5000;

    const res = e.buildHouse(r, idle.id, set[0].id);
    ok('building off-turn is refused', !!res.error, JSON.stringify(res));
    ok('and nothing was built', set[0].houses === 0);
    ok('and nothing was charged', idle.cash === 5000);

    // Hand them the turn and it goes through.
    r.turnIndex = r.players.findIndex((q) => q.id === idle.id);
    ok('on their own turn it works', !e.buildHouse(r, idle.id, set[0].id).error);
    ok('a house went up', set[0].houses === 1);
    ok('and it was paid for', idle.cash === 5000 - set[0].houseCost);
}

/* ------------------------------------------- selling stays available always */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    const set = aSet(r);
    const idle = r.players.find((q) => q.id !== upNow(r).id);
    give(r, idle, set);
    for (const t of set) t.houses = 2;

    // Rent lands on you during someone else's turn, so raising cash has to work
    // then too.
    ok('selling a building off-turn is fine', !e.sellHouse(r, idle.id, set[0].id).error);
    ok('it came down', set[0].houses === 1);

    for (const t of set) t.houses = 0;
    ok('selling a property off-turn is fine', !e.sellProperty(r, idle.id, set[0].id).error);
    ok('it went back to the bank', r.tiles[set[0].id].ownerId === null);
}

/* ------------------------------------------------------- a teammate's set */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { teams: true });
    const mate = r.players.find((q) => q.teamId === p.Ada.teamId && q.id !== p.Ada.id);
    ok('the pair are on a team together', !!mate, JSON.stringify(r.players.map((q) => [q.name, q.teamId])));

    const set = aSet(r);
    give(r, mate, set);            // the deed is entirely the teammate's
    p.Ada.cash = 5000;
    r.turnIndex = r.players.findIndex((q) => q.id === p.Ada.id);

    const res = e.buildHouse(r, p.Ada.id, set[0].id);
    ok('you can build on your teammate\'s deed', !res.error, JSON.stringify(res));
    ok('the house is there', set[0].houses === 1);
    ok('you paid for it', p.Ada.cash === 5000 - set[0].houseCost);
    ok('and the deed did not move', set[0].ownerId === mate.id);

    // But not sell it out from under them.
    ok('you cannot sell it off', !!e.sellHouse(r, p.Ada.id, set[0].id).error);
    ok('nor sell the property', !!e.sellProperty(r, p.Ada.id, set[0].id).error);
    ok('it is still standing', set[0].houses === 1 && set[0].ownerId === mate.id);
}

/* --------------------------------------------- a set split across the team */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { teams: true });
    const mate = r.players.find((q) => q.teamId === p.Ada.teamId && q.id !== p.Ada.id);
    const set = aSet(r);
    // Half each — the set is complete for the team but for neither of them.
    give(r, p.Ada, set.slice(0, 1));
    give(r, mate, set.slice(1));
    p.Ada.cash = 5000;
    r.turnIndex = r.players.findIndex((q) => q.id === p.Ada.id);

    ok('a split set still counts as complete', !e.buildHouse(r, p.Ada.id, set[0].id).error);
    ok('and it built', set[0].houses === 1);
}

/* ------------------------------------------------- still your own turn, teams */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { teams: true });
    const mate = r.players.find((q) => q.teamId === p.Ada.teamId && q.id !== p.Ada.id);
    const set = aSet(r);
    give(r, mate, set);
    p.Ada.cash = 5000;
    // Someone from the other team is up.
    r.turnIndex = r.players.findIndex((q) => q.teamId !== p.Ada.teamId);

    ok('a teammate cannot build during another team\'s turn', !!e.buildHouse(r, p.Ada.id, set[0].id).error);
    ok('nothing went up', set[0].houses === 0);
}

/* ------------------------------------------------------ the other refusals */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    const set = aSet(r);
    const up = upNow(r);
    give(r, up, set);
    up.cash = 5000;

    // Someone else's set entirely.
    const other = r.players.find((q) => q.id !== up.id);
    ok('you cannot build on a stranger\'s property', !!e.buildHouse(r, other.id, set[0].id).error);

    // A debt blocks it even on your own turn.
    up.debt = { amount: 50, toId: null, bailout: null };
    ok('a debt blocks building', !!e.buildHouse(r, up.id, set[0].id).error);
    up.debt = null;

    r.paused = true;
    ok('a paused game blocks building', !!e.buildHouse(r, up.id, set[0].id).error);
    r.paused = false;

    ok('and otherwise it goes through', !e.buildHouse(r, up.id, set[0].id).error);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
