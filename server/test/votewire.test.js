// Vote-kick over the wire — which now means checking that it is shut.
//
// The ballot was being used on whoever was winning rather than on whoever was
// spoiling the game, so the only kick left is the admin's. Removing somebody,
// the ban that follows and the door their tabs are shown are all covered by
// adminwire; what this suite is for is the promise that no socket a player
// holds can start a vote any more.
//
// The engine still has the machinery, and vote.test.js still holds it to its
// rules — see the note at the top of that file.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const [a, b] = await Promise.all([connect(), connect()]);
    const errs = [];
    for (const s of [a, b]) s.on('error:game', (e) => errs.push(e));
    let last = null;
    a.on('state', (st) => (last = st));

    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = made.roomCode;
    const bo = await new Promise((r) => b.emit('room:join', { roomCode: code, name: 'Bo' }, r));
    a.emit('game:start');
    await sleep(400);
    ok('game running', last && last.phase !== 'waiting', JSON.stringify(last && last.phase));

    // The one thing this suite is for.
    a.emit('vote:start', { targetId: bo.playerId });
    await sleep(400);
    ok('starting a vote is refused', errs.some((m) => /admin-only/.test(m)), JSON.stringify(errs));
    ok('and no vote is running', !last.vote, JSON.stringify(last.vote));
    ok('nobody was removed', last.players.every((p) => !p.bankrupt), JSON.stringify(last.players.map((p) => p.bankrupt)));

    const before = errs.length;
    b.emit('vote:cast', { agree: true });
    await sleep(400);
    ok('casting one is refused too', errs.length > before, JSON.stringify(errs.slice(before)));
    ok('still no vote', !last.vote);

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, b]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
