const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const quiet = (s) => new Promise((res) => { let last = null; const on = (st) => (last = st); s.on('state', on);
    const t = setInterval(() => { if (!last) return; clearInterval(t); s.off('state', on); res(last); }, 200); });

(async () => {
    const [a, b, c, d] = await Promise.all([connect(), connect(), connect(), connect()]);
    const errs = []; for (const s of [a,b,c,d]) s.on('error:game', (e) => errs.push(e));
    const made = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = made.roomCode;
    const ids = { Ada: made.playerId };
    for (const [s, n] of [[b,'Bo'],[c,'Cy'],[d,'Di']]) {
        const j = await new Promise((r) => s.emit('room:join', { roomCode: code, name: n }, r));
        ids[n] = j.playerId;
    }
    a.emit('game:start');
    let st = await quiet(a);
    ok('game running', st.phase !== 'waiting');

    a.emit('vote:start', { targetId: ids.Bo });
    st = await quiet(a);
    ok('vote broadcast to everyone', !!st.vote && st.vote.targetId === ids.Bo, JSON.stringify(st.vote));
    ok('caller counted', st.vote.yes.length === 1);
    ok('4 players need 3', st.vote.needed === 3, String(st.vote.needed));

    const before = errs.length;
    b.emit('vote:cast', { agree: false });
    await quiet(b);
    ok('the target cannot vote over the wire', errs.length > before, JSON.stringify(errs));

    c.emit('vote:cast', { agree: true });
    await quiet(c);
    d.emit('vote:cast', { agree: true });
    st = await quiet(a);
    ok('the vote closed', st.vote === null);
    ok('the target is out', st.players.find((p) => p.id === ids.Bo).bankrupt === true);

    // And is refused if they try to come back.
    const b2 = await connect();
    const back = await new Promise((r) => b2.emit('room:join', { roomCode: code, name: 'Bo', playerId: ids.Bo }, r));
    ok('a kicked player cannot rejoin', !!back.error, JSON.stringify(back));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const s of [a,b,c,d,b2]) s.close();
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
