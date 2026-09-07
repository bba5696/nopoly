// What a player is worth, and what that number is made of.
//
// The total is on every rail and drives the percentage taxes, so the parts have
// to add up to it exactly — and the parts are what the client shows when
// somebody doubts the total.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(board) {
    const r = e.createRoom('WRTH');
    const p = {};
    for (const n of ['Ada', 'Bo']) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    if (board) e.updateSettings(r, p.Ada.id, { board });
    e.startGame(r, p.Ada.id);
    return { r, p };
}

/** Hand a deed over without going through a purchase. */
function give(r, player, name) {
    const tile = r.tiles.find((t) => t.name === name);
    tile.ownerId = player.id;
    player.properties.push(tile.id);
    return tile;
}

/* --------------------------------------------------- what is counted, and how */
{
    const { r, p } = mk();
    const ada = p.Ada;
    ok('it starts at the starting cash', e.netWorth(r, ada) === 1500, String(e.netWorth(r, ada)));

    const rome = give(r, ada, 'Rome');       // 160
    const venice = give(r, ada, 'Venice');   // 140
    give(r, ada, 'GZA Airport');             // 200
    give(r, ada, 'Electric Company');        // 150
    ok('every deed counts', e.worthOf(r, ada).deeds === 160 + 140 + 200 + 150, String(e.worthOf(r, ada).deeds));

    // Four houses on one, a hotel on the other: five levels at Rome's $100 and
    // four at Venice's $100.
    rome.houses = 5;
    venice.houses = 4;
    const worth = e.worthOf(r, ada);
    ok('a hotel is five levels of building', worth.buildings === (5 + 4) * 100, String(worth.buildings));
    ok('buildings count at what they cost', worth.buildings === 900);

    ada.jailCards = 2;
    ok('a jail card is worth the fine it saves', e.worthOf(r, ada).jailCards === 100, String(e.worthOf(r, ada).jailCards));

    const parts = e.worthOf(r, ada);
    ok(
        'the parts add up to the total',
        parts.cash + parts.deeds + parts.buildings + parts.shares + parts.jailCards - parts.debt === parts.total,
        JSON.stringify(parts),
    );
    ok('and the total is the net worth', parts.total === e.netWorth(r, ada));
}

/* ------------------------------------------------------- a debt is a liability */
{
    const { r, p } = mk();
    give(r, p.Ada, 'Rome');
    const before = e.netWorth(r, p.Ada);
    p.Ada.cash = 0;
    e.payBank(r, p.Ada, 100, 'a bill');
    const parts = e.worthOf(r, p.Ada);
    ok('the shortfall is owed', parts.debt === 100, JSON.stringify(parts));
    ok('and comes off the total', parts.total === before - 1500 - 100, String(parts.total));
}

/* ------------------------------------------------- shares are worth what they cost */
{
    const { r, p } = mk('grand');
    const ex = r.tiles.find((t) => t.type === 'exchange');
    r.pendingAction = { type: 'exchange', playerId: p.Bo.id, tileId: ex.id };
    const before = e.netWorth(r, p.Bo);
    e.buyShare(r, p.Bo.id, 'italy');
    const parts = e.worthOf(r, p.Bo);
    ok('a share holds its value', parts.shares === e.sharePrice(r, 'italy'), String(parts.shares));
    ok('so buying one changes nothing overall', parts.total === before, `${parts.total} vs ${before}`);
}

/* ------------------------------------------ landmarks are worth nothing on paper */
{
    const { r, p } = mk('grand');
    const pyramids = r.tiles.find((t) => t.type === 'landmark');
    const before = e.netWorth(r, p.Ada);
    p.Ada.position = pyramids.id;
    e.resolveLanding(r, p.Ada, [1, 1]);
    ok('claiming one is free', e.netWorth(r, p.Ada) === before, String(e.netWorth(r, p.Ada)));
}

/* ------------------------------------------------------- what the client is sent */
{
    const { r, p } = mk();
    const rome = give(r, p.Ada, 'Rome');
    rome.houses = 3;
    p.Ada.jailCards = 1;
    const sent = e.publicState(r).players.find((x) => x.id === p.Ada.id);
    ok('the breakdown travels with the total', !!sent.worth, JSON.stringify(sent.worth));
    ok('and agrees with it', sent.worth.total === sent.netWorth);
    ok('itemised', sent.worth.deeds === 160 && sent.worth.buildings === 300 && sent.worth.jailCards === 50, JSON.stringify(sent.worth));
}

/* ------------------------------------ the tax that scales reads the same number */
{
    const { r, p } = mk();
    const income = r.tiles.find((t) => t.name === 'Income Tax');
    const rome = give(r, p.Ada, 'Rome');
    rome.houses = 2;
    // A tenth of everything they own, capped — the point is that the buildings
    // and the deed are in the figure it takes a tenth of.
    const owed = e.taxFor(r, p.Ada, income);
    ok(
        'income tax is a tenth of the whole estate',
        owed === Math.min(Math.round(e.netWorth(r, p.Ada) / 10), 200),
        String(owed),
    );
}

/* ------------------------- the number that answers "can I pay this?" */
{
    // The case that reads as a contradiction on the rail: owing more than the
    // net figure, and covering it anyway. Net worth has the debt already taken
    // off; what pays the bill is the sell-back value, which is a different sum.
    const { r, p } = mk();
    for (const name of ['Rome', 'Milan', 'Venice']) give(r, p.Ada, name).houses = 3;
    p.Ada.cash = 0;
    e.payBank(r, p.Ada, 500, 'a very large bill');

    const w = e.worthOf(r, p.Ada);
    ok('the estate is what they hold', w.estate === w.cash + w.deeds + w.buildings + w.shares + w.jailCards, JSON.stringify(w));
    ok('net worth is the estate less the debt', w.total === w.estate - 500, String(w.total));
    ok('which can be less than the debt', w.total > 0 && w.debt === 500);
    ok('sell-back value is lower than the estate', w.liquid < w.estate, `${w.liquid} vs ${w.estate}`);
    ok('and it is what covers the bill', w.liquid >= 500, String(w.liquid));
    ok('so they are still playing', !p.Ada.bankrupt && !!p.Ada.debt);

    // Selling until it is covered clears the debt, which is what the notice
    // promises when it says the money is there.
    // Bounded, because a refusal here (the even-build rule, say) would
    // otherwise spin forever rather than fail.
    for (let n = 0; n < 40 && p.Ada.debt; n++) {
        // Most-built first, or the even-build rule refuses the sale.
        const id = p.Ada.properties
            .filter((t) => r.tiles[t].houses > 0)
            .sort((x, y) => r.tiles[y].houses - r.tiles[x].houses)[0];
        if (id === undefined) {
            // Buildings gone and still short: the deeds are the rest of it.
            const deed = p.Ada.properties.find((t) => r.tiles[t].houses === 0);
            if (deed === undefined || e.sellProperty(r, p.Ada.id, deed).error) break;
            continue;
        }
        if (e.sellHouse(r, p.Ada.id, id).error) break;
    }
    ok('and selling the buildings settles it', !p.Ada.debt, JSON.stringify(p.Ada.debt));
}

/* ---------------------------------------- when it genuinely cannot be covered */
{
    const { r, p } = mk();
    give(r, p.Ada, 'Rome').houses = 1;
    p.Ada.cash = 0;
    const before = e.worthOf(r, p.Ada).liquid;
    e.payBank(r, p.Ada, before + 100, 'more than they have');
    ok('short is short', p.Ada.bankrupt, `liquid was ${before}`);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
