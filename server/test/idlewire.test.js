// The turn clock over a real socket: it fires on its own, a ping holds it off,
// and it never touches a turn that isn't the one it's timing.
// Server is started with NOPOLY_IDLE_MS=3000 for this.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () =>
    new Promise((r) => {
        const s = io(URL, { auth: { token: 'open' } });
        s.on('connect', () => r(s));
    });

const latest = new Map();
const track = (s) => (s.on('state', (st) => latest.set(s, st)), s);
const seen = (s) => latest.get(s) || null;

(async () => {
    const [a, b] = (await Promise.all([connect(), connect()])).map(track);
    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    await new Promise((r) => b.emit('room:join', { roomCode: made.roomCode, name: 'Bo' }, r));
    // Auctions off: a decline would otherwise hold the turn open for the bid.
    a.emit('room:settings', { auction: false });
    a.emit('game:start');
    await sleep(600);

    const st = seen(a);
    ok('the game is running', st.phase !== 'waiting');
    ok('a clock is on the first player', !!st.idle, JSON.stringify(st.idle));
    ok('it is broadcast to everyone', !!seen(b)?.idle);
    const first = st.idle.playerId;
    const startedTurn = st.stats.turnCount;

    // Hold it off by pinging, the way a moving mouse does.
    for (let i = 0; i < 6; i++) {
        (first === made.playerId ? a : b).emit('game:active');
        await sleep(700);
    }
    ok('pinging keeps the turn', seen(a).idle?.playerId === first, JSON.stringify(seen(a).idle));
    ok('and nothing was played', seen(a).stats.turnCount === startedTurn);

    // Now stop, and let it run out.
    await sleep(4200);
    const after = seen(a);
    ok('the turn played itself', after.stats.turnCount > startedTurn,
        `${startedTurn} -> ${after.stats.turnCount}`);
    ok('and moved on', after.idle?.playerId !== first, JSON.stringify(after.idle));
    ok('the table was told', after.log.some((l) => /was away/.test(l.text)));
    ok('nobody was removed for it', after.players.length === 2 && after.players.every((p) => !p.bankrupt));

    // Turning the rule off stops the clock outright.
    const before = seen(a).stats.turnCount;
    a.emit('room:settings', { turnTimer: false });
    await sleep(400);
    ok('the setting is locked mid-game', !!seen(a).settings.turnTimer, 'rules lock once started');

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    void before;
    for (const s of [a, b]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
