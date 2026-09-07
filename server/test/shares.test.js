// The exchange: shares in somebody else's country.
//
// The rules worth pinning down are the ones about money going where it should
// — a quarter of the rent and no more, out of what the owner actually got
// rather than out of the bank, and never in a circle back to the person who
// paid it.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names = ['Ada', 'Bo', 'Cy']) {
    const r = e.createRoom('SHAR');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    e.updateSettings(r, p[names[0]].id, { board: 'grand' });
    e.startGame(r, p[names[0]].id);
    return { r, p };
}

const tile = (r, name) => r.tiles.find((t) => t.name === name);
/** Put someone on an exchange square the way landing on one would. */
function atExchange(r, player) {
    const ex = r.tiles.find((t) => t.type === 'exchange');
    r.turnIndex = r.players.indexOf(player);
    r.pendingAction = { type: 'exchange', playerId: player.id, tileId: ex.id };
    return ex;
}

/* ------------------------------------------------- the board carries them */
{
    const { r } = mk();
    const exchanges = r.tiles.filter((t) => t.type === 'exchange');
    ok('grand tour has four exchanges', exchanges.length === 4, String(exchanges.length));
    ok('one per side', new Set(exchanges.map((t) => Math.floor(t.id / 13))).size === 4);
    // Italy: 170 + 170 + 180 + 190 = 710, a fifth of it to the nearest ten.
    ok('a share is a fifth of the country', e.sharePrice(r, 'italy') === 140, String(e.sharePrice(r, 'italy')));
    ok('the cheap sets are cheap', e.sharePrice(r, 'lebanon') === 20, String(e.sharePrice(r, 'lebanon')));
}

/* ------------------------------------------------------------- buying one */
{
    const { r, p } = mk();
    ok('you cannot buy from the sofa', !!e.buyShare(r, p.Cy.id, 'italy').error);

    atExchange(r, p.Cy);
    const before = p.Cy.cash;
    const res = e.buyShare(r, p.Cy.id, 'italy');
    ok('landing on one lets you buy', !res.error, res.error);
    ok('it costs what it says', p.Cy.cash === before - 140, String(p.Cy.cash));
    ok('and is held', e.sharesOf(r, p.Cy.id).length === 1);
    ok('the screen closes behind you', r.pendingAction === null);
    ok('the log says so', r.log.some((l) => /Cy bought a 25% share in Italy for \$140/.test(l.text || l)), '');

    atExchange(r, p.Cy);
    ok('one each per country', /already hold/.test(e.buyShare(r, p.Cy.id, 'italy').error || ''));
    atExchange(r, p.Bo);
    ok('somebody else can take the second', !e.buyShare(r, p.Bo.id, 'italy').error);
    atExchange(r, p.Ada);
    ok('but not a third', /no shares left/.test(e.buyShare(r, p.Ada.id, 'italy').error || ''));

    atExchange(r, p.Ada);
    ok('nor a country that is not there', !!e.buyShare(r, p.Ada.id, 'atlantis').error);
    p.Ada.cash = 5;
    atExchange(r, p.Ada);
    ok('nor one you cannot afford', /costs \$/.test(e.buyShare(r, p.Ada.id, 'china').error || ''));

    atExchange(r, p.Bo);
    ok('and you can walk away', !e.leaveExchange(r, p.Bo.id).error && r.pendingAction === null);
}

/* --------------------------------------------------------- the rent split */
{
    const { r, p } = mk();
    const rome = tile(r, 'Rome');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'italy');

    const adaBefore = p.Ada.cash;
    const cyBefore = p.Cy.cash;
    const boBefore = p.Bo.cash;

    p.Bo.position = rome.id;
    r.turnIndex = r.players.indexOf(p.Bo);
    e.resolveLanding(r, p.Bo, [3, 4]);

    const rent = boBefore - p.Bo.cash;
    ok('the payer pays the book rent', rent === 15, String(rent));
    ok('the shareholder takes a quarter', p.Cy.cash - cyBefore === 4, String(p.Cy.cash - cyBefore));
    ok('the owner keeps the rest', p.Ada.cash - adaBefore === 11, String(p.Ada.cash - adaBefore));
    ok('and no money was invented', rent === (p.Cy.cash - cyBefore) + (p.Ada.cash - adaBefore));
    ok(
        'the feed names the cut',
        r.log.some((l) => /25% share in Italy/.test(l.text || l)),
        '',
    );
}

/* ------------------------- two shares halve it, and no further */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const rome = tile(r, 'Rome');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    r.shares = [
        { groupId: 'italy', holderId: p.Cy.id, paid: 140 },
        { groupId: 'italy', holderId: p.Di.id, paid: 140 },
    ];
    const adaBefore = p.Ada.cash;
    p.Bo.position = rome.id;
    r.turnIndex = r.players.indexOf(p.Bo);
    e.resolveLanding(r, p.Bo, [3, 4]);
    ok('the owner is left with half', p.Ada.cash - adaBefore === 15 - 4 - 4, String(p.Ada.cash - adaBefore));
}

