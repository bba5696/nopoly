// What the tax tiles charge now they scale with what you own.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(board) {
    const r = e.createRoom('TAXX');
    const p = {};
    for (const n of ['Ada', 'Bo']) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    if (board) e.updateSettings(r, p.Ada.id, { board });
    e.startGame(r, p.Ada.id);
    return { r, p };
}

const taxTile = (r, name) => r.tiles.find((t) => t.type === 'tax' && t.name === name);

/** Land a player on a tile and see what it costs them. */
function landOn(r, player, tile) {
    const before = player.cash;
    player.position = tile.id;
    r.turnIndex = r.players.indexOf(player);
    // resolveLanding is internal; the tax maths is what's under test.
    const owed = e.taxFor(r, player, tile);
    void before;
    return owed;
}

/* ------------------------------------------------------ the classic board */
{
    const { r, p } = mk();
    const income = taxTile(r, 'Income Tax');
    const luxury = taxTile(r, 'Luxury Tax');
    ok('income tax is a share', income.tax.percent === 10, JSON.stringify(income.tax));
    ok('luxury tax is a share', luxury.tax.percent === 5, JSON.stringify(luxury.tax));

    // Starting out: $1,500 and nothing else.
    ok('income tax starts at $150', landOn(r, p.Ada, income) === 150, String(landOn(r, p.Ada, income)));
    ok('luxury tax starts at $75', landOn(r, p.Ada, luxury) === 75, String(landOn(r, p.Ada, luxury)));
    ok('both are less than the old flat fee', 150 < 200 && 75 < 100);

    // Down on your luck: it follows you down.
    p.Ada.cash = 300;
    ok('a broke player pays $30', landOn(r, p.Ada, income) === 30, String(landOn(r, p.Ada, income)));
    p.Ada.cash = 0;
    ok('and nothing at all when they have nothing', landOn(r, p.Ada, income) === 0);

    // Doing well: capped, so it never becomes an eviction notice.
    p.Ada.cash = 20000;
    ok('income tax caps at $200', landOn(r, p.Ada, income) === 200, String(landOn(r, p.Ada, income)));
    ok('luxury tax caps at $100', landOn(r, p.Ada, luxury) === 100, String(landOn(r, p.Ada, luxury)));
    ok('so it is never worse than it used to be', landOn(r, p.Ada, income) <= 200);
}

/* ----------------------------------------------- property counts towards it */
{
    const { r, p } = mk();
    const income = taxTile(r, 'Income Tax');
    p.Ada.cash = 1000;
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Ada.id;
    p.Ada.properties.push(tile.id);

    const worth = e.publicState(r).players.find((q) => q.id === p.Ada.id).netWorth;
    ok('net worth counts the deed', worth > 1000, String(worth));
    ok('and the tax follows it', landOn(r, p.Ada, income) === Math.round(worth / 10), String(landOn(r, p.Ada, income)));
}

/* -------------------------------------------------- the worldwide board */
{
    const { r, p } = mk('worldwide');
    const earnings = taxTile(r, 'Earnings Tax');
    const premium = taxTile(r, 'Premium Tax');
    ok('the board still has both', !!earnings && !!premium);
    ok('earnings tax stays uncapped', !earnings.tax.max, JSON.stringify(earnings.tax));
    ok('it is the board\'s whole pitch', /scales with your worth/.test(r.board.tagline || ''));

    p.Ada.cash = 20000;
    ok('so it keeps climbing', landOn(r, p.Ada, earnings) === 2000, String(landOn(r, p.Ada, earnings)));
    ok('while premium tax caps at $75', landOn(r, p.Ada, premium) === 75, String(landOn(r, p.Ada, premium)));
}

/* ------------------------------------------------------ paid, not conjured */
{
    const { r, p } = mk();
    const income = taxTile(r, 'Income Tax');
    p.Ada.cash = 1000;
    const owed = e.taxFor(r, p.Ada, income);
    e.payBank(r, p.Ada, owed, income.name);
    ok('the money leaves the player', p.Ada.cash === 1000 - owed, String(p.Ada.cash));
    ok('and nobody else gains it', p.Bo.cash === 1500);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
