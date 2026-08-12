// Server-wide presence: who's counted, how tabs are deduped, and that it
// survives people moving between the menu and a game.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (pid = null) =>
    new Promise((r) => {
        const s = io(URL, { auth: { token: 'open', pid } });
        s.on('connect', () => r(s));
    });

/** The presence the server last pushed to this socket. */
function watch(s) {
    const box = { last: null, count: 0 };
    s.on('presence', (p) => {
        box.last = p;
        box.count += 1;
    });
    return box;
}

const health = async () => (await fetch(`${URL}/health`)).json();

(async () => {
    const before = await health();
    ok('health starts clean', before.online === 0, JSON.stringify(before));

    const a = await connect('pid-a');
    const seen = watch(a);
    await sleep(400);
    ok('one socket is one player', seen.last?.online === 1, JSON.stringify(seen.last));
    ok('nobody is playing yet', seen.last.playing === 0 && seen.last.games === 0);

    // A second tab of the same person.
    const aTab = await connect('pid-a');
    await sleep(400);
    ok('a second tab is the same person', seen.last.online === 1, JSON.stringify(seen.last));

    const b = await connect('pid-b');
    await sleep(400);
    ok('a different person counts', seen.last.online === 2, JSON.stringify(seen.last));

    // Into a game.
    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    await new Promise((r) => b.emit('room:join', { roomCode: made.roomCode, name: 'Bo' }, r));
    await sleep(400);
    ok('both are playing', seen.last.playing === 2, JSON.stringify(seen.last));
    ok('one game is running', seen.last.games === 1, JSON.stringify(seen.last));
    ok('the total did not double-count', seen.last.online === 2, JSON.stringify(seen.last));

    const viaHttp = await health();
    ok('health agrees', viaHttp.online === 2 && viaHttp.games === 1, JSON.stringify(viaHttp));

    // Leaving the lobby puts you back in the menu, still online.
    b.emit('room:leave');
    await sleep(400);
    ok('leaving drops the playing count', seen.last.playing === 1, JSON.stringify(seen.last));
    ok('but not the online count', seen.last.online === 2, JSON.stringify(seen.last));

    // Closing one of two tabs must not remove the person.
    const quiet = seen.count;
    aTab.close();
    await sleep(400);
    ok('closing a spare tab changes nothing', seen.last.online === 2, JSON.stringify(seen.last));
    ok('and does not even push', seen.count === quiet, `${seen.count} vs ${quiet}`);

    b.close();
    await sleep(400);
    ok('a real disconnect drops the count', seen.last.online === 1, JSON.stringify(seen.last));

    // The room is now held by a disconnected player only.
    a.close();
    await sleep(500);
    const empty = await health();
    ok('an empty room is not a running game', empty.online === 0 && empty.games === 0, JSON.stringify(empty));

    /* ------------------------------------------------- tabbing out */
    // The server is started with NOPOLY_AWAY_MS=3000 for this.
    const c = await connect('pid-c');
    const d = await connect('pid-d');
    const cSeen = watch(c);
    await sleep(400);
    ok('two people back on', cSeen.last?.online === 2, JSON.stringify(cSeen.last));

    d.emit('presence:visibility', { hidden: true });
    await sleep(400);
    ok('tabbing out is not instant', cSeen.last.online === 2, JSON.stringify(cSeen.last));

    const beforeSweep = cSeen.count;
    await sleep(6500);
    ok('a few minutes out drops you off', cSeen.last.online === 1, JSON.stringify(cSeen.last));
    ok('and it arrived on its own', cSeen.count > beforeSweep, `${cSeen.count} vs ${beforeSweep}`);

    d.emit('presence:visibility', { hidden: false });
    await sleep(400);
    ok('coming back counts again straight away', cSeen.last.online === 2, JSON.stringify(cSeen.last));

    // A second tab in front of you keeps you here.
    const cTab = await connect('pid-c');
    await sleep(300);
    c.emit('presence:visibility', { hidden: true });
    await sleep(6500);
    ok('one visible tab is enough', cSeen.last.online === 2, JSON.stringify(cSeen.last));
    cTab.emit('presence:visibility', { hidden: true });
    await sleep(6500);
    ok('every tab hidden drops you', cSeen.last.online === 1, JSON.stringify(cSeen.last));

    for (const s of [c, cTab, d]) s.close();
    await sleep(400);

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    process.exit(fails.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
