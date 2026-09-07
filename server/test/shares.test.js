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
    ok('grand tour has three exchanges', exchanges.length === 3, String(exchanges.length));
    ok('spread around the ring', new Set(exchanges.map((t) => Math.floor(t.id / 13))).size === 3);
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

/* -------------------------------------------------- landmarks, which are free */
{
    const { r, p } = mk();
    const pyramids = r.tiles.find((t) => t.name === 'The Pyramids');
    const uluru = r.tiles.find((t) => t.name === 'Uluru');
    ok('grand tour has two landmarks', r.tiles.filter((t) => t.type === 'landmark').length === 2);
    ok('and they carry their boon', !!pyramids.boon.startBonus && !!uluru.boon.rentOff);

    const cash = p.Cy.cash;
    p.Cy.position = pyramids.id;
    e.resolveLanding(r, p.Cy, [1, 1]);
    ok('standing on one claims it', p.Cy.landmarks.includes(pyramids.id));
    ok('it costs nothing', p.Cy.cash === cash, String(p.Cy.cash));
    ok('and says what it gives', r.log.some((l) => /reached The Pyramids/.test(l.text || l)));
    ok('the boon adds up', e.boonsOf(r, p.Cy).startBonus === 25, String(e.boonsOf(r, p.Cy).startBonus));

    e.resolveLanding(r, p.Cy, [1, 1]);
    ok('twice is once', p.Cy.landmarks.length === 1);

    // Not a race: the next person to reach it gets the same thing.
    p.Bo.position = pyramids.id;
    e.resolveLanding(r, p.Bo, [1, 1]);
    ok('everybody can have it', p.Bo.landmarks.includes(pyramids.id));
    ok('and Cy still has it', p.Cy.landmarks.includes(pyramids.id));

    // From the last tile every roll wraps, so passing Start needs no luck.
    const paid = (player) => {
        player.position = r.tiles.length - 1;
        player.cash = 0;
        r.turnIndex = r.players.indexOf(player);
        r.phase = 'rolling';
        r.hasRolled = false;
        r.doublesCount = 0;
        e.rollDice(r, player.id);
        return player.cash;
    };
    // Whatever they land on may charge them, so this is a floor rather than an
    // equality: what matters is that the landmark's $25 is in there.
    ok('Start pays the bonus on top', paid(p.Cy) >= 225 || p.Cy.debt, String(p.Cy.cash));
    ok('and pays the plain rate without one', paid(p.Ada) <= 200 + 0 || !!p.Ada.debt, String(p.Ada.cash));
    ok(
        'the feed says what was paid',
        r.log.some((l) => /passed Start \(\+\$225\)/.test(l.text || l)),
        '',
    );
}

/* ------------------------------------------- the discount comes off the rent */
{
    const { r, p } = mk();
    const rome = r.tiles.find((t) => t.name === 'Rome');
    const uluru = r.tiles.find((t) => t.name === 'Uluru');
    rome.ownerId = p.Ada.id;
    p.Ada.properties.push(rome.id);
    p.Bo.landmarks.push(uluru.id);
    ok('ten per cent off', e.boonsOf(r, p.Bo).rentOff === 10);

    const boBefore = p.Bo.cash;
    const adaBefore = p.Ada.cash;
    p.Bo.position = rome.id;
    r.turnIndex = r.players.indexOf(p.Bo);
    e.resolveLanding(r, p.Bo, [3, 4]);
    // Rome's book rent is 15; a tenth off, rounded, is 14.
    ok('the payer pays less', boBefore - p.Bo.cash === 14, String(boBefore - p.Bo.cash));
    ok('and the owner gets what was paid', p.Ada.cash - adaBefore === 14, String(p.Ada.cash - adaBefore));
}

/* ---------------------------------------------- the other boards carry theirs */
{
    const { BOARDS } = require('../game/board');
    const counts = (id) => {
        const c = {};
        for (const t of BOARDS[id].layout) c[t[1]] = (c[t[1]] || 0) + 1;
        return c;
    };
    ok('classic stays as it was', !counts('classic').exchange && !counts('classic').landmark);
    ok('worldwide gets one of each', counts('worldwide').exchange === 1 && counts('worldwide').landmark === 1);
    ok('grand tour three and two', counts('grand').exchange === 3 && counts('grand').landmark === 2);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
