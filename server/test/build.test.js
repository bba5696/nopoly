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
/* --------------------------------------------- a whole country in one action */
{
    const { r } = mk(['Ada', 'Bo']);
    const set = aSet(r);
    const up = upNow(r);
    give(r, up, set);
    const g = set[0].groupId;
    const cost = set[0].houseCost;

    up.cash = 100000;
    ok('a country goes up in one call', !e.buildSetTo(r, up.id, g, 3).error);
    ok('and every tile in it reaches the level', set.every((t) => t.houses === 3), set.map((t) => t.houses).join());
    ok('paying for each house', up.cash === 100000 - set.length * 3 * cost, String(up.cash));

    ok('asking for what it already has is refused', !!e.buildSetTo(r, up.id, g, 2).error);
    ok('and changes nothing', set.every((t) => t.houses === 3));

    ok('hotels are the top', !e.buildSetTo(r, up.id, g, 9).error);
    ok('and every tile gets one', set.every((t) => t.houses === 5));
    ok('with nothing left to build', !!e.buildSetTo(r, up.id, g, 5).error);
}

/* ------------------------------------------- it stops where the money stops */
{
    const { r } = mk(['Ada', 'Bo']);
    const set = aSet(r);
    const up = upNow(r);
    give(r, up, set);
    const cost = set[0].houseCost;

    // Enough for one house each and a little over.
    up.cash = set.length * cost + Math.floor(cost / 2);
    ok('a short purse still builds what it can', !e.buildSetTo(r, up.id, set[0].groupId, 5).error);
    ok('one house each, evenly', set.every((t) => t.houses === 1), set.map((t) => t.houses).join());
    ok('and it spent what it had', up.cash === Math.floor(cost / 2), String(up.cash));
    ok('a purse that cannot afford one house is told so', !!e.buildSetTo(r, up.id, set[0].groupId, 5).error);
}

/* ------------------------------------------------------ the same guards hold */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const set = aSet(r);
    const up = upNow(r);
    const idle = r.players.find((q) => q.id !== up.id);
    give(r, up, set);
    up.cash = 100000;
    idle.cash = 100000;
    const g = set[0].groupId;

    ok('off-turn is refused', !!e.buildSetTo(r, idle.id, g, 3).error);
    ok('a country you do not hold is refused', !!e.buildSetTo(r, idle.id, 'nowhere', 3).error);

    up.debt = { amount: 50, toId: null, bailout: null };
    ok('a debt blocks it', !!e.buildSetTo(r, up.id, g, 3).error);
    up.debt = null;

    r.paused = true;
    ok('a paused game blocks it', !!e.buildSetTo(r, up.id, g, 3).error);
    r.paused = false;

    r.boughtBackBy = up.id;
    ok('a share bought back this turn blocks it', !!e.buildSetTo(r, up.id, g, 3).error);
    r.boughtBackBy = null;

    ok('and otherwise it goes through', !e.buildSetTo(r, up.id, g, 2).error);
    ok('leaving the set even', set.every((t) => t.houses === 2));
}

/* ------------------------------------------------------------ selling it back */
{
    const { r } = mk(['Ada', 'Bo']);
    const set = aSet(r);
    const up = upNow(r);
    const idle = r.players.find((q) => q.id !== up.id);
    give(r, up, set);
    const g = set[0].groupId;
    const cost = set[0].houseCost;
    up.cash = 100000;
    e.buildSetTo(r, up.id, g, 4);

    up.cash = 0;
    ok('a country sells down to a level', !e.sellSetTo(r, up.id, g, 2).error);
    ok('evenly', set.every((t) => t.houses === 2), set.map((t) => t.houses).join());
    ok('at half what they cost', up.cash === set.length * 2 * Math.floor(cost / 2), String(up.cash));

    // Selling is the one half that is not turn-gated: rent lands on you during
    // somebody else's turn, and this is how it gets paid.
    r.turnIndex = r.players.findIndex((q) => q.id === idle.id);
    ok('selling off-turn is allowed', !e.sellSetTo(r, up.id, g, 1).error);
    ok(
        'and a debt does not block it',
        (() => {
            up.debt = { amount: 10, toId: null, bailout: null };
            const res = e.sellSetTo(r, up.id, g, 0);
            up.debt = null;
            return !res.error;
        })(),
    );
    ok('selling everything clears the set', set.every((t) => t.houses === 0));
    ok('with nothing left to sell', !!e.sellSetTo(r, up.id, g, 0).error);
    ok('and a stranger cannot sell yours', !!e.sellSetTo(r, idle.id, g, 0).error);
}

