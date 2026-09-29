// One socket, two rooms in a row, and nothing from the first reaching it after.
//
// The bug this pins: a socket that made or joined a second room without an
// explicit room:leave stayed in the first room's broadcast channel. The player
// id is the browser's and the same in both rooms, so the client took the old
// room's state as its own and the screen flipped between the two rooms.
const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const [ada, bo] = await Promise.all([connect(), connect()]);
    const first = await ask(ada, 'room:create', { name: 'Ada' });
    await ask(bo, 'room:join', { roomCode: first.roomCode, name: 'Bo' });

    // Straight into a second room, the way the client does after being
    // dropped from the first without saying so.
    const second = await ask(ada, 'room:create', { name: 'Ada', playerId: first.playerId });
    ok('a second room was made', second.roomCode && second.roomCode !== first.roomCode);

    const seen = [];
    ada.on('state', (st) => seen.push(st.roomCode));
    bo.emit('chat:send', { text: 'anyone there' });
    bo.emit('room:settings', {});
    await sleep(300);
    ok('nothing from the old room reaches the new one', !seen.includes(first.roomCode), seen.join(' '));

    // And the old room has let go of the seat rather than holding it open for a
    // socket that isn't listening. Still in the lobby there, so it's freed.
    const view = await ask(bo, 'room:join', { roomCode: first.roomCode, name: 'Bo' });
    ok('the old lobby lost the seat', !view.state.players.some((p) => p.id === first.playerId),
        view.state.players.map((p) => p.name).join(','));

    // Watching is a way in as well, and must move out the same way.
    const [cy] = await Promise.all([connect()]);
    const third = await ask(cy, 'room:create', { name: 'Cy' });
    const seenBo = [];
    bo.on('state', (st) => seenBo.push(st.roomCode));
    const joined = await ask(bo, 'room:join', { roomCode: third.roomCode, name: 'Bo' });
    ok('bo moved into the third room', !joined.error, joined.error);
    seenBo.length = 0;
    ada.emit('room:settings', {});
    await ask(ada, 'room:join', { roomCode: first.roomCode, name: 'Ada', playerId: first.playerId });
    await sleep(300);
    ok('bo hears nothing from the first room after moving', !seenBo.includes(first.roomCode), seenBo.join(' '));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [ada, bo, cy]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