/* ------------------------- a rent half-paid is a share of what was paid */
{
    const { r, p } = mk();
    const rome = tile(r, 'Rome');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    r.shares = [{ groupId: 'italy', holderId: p.Cy.id, paid: 140 }];
    // Bo has four dollars and owes fifteen; only the four ever arrive, so a
    // quarter of four is all the share is worth here.
    p.Bo.cash = 4;
    const adaBefore = p.Ada.cash;
    const cyBefore = p.Cy.cash;
    p.Bo.position = rome.id;
    r.turnIndex = r.players.indexOf(p.Bo);
    e.resolveLanding(r, p.Bo, [3, 4]);
    ok('the shareholder gets a quarter of what arrived', p.Cy.cash - cyBefore === 1, String(p.Cy.cash - cyBefore));
    ok('and the owner the other three', p.Ada.cash - adaBefore === 3, String(p.Ada.cash - adaBefore));
    ok('the shortfall is the payer’s problem', !!p.Bo.debt || p.Bo.bankrupt);
}

/* ------------------------------------------- your own share pays you nothing */
{
    const { r, p } = mk();
    const rome = tile(r, 'Rome');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    atExchange(r, p.Ada);
    e.buyShare(r, p.Ada.id, 'italy');
    ok('you may hold a share in your own country', e.sharesOf(r, p.Ada.id).length === 1);
    ok('which uses one of the two', e.sharesIn(r, 'italy').length === 1);
}

/* -------------------------------------------------------------- buying back */
{
    const { r, p } = mk();
    const rome = tile(r, 'Rome');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'italy');

    ok('a stranger cannot buy it back', /no deeds/.test(e.buyBackShare(r, p.Bo.id, 'italy').error || ''));
    const adaBefore = p.Ada.cash;
    const cyBefore = p.Cy.cash;
    const res = e.buyBackShare(r, p.Ada.id, 'italy');
    ok('the deed holder can', !res.error, res.error);
    ok('at half again what it cost', p.Ada.cash === adaBefore - 210, String(adaBefore - p.Ada.cash));
    ok('which the shareholder gets', p.Cy.cash === cyBefore + 210, String(p.Cy.cash - cyBefore));
    ok('and the share is gone', e.sharesIn(r, 'italy').length === 0);
    ok('nothing left to buy back', !!e.buyBackShare(r, p.Ada.id, 'italy').error);

    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'italy');
    p.Ada.cash = 10;
    ok('and it has to be affordable', /costs \$210/.test(e.buyBackShare(r, p.Ada.id, 'italy').error || ''));
}

/* ------------------------------------------------- selling, and paying debts */
{
    const { r, p } = mk();
    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'china');
    const price = e.sharePrice(r, 'china');
    const before = p.Cy.cash;
    ok('a share is worth what it cost', e.shareValue(r, p.Cy) === price, String(e.shareValue(r, p.Cy)));
    ok('and counts towards net worth', e.netWorth(r, p.Cy) >= before + price);

    ok('you can only sell your own', !!e.sellShare(r, p.Bo.id, 'china').error);
    ok('selling gives the money back', !e.sellShare(r, p.Cy.id, 'china').error && p.Cy.cash === before + price);
    ok('and the share is gone', e.sharesOf(r, p.Cy.id).length === 0);
}

/* ------------------------------ a share is money you can reach, when in debt */
{
    const { r, p } = mk(['Ada', 'Bo']);
    atExchange(r, p.Bo);
    e.buyShare(r, p.Bo.id, 'china');
    const share = e.sharePrice(r, 'china');

    // Left with less cash than the bill, but the share covers the difference:
    // the engine must offer the debt rather than declare bankruptcy.
    p.Bo.cash = 10;
    e.payBank(r, p.Bo, 10 + share - 20, 'a very large bill');
    ok('the debt stands rather than ending them', !p.Bo.bankrupt && !!p.Bo.debt, JSON.stringify(p.Bo.debt));
    e.sellShare(r, p.Bo.id, 'china');
    ok('and selling the share settles it', !p.Bo.debt, JSON.stringify(p.Bo.debt));
}

/* --------------------------------------------- bankruptcy returns the share */
{
    const { r, p } = mk();
    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'china');
    e.declareBankruptcy(r, p.Cy.id);
    ok('a bankrupt holder gives it up', e.sharesIn(r, 'china').length === 0);
}

/* ---------------------------------------------------------- the public state */
{
    const { r, p } = mk();
    atExchange(r, p.Cy);
    e.buyShare(r, p.Cy.id, 'china');
    const st = e.publicState(r);
    ok('the state carries the shares', st.shares.length === 1 && st.shares[0].groupId === 'china');
    ok('and what one costs', st.sharePrices.china === e.sharePrice(r, 'china'));
    ok('and the terms', st.shareCut === 0.25 && st.sharesPerGroup === 2 && st.buybackMult === 1.5);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