/* ------------------------------------------------ the bank runs out of houses */
{
    // The rule is set before the game starts in a lobby; these tests build the
    // room by hand, so the setting goes on directly.
    const { r } = mk(['Ada', 'Bo']);
    r.settings.limitedBuildings = true;
    const up = upNow(r);
    up.cash = 1000000;

    const stock0 = e.buildingStock(r);
    ok('the bank starts full', stock0.housesLeft === 20 && stock0.hotelsLeft === 8, JSON.stringify(stock0));

    // Every country on the board, so the only thing that can stop the building
    // is the bank.
    for (const t of r.tiles) {
        if (t.type !== 'property') continue;
        t.ownerId = up.id;
        up.properties.push(t.id);
    }
    const groups = [...new Set(r.tiles.filter((t) => t.type === 'property' && t.groupId).map((t) => t.groupId))];
    let refused = null;
    for (const g of groups) {
        const res = e.buildSetTo(r, up.id, g, 4);
        if (res.error) {
            refused = res.error;
            break;
        }
    }

    const stock = e.buildingStock(r);
    ok('the board never holds more than twenty houses', stock.houses === 20, String(stock.houses));
    ok('and the bank is empty rather than negative', stock.housesLeft === 0, JSON.stringify(stock));
    ok('with money still in hand, so it was the bank that stopped it', up.cash > 100000, String(up.cash));
    ok('the next country is refused', !!refused, String(refused));
    ok('and it says which building ran out', /no houses left/.test(refused || ''), String(refused));

    // One house back in the bank is one house somebody else can build.
    const built = r.tiles.find((t) => t.houses > 0);
    e.sellHouse(r, up.id, built.id);
    ok('selling one frees one', e.buildingStock(r).housesLeft === 1);
}

/* ------------------------------- a hotel hands its houses back to the bank */
{
    const { r } = mk(['Ada', 'Bo']);
    r.settings.limitedBuildings = true;
    const up = upNow(r);
    up.cash = 1000000;
    const set = aSet(r);
    give(r, up, set);

    e.buildSetTo(r, up.id, set[0].groupId, 4);
    ok('the set is at four each', set.every((t) => t.houses === 4));
    const before = e.buildingStock(r).housesLeft;

    e.buildHouse(r, up.id, set[0].id);
    const after = e.buildingStock(r);
    ok('crowning a hotel spends one', after.hotelsLeft === 7, String(after.hotelsLeft));
    ok('and hands its four houses back', after.housesLeft === before + 4, `${before} -> ${after.housesLeft}`);
    ok('so a board with no houses left can still crown one', true);
}

/* ------------------------- with no houses to break it into, a hotel is razed */
{
    const { r } = mk(['Ada', 'Bo']);
    r.settings.limitedBuildings = true;
    const up = upNow(r);
    up.cash = 1000000;
    const set = aSet(r);
    give(r, up, set);
    const cost = set[0].houseCost;

    e.buildSetTo(r, up.id, set[0].groupId, 5);
    ok('the set is hotels', set.every((t) => t.houses === 5));

    // Park every remaining house on tiles nobody is testing, four at a time,
    // so the bank is genuinely empty rather than holding an impossible pile.
    const spare = r.tiles.filter((t) => t.type === 'property' && t.groupId !== set[0].groupId);
    for (const t of spare) {
        const left = e.buildingStock(r).housesLeft;
        if (!left) break;
        t.houses = Math.min(4, left);
    }
    ok('the bank is empty of houses', e.buildingStock(r).housesLeft === 0, JSON.stringify(e.buildingStock(r)));

    up.cash = 0;
    e.sellHouse(r, up.id, set[0].id);
    ok('the hotel is gone rather than broken up', set[0].houses === 0, String(set[0].houses));
    ok('and it was paid for all five levels', up.cash === Math.floor(cost / 2) * 5, String(up.cash));
    ok('the feed says why', r.log.some((l) => /no houses left to break it into/.test(l.text)));

    // Houses back in the bank, and the next hotel breaks up the ordinary way.
    for (const t of spare) t.houses = 0;
    up.cash = 0;
    e.sellHouse(r, up.id, set[1].id);
    ok('a hotel with houses available becomes four', set[1].houses === 4, String(set[1].houses));
    ok('paid for one level', up.cash === Math.floor(cost / 2), String(up.cash));
}

/* ---------------------------------- a debt can always be sold down to money */
{
    // The reason a razed hotel pays for all five: somebody owing money must
    // never be holding buildings the rules will not let them turn into it.
    const { r } = mk(['Ada', 'Bo']);
    r.settings.limitedBuildings = true;
    const up = upNow(r);
    up.cash = 1000000;
    const set = aSet(r);
    give(r, up, set);
    e.buildSetTo(r, up.id, set[0].groupId, 5);
    for (const t of r.tiles.filter((t) => t.type === 'property' && t.groupId !== set[0].groupId)) {
        const left = e.buildingStock(r).housesLeft;
        if (!left) break;
        t.houses = Math.min(4, left);
    }

    up.cash = 0;
    ok('every hotel can still be sold', set.every((t) => !e.sellHouse(r, up.id, t.id).error));
    ok('and they all came down', set.every((t) => t.houses === 0), set.map((t) => t.houses).join());
    ok('for real money', up.cash > 0, String(up.cash));
}

/* ------------------------------------------- and the table can switch it off */
{
    const { r } = mk(['Ada', 'Bo']);
    const up = upNow(r);
    up.cash = 1000000;
    ok('off by default', r.settings.limitedBuildings === false);
    ok('and the stock says so', e.buildingStock(r).limited === false);

    for (const t of r.tiles) {
        if (t.type !== 'property') continue;
        t.ownerId = up.id;
        up.properties.push(t.id);
    }
    const groups = [...new Set(r.tiles.filter((t) => t.type === 'property' && t.groupId).map((t) => t.groupId))];
    for (const g of groups) e.buildSetTo(r, up.id, g, 5);
    const hotels = r.tiles.filter((t) => t.houses === 5).length;
    ok('with the rule off there is no ceiling', hotels > 8, `${hotels} hotels`);
}


console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
