// The payment event, over a real socket: that `charge()` reaches every client
// through publicState intact, and that its sequence number survives the trip.
//
// The charge is a jail fine rather than rent, because it is the only one a
// client can trigger on demand — landing on a rival's property means rolling
// for it, and no position on the board has eleven chargeable tiles in front of
// it, so "roll and expect rent" is a test that fails a quarter of the time.
// Rent's own arithmetic is covered at the engine level in payment.test.js; what
// is under test here is the wire.
//
// Runs against the RENTX room staged in fixture.js.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const latest = new Map();
const track = (s) => (s.on('state', (st) => latest.set(s, st)), s);
const seen = (s) => latest.get(s) || null;

(async () => {
    const [a, b] = (await Promise.all([connect(), connect()])).map(track);
    const j = await new Promise((r) => a.emit('room:join', { roomCode: 'RENTX', name: 'Ada', playerId: 'pid-Ada' }, r));
    await new Promise((r) => b.emit('room:join', { roomCode: 'RENTX', name: 'Bo', playerId: 'pid-Bo' }, r));
    await sleep(500);
    ok('joined a running game', j.state.phase !== 'waiting', j.error || '');
    ok('no payment to replay on arrival', !seen(a).lastPayment, JSON.stringify(seen(a).lastPayment));

    const cashBefore = seen(a).players.find((p) => p.id === 'pid-Ada').cash;
    a.emit('game:payJail');
    await sleep(600);
    const st = seen(a);
    const pay = st.lastPayment;
    ok('a payment was broadcast', !!pay, JSON.stringify(pay));
    if (pay) {
        ok('it names who paid', pay.fromId === 'pid-Ada', pay.fromId);
        ok('and it carries a sequence number', typeof pay.seq === 'number' && pay.seq > 0, String(pay.seq));
        ok('the amount matches the cash that moved',
            pay.amount === cashBefore - st.players.find((p) => p.id === 'pid-Ada').cash,
            `${pay.amount} vs ${cashBefore - st.players.find((p) => p.id === 'pid-Ada').cash}`);
        ok('everyone sees the same event', seen(b).lastPayment?.seq === pay.seq);
        ok('it round-trips as JSON', JSON.parse(JSON.stringify(st)).lastPayment.seq === pay.seq);
        if (pay.toId) ok('rent names the landlord', pay.toId === 'pid-Bo', pay.toId);
        else ok('a bank payment has no recipient', pay.toId === null);
    }
    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, b]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
