// The countdown over a real socket: a dropped connection, the kick that turns
// into a clock, and the reconnect that calls it off.
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

/**
 * The latest state each socket has been sent, kept from the moment it connects.
 * Waiting for the *next* broadcast races with the ones already delivered — a
 * socket that isn't the one acting often has nothing further coming.
 */
const latest = new Map();
function track(s) {
    s.on('state', (st) => latest.set(s, st));
    return s;
}
const seen = (s) => latest.get(s) || null;

/** Poll until the tracked state satisfies `pred`, or give up and return it. */
async function until(s, pred, ms = 4000) {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
        if (seen(s) && pred(seen(s))) return seen(s);
        await sleep(100);
    }
    return seen(s);
}
const quiet = async (s) => {
    await sleep(500);
    return seen(s);
};

(async () => {
    const [a, b, c] = (await Promise.all([connect(), connect(), connect()])).map(track);
    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = made.roomCode;
    const bJoin = await new Promise((r) => b.emit('room:join', { roomCode: code, name: 'Bo' }, r));
    await new Promise((r) => c.emit('room:join', { roomCode: code, name: 'Cy' }, r));
    a.emit('game:start');
    let st = await quiet(a);
    ok('game running', st.phase !== 'waiting');

    // Bo's connection dies.
    b.close();
    await sleep(600);
    st = await quiet(a);
    ok('Bo shows as away', st.players.find((p) => p.id === bJoin.playerId).connected === false);

    a.emit('vote:start', { targetId: bJoin.playerId });
    st = await until(a, (s) => !!s.vote);
    ok('the kick became a countdown', st.vote?.mode === 'abandon', JSON.stringify(st.vote));
    ok('it is broadcast to the others', (await until(c, (s) => !!s.vote)).vote?.mode === 'abandon');
    ok('with two minutes on the clock', st.vote.endsAt - Date.now() > 110_000, String(st.vote.endsAt - Date.now()));

    const errs = [];
    c.on('error:game', (e) => errs.push(e));
    c.emit('vote:cast', { agree: true });
    await sleep(400);
    ok('votes are refused over the wire', errs.length === 1, JSON.stringify(errs));

    // Bo gets back in on the same identity, which is what a refresh does.
    const b2 = await connect();
    const back = await new Promise((r) =>
        b2.emit('room:join', { roomCode: code, name: 'Bo', playerId: bJoin.playerId }, r),
    );
    ok('Bo is let back in', !back.error, JSON.stringify(back));
    st = await until(a, (s) => s.vote === null);
    ok('the countdown was dropped', st.vote === null, JSON.stringify(st.vote));
    ok('and Bo is still playing', st.players.find((p) => p.id === bJoin.playerId).bankrupt === false);

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, c, b2]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
