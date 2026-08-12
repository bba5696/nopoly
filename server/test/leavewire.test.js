const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const quiet = (s) => new Promise((res) => { let last = null; const on = (st) => (last = st); s.on('state', on);
    const t = setInterval(() => { if (!last) return; clearInterval(t); s.off('state', on); res(last); }, 200); });

(async () => {
    const [a, b, c] = await Promise.all([connect(), connect(), connect()]);
    const created = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = created.roomCode;
    const bj = await new Promise((r) => b.emit('room:join', { roomCode: code, name: 'Bo' }, r));
    await new Promise((r) => c.emit('room:join', { roomCode: code, name: 'Cy' }, r));

    let st = await quiet(a);
    ok('three in the lobby', st.players.length === 3, String(st.players.length));

    b.emit('room:leave');
    st = await quiet(a);
    ok('leaving removes the player', st.players.length === 2, st.players.map((p) => p.name).join(','));
    ok('the leaver is really gone', !st.players.some((p) => p.id === bj.playerId));

    // Host leaves — the room must not be frozen for the rest.
    a.emit('room:leave');
    st = await quiet(c);
    ok('host leaving removes them too', st.players.length === 1, st.players.map((p) => p.name).join(','));
    ok('the host role passed on', st.hostId === st.players[0].id, st.hostId);

    // The new host can now actually do things.
    c.emit('room:settings', { startingCash: 900 });
    st = await quiet(c);
    ok('the new host can change settings', st.settings.startingCash === 900, String(st.settings.startingCash));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a, b, c]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
