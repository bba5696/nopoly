// What an auction panel says is at stake. It runs in the browser, so it is
// imported straight from the client source — the same arrangement as
// lopsided.mjs, and for the same reason: a second copy of these rules in a test
// would only ever prove the copy right.
//
// The thing being checked is the sentence the table bids against — "Bo would
// complete Italy" — and the colour the board lights the country in depends on
// the same answer. Getting it wrong is worse than not saying it at all.
const { lotGroup, lotGroupName, lotRent, lotStakes } = await import(
    new URL('../../client/src/lib/auction.js', import.meta.url).href
);

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

/**
 * Three countries of two, three and one, plus the airports — and a board that
 * charges for them, since the rent line reads the live tables.
 */
const board = {
    airportRent: [25, 50, 100, 200],
    utilityMultiplier: [4, 10],
    groups: { italy: { name: 'Italy', color: '#ff5c7c' } },
};

const make = (over = {}) => ({
    settings: { doubleRent: true, teams: false },
    board,
    players: [{ id: 'ada' }, { id: 'bo' }, { id: 'cy' }],
    tiles: [
        { id: 0, name: 'Venice', type: 'property', groupId: 'italy', ownerId: null, rent: [10, 50, 150, 450, 625, 750] },
        { id: 1, name: 'Milan', type: 'property', groupId: 'italy', ownerId: null, rent: [12, 60, 180, 500, 700, 900] },
        { id: 2, name: 'Rome', type: 'property', groupId: 'italy', ownerId: null, rent: [14, 70, 200, 550, 750, 950] },
        { id: 3, name: 'Lyon', type: 'property', groupId: 'france', ownerId: null, rent: [10, 50, 150, 450, 625, 750] },
        { id: 4, name: 'Paris', type: 'property', groupId: 'france', ownerId: null, rent: [10, 50, 150, 450, 625, 750] },
        { id: 5, name: 'JFK', type: 'airport', ownerId: null },
        { id: 6, name: 'CDG', type: 'airport', ownerId: null },
        { id: 7, name: 'MUC', type: 'airport', ownerId: null },
        { id: 8, name: 'GZA', type: 'airport', ownerId: null },
        { id: 9, name: 'Water', type: 'utility', ownerId: null },
        { id: 10, name: 'Electric', type: 'utility', ownerId: null },
    ],
    ...over,
});

const owned = (state, ids, who) => {
    for (const id of ids) state.tiles[id].ownerId = who;
    return state;
};

/* ------------------------------------------------------------- the grouping */
{
    const s = make();
    ok('a country is its own tiles', lotGroup(s, s.tiles[0]).map((t) => t.id).join() === '0,1,2');
    ok('an airport groups with every airport', lotGroup(s, s.tiles[5]).length === 4);
    ok('a utility groups with every utility', lotGroup(s, s.tiles[9]).length === 2);
    ok('a country is named', lotGroupName(s, s.tiles[0], board) === 'Italy');
    ok('the airports are named as a set', lotGroupName(s, s.tiles[5], board) === 'the airports');
}

/* --------------------------------------------------------------- the stakes */
{
    const s = make();
    const venice = s.tiles[0];
    ok('an empty country holds nothing yet', lotStakes(s, venice, 'bo').held === 0);
    ok('and winning it is one of three', lotStakes(s, venice, 'bo').after === 1);
    ok('which is not a set', lotStakes(s, venice, 'bo').completes === false);

    owned(s, [1], 'bo');
    ok('one held is counted', lotStakes(s, venice, 'bo').held === 1);
    ok('and is still not a set', lotStakes(s, venice, 'bo').completes === false);
    ok("a rival's deed is not counted for you", lotStakes(s, venice, 'cy').held === 0);

    owned(s, [2], 'bo');
    ok('the last one completes it', lotStakes(s, venice, 'bo').completes === true);
    ok('for them and nobody else', lotStakes(s, venice, 'cy').completes === false);
}

/* ------------------------------------------------- teams count as one holder */
{
    const s = make({
        settings: { doubleRent: true, teams: true },
        players: [
            { id: 'ada', teamId: 'A' },
            { id: 'bo', teamId: 'A' },
            { id: 'cy', teamId: 'B' },
        ],
    });
    owned(s, [1, 2], 'ada');
    ok("a teammate's deeds complete your set", lotStakes(s, s.tiles[0], 'bo').completes === true);
    ok('an opponent still completes nothing', lotStakes(s, s.tiles[0], 'cy').completes === false);
}

/* ------------------------------------------------- a country of two, and one */
{
    const s = make();
    owned(s, [3], 'bo');
    ok('a pair completes on the second', lotStakes(s, s.tiles[4], 'bo').completes === true);
    // A lone tile is not a set, and saying "you would hold 1 of 1" about a
    // utility that is not the last utility would be nonsense.
    const alone = make({ tiles: [{ id: 0, name: 'Solo', type: 'property', groupId: 'solo', ownerId: null, rent: [10] }] });
    ok('a country of one is never a set', lotStakes(alone, alone.tiles[0], 'bo').completes === false);
}

/* ------------------------------------------------------------------ the rent */
{
    const s = make();
    ok('an unfinished country has no rent line', lotRent(s, s.tiles[0], 'bo') === null);

    owned(s, [1, 2], 'bo');
    const rent = lotRent(s, s.tiles[0], 'bo');
    ok('completing one does', !!rent);
    ok('and it doubles the printed rent', rent.now === '$10' && rent.then === '$20', JSON.stringify(rent));

    // The market can be charging above book while the tile is still loose; the
    // "now" half has to be what it is really charging, or the jump reads wrong.
    const hot = make();
    hot.tiles[0].marketRentMult = 1.5;
    owned(hot, [1, 2], 'bo');
    ok('the live price is the one it is charging now', lotRent(hot, hot.tiles[0], 'bo').now === '$15');

    // House rules are off: without double rent a full set changes nothing until
    // somebody builds, so there is nothing to promise.
    const plain = make({ settings: { doubleRent: false, teams: false } });
    owned(plain, [1, 2], 'bo');
    ok('no rent line when full sets do not pay double', lotRent(plain, plain.tiles[0], 'bo') === null);
}

/* ------------------------------------- airports and utilities move every time */
{
    const s = make();
    const jfk = s.tiles[5];
    ok('the first airport has no rent to compare', lotRent(s, jfk, 'bo').now === '—');
    ok('and would charge the first step', lotRent(s, jfk, 'bo').then === '$25');

    owned(s, [6], 'bo');
    const second = lotRent(s, jfk, 'bo');
    ok('a second airport doubles it', second.now === '$25' && second.then === '$50', JSON.stringify(second));
    ok('and says how many of them that is', second.why === '2 of 4');

    owned(s, [7, 8], 'bo');
    ok('holding the rest is the top step', lotRent(s, jfk, 'bo').then === '$200');

    const u = make();
    owned(u, [10], 'bo');
    ok('utilities read in dice', lotRent(u, u.tiles[9], 'bo').then === '×10 dice');
}

/* ----------------------------------------------------------------- nobody yet */
{
    const s = make();
    ok('no bidder, no rent line', lotRent(s, s.tiles[0], null) === null);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
