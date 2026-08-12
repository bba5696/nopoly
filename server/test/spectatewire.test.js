// Spectating over a real socket: the refusal that offers a way in, the way in
// itself, and that nothing a watcher sends can touch the game.
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
    const [a, b, z] = (await Promise.all([connect(), connect(), connect()])).map(track);
    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = made.roomCode;
    await new Promise((r) => b.emit('room:join', { roomCode: code, name: 'Bo' }, r));
    a.emit('game:start');
    await sleep(500);
    ok('game running', seen(a)?.phase !== 'waiting');

    // Zed turns up late.
    const refused = await new Promise((r) => z.emit('room:join', { roomCode: code, name: 'Zed' }, r));
    ok('the seat is refused', !!refused.error, JSON.stringify(refused));
    ok('but watching is offered', refused.canSpectate === true, JSON.stringify(refused));
    ok('with a reason to show', /already started/.test(refused.reason || ''), String(refused.reason));

    const watch = await new Promise((r) => z.emit('room:spectate', { roomCode: code, name: 'Zed' }, r));
    ok('they get in', !watch.error && watch.spectating === true, JSON.stringify(watch));
    ok('and see the game', watch.state?.players.length === 2);

    await sleep(400);
    ok('the table sees them', seen(a)?.spectators.some((s) => s.name === 'Zed'), JSON.stringify(seen(a)?.spectators));
    ok('they are not a player', seen(a)?.players.length === 2);

    // Nothing they send lands.
    const errs = [];
    z.on('error:game', (m) => errs.push(m));
    const beforeTurn = seen(a).turnIndex;
    z.emit('game:roll');
    z.emit('game:endTurn');
    z.emit('game:bankrupt');
    await sleep(500);
    ok('every action is refused', errs.length === 3, JSON.stringify(errs));
    ok('and says why', /watching/.test(errs[0] || ''), String(errs[0]));
    ok('the turn did not move', seen(a).turnIndex === beforeTurn);
    ok('and nobody went bankrupt', seen(a).players.every((p) => !p.bankrupt));

    // Talking is the exception.
    z.emit('chat:send', { text: 'nice roll' });
    await sleep(400);
    ok('a watcher can chat', seen(a).chat.some((c) => c.text === 'nice roll'), JSON.stringify(seen(a).chat));

    // And leaving takes them off the list.
    z.emit('room:leave');
    await sleep(400);
    ok('leaving clears them', (seen(a)?.spectators || []).length === 0, JSON.stringify(seen(a)?.spectators));

    // A dropped connection does too, with no seat held open.
    const z2 = await connect();
    await new Promise((r) => z2.emit('room:spectate', { roomCode: code, name: 'Zed' }, r));
    await sleep(400);
    ok('back again', seen(a).spectators.length === 1);
    z2.close();
    await sleep(700);
    ok('a dropped watcher is gone at once', seen(a).spectators.length === 0, JSON.stringify(seen(a).spectators));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, b, z]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
