// The fairness check runs in the browser, so it's imported straight from the
// client source. Only the thresholds matter here: a warning that fires on a
// normal trade is worse than one that misses a silly one.
const { lopsidedFor, sideValue } = await import(
    new URL('../../client/src/lib/rent.js', import.meta.url).href
);

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const state = {
    settings: {},
    players: [{ id: 'me' }, { id: 'them' }],
    tiles: [
        { id: 0, price: 60, houseCost: 50, houses: 0 },
        { id: 1, price: 200, houseCost: 100, houses: 0 },
        { id: 2, price: 400, houseCost: 200, houses: 0 },
        { id: 3, price: 200, houseCost: 100, houses: 3 },
    ],
};
// `give` is the sender's side (what I receive); `get` is mine (what I hand over).
const trade = (give, get, toId = 'me') => ({ toId, give, get });
const cash = (n) => ({ cash: n, tiles: [] });
const tiles = (...ids) => ({ cash: 0, tiles: ids });

ok('value counts cash', sideValue(state, cash(300)) === 300);
ok('value counts deeds', sideValue(state, tiles(1)) === 200);
ok('value counts buildings at cost', sideValue(state, tiles(3)) === 200 + 300, String(sideValue(state, tiles(3))));

/* --------------------------------------------------------------- no warning */
ok('an even trade is fine', !lopsidedFor(state, trade(cash(200), cash(200)), 'me'));
ok('a slightly worse trade is fine', !lopsidedFor(state, trade(cash(200), cash(260)), 'me'));
ok('a small absolute gap is fine even at a bad ratio',
    !lopsidedFor(state, trade(cash(10), cash(100)), 'me'), 'floor should suppress this');
ok('a trade in my favour never warns', !lopsidedFor(state, trade(cash(900), cash(60)), 'me'));
ok('a free gift to me never warns', !lopsidedFor(state, trade(tiles(2), cash(0)), 'me'));
ok('deed for comparable deed is fine', !lopsidedFor(state, trade(tiles(1), tiles(1)), 'me'));

/* ------------------------------------------------------------ warning fires */
ok('handing over a $400 deed for nothing warns', !!lopsidedFor(state, trade(cash(0), tiles(2)), 'me'));
ok('$400 deed for $60 deed warns', !!lopsidedFor(state, trade(tiles(0), tiles(2)), 'me'));
ok('a built-up property for pocket change warns', !!lopsidedFor(state, trade(cash(50), tiles(3)), 'me'));
ok('cash for much more cash warns', !!lopsidedFor(state, trade(cash(100), cash(600)), 'me'));

const flagged = lopsidedFor(state, trade(cash(100), cash(600)), 'me');
ok('it reports both sides', flagged.giving === 600 && flagged.getting === 100, JSON.stringify(flagged));
ok('and the gap', flagged.gap === 500);

/* ---------------------------------------------------------------- scoping */
ok('the sender is never warned', !lopsidedFor(state, trade(tiles(2), cash(0), 'them'), 'me'));
ok('a bystander is never warned', !lopsidedFor(state, trade(cash(0), tiles(2)), 'someone-else'));
ok('a missing trade is safe', !lopsidedFor(state, null, 'me'));

/* --------------------------------- the exact boundary, so the numbers are real */
ok('1.5x with a big gap warns', !!lopsidedFor(state, trade(cash(400), cash(600)), 'me'));
ok('just under 1.5x does not', !lopsidedFor(state, trade(cash(410), cash(600)), 'me'));

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
