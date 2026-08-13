// The game over HTTP long-polling only, with no WebSocket upgrade available.
//
// This is the deployment path described in deploy/README.md: a CDN in front of
// the VM for networks that filter the usual hostname. Vercel rewrites do not
// carry a WebSocket upgrade to an external origin, so every player on that
// route is on polling for the whole session.
//
// Socket.IO falls back to it on its own, which is exactly why this is worth a
// suite — nothing in the app announces which transport it got, so the route
// could stop working and the only symptom would be a friend saying the site is
// broken at school.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** No 'websocket' in the list at all — the upgrade is never even attempted. */
const connect = () =>
    new Promise((r) => {
        const s = io(URL, { auth: { token: 'open' }, transports: ['polling'] });
        s.on('connect', () => r(s));
    });

const latest = new Map();
const track = (s) => (s.on('state', (st) => latest.set(s, st)), s);
const seen = (s) => latest.get(s) || null;

(async () => {
    const [a, b] = (await Promise.all([connect(), connect()])).map(track);

    ok('it connects without a WebSocket', a.connected && b.connected);
    ok('and stays on polling', a.io.engine.transport.name === 'polling', a.io.engine.transport.name);

    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada', playerId: 'poll-Ada' }, r));
    ok('a room can be created', !made.error && !!made.roomCode, JSON.stringify(made.error));

    const joined = await new Promise((r) =>
        b.emit('room:join', { roomCode: made.roomCode, name: 'Bo', playerId: 'poll-Bo' }, r),
    );
    ok('and joined', !joined.error, JSON.stringify(joined.error));

    // The half that matters: a broadcast caused by someone else has to arrive
    // on its own, with no request from this client to hang it off.
    await sleep(400);
    ok('the other player is pushed the new state', seen(a)?.players.length === 2,
        JSON.stringify(seen(a)?.players.map((p) => p.name)));

    a.emit('game:start');
    await sleep(500);
    ok('the game starts', seen(a)?.phase !== 'waiting', seen(a)?.phase);
    ok('and both sides see it', seen(b)?.phase === seen(a)?.phase);

    const before = seen(a).stats.turnCount;
    a.emit('game:roll');
    await sleep(600);
    ok('a roll lands', seen(a).diceRoll[0] > 0, JSON.stringify(seen(a).diceRoll));
    ok('and reaches the other player', JSON.stringify(seen(b).diceRoll) === JSON.stringify(seen(a).diceRoll));

    a.emit('chat:send', { text: 'polling works' });
    await sleep(400);
    ok('chat round-trips', seen(b).chat.some((c) => c.text === 'polling works'));

    void before;
    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, b]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
