// The payment event that drives the on-board flash.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk() {
    const r = e.createRoom('PAYX');
    const p = {};
    for (const n of ['Ada', 'Bo']) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    e.startGame(r, p.Ada.id);
    return { r, p };
}

/* -------------------------------------------------------------- rent */
{
    const { r, p } = mk();
    ok('nothing to show at the start', r.lastPayment === null);

    e.transfer(r, p.Ada, p.Bo, 450, 'rent');
    const pay = r.lastPayment;
    ok('a payment is recorded', !!pay, JSON.stringify(pay));
    ok('who paid', pay.fromId === p.Ada.id);
    ok('who was paid', pay.toId === p.Bo.id);
    ok('how much', pay.amount === 450);
    ok('and what for', pay.reason === 'rent');
    ok('the money actually moved', p.Bo.cash === 1500 + 450 && p.Ada.cash === 1500 - 450);

    // The same rent again has to animate again, which is what the counter is for.
    const first = pay.seq;
    e.transfer(r, p.Ada, p.Bo, 450, 'rent');
    ok('an identical payment is a new event', r.lastPayment.seq === first + 1, String(r.lastPayment.seq));
}

/* --------------------------------------------------------- to the bank */
{
    const { r, p } = mk();
    e.payBank(r, p.Ada, 200, 'Income Tax');
    ok('a bank payment is recorded', r.lastPayment.amount === 200);
    ok('with nobody on the other end', r.lastPayment.toId === null);
    ok('and its reason', r.lastPayment.reason === 'Income Tax');
}

/* ------------------------------------------------ only what was really paid */
{
    const { r, p } = mk();
    p.Ada.cash = 120;
    e.transfer(r, p.Ada, p.Bo, 500, 'rent');
    ok('it reports the cash that moved, not the bill', r.lastPayment.amount === 120,
        String(r.lastPayment.amount));
    // Nothing to sell and no teammate, so the shortfall ends them rather than
    // becoming a debt — either way the flash shows what actually changed hands.
    ok('and the shortfall ends them', p.Ada.bankrupt, JSON.stringify({ debt: p.Ada.debt }));
}
{
    // With property to sell it becomes a debt instead, and the flash still
    // reports only the part that was paid.
    const { r, p } = mk();
    p.Ada.cash = 120;
    // Worth more than the shortfall, or selling it still wouldn't cover the
    // bill and the engine would rightly end them instead.
    const tile = r.tiles
        .filter((t) => t.type === 'property')
        .sort((x, y) => y.price - x.price)[0];
    tile.ownerId = p.Ada.id;
    p.Ada.properties.push(tile.id);
    e.transfer(r, p.Ada, p.Bo, 500, 'rent');
    ok('the debt is what is left over', p.Ada.debt?.amount === 380, JSON.stringify(p.Ada.debt));
    ok('and the flash shows only what moved', r.lastPayment.amount === 120);
}

/* --------------------------------------------------------- nothing to show */
{
    const { r, p } = mk();
    e.transfer(r, p.Ada, p.Bo, 0, 'nothing');
    ok('a zero payment is not an event', r.lastPayment === null);

    p.Bo.bankrupt = true;
    e.transfer(r, p.Bo, p.Ada, 100, 'rent');
    ok('nor is one from someone already out', r.lastPayment === null);
}

/* ------------------------------------------------------------- broadcast */
{
    const { r, p } = mk();
    e.transfer(r, p.Ada, p.Bo, 75, 'rent');
    const st = e.publicState(r);
    ok('it goes out with the state', st.lastPayment?.amount === 75, JSON.stringify(st.lastPayment));
    ok('and round-trips as JSON', JSON.parse(JSON.stringify(st)).lastPayment.seq === r.lastPayment.seq);
    e.resetForRematch(r);
    ok('a rematch clears it', r.lastPayment === null);
}

/* --------------------------------------------- a room saved before this existed */
{
    const { r, p } = mk();
    delete r.paySeq;
    delete r.lastPayment;
    e.transfer(r, p.Ada, p.Bo, 60, 'rent');
    ok('an old snapshot still counts from one', r.lastPayment.seq === 1, String(r.lastPayment.seq));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
