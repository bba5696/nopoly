const { io } = require('socket.io-client');
const URL = 'http://localhost:3001';
let pass = 0; const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const quiet = (s) => new Promise((res) => { let last = null; const on = (st) => (last = st); s.on('state', on);
    const t = setInterval(() => { if (!last) return; clearInterval(t); s.off('state', on); res(last); }, 200); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Watch broadcasts until one satisfies `pred`, or give up and return the last. */
async function until(s, pred, ms = 15_000) {
    let last = null;
    const on = (st) => (last = st);
    s.on('state', on);
    const stop = Date.now() + ms;
    while (Date.now() < stop && !(last && pred(last))) await sleep(100);
    s.off('state', on);
    return last;
}

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
    // Auctions off, so that the turns the clock plays for people actually hand
    // on. An auto-declined purchase opens an auction nobody bids in, and the
    // table then waits out its full window before anyone's turn ends — which
    // is fine in a game and far too slow to wait for here.
    a.emit('room:settings', { auction: false });
    a.emit('game:start');
    let st = await quiet(a);
    ok('game running', st.phase !== 'waiting');

    // Nobody touches anything, so the three-second turn clock works its way
    // round the table playing turns for people. Bo becomes votable the moment
    // it has played one of theirs — which is the only thing that ever makes
    // anyone votable, so the test has to earn it the way a game would.
    st = await until(a, (s) => !!s.players.find((p) => p.id === ids.Bo)?.lastStallAt);
    ok('the clock played a turn for Bo', st.players.find((p) => p.id === ids.Bo).stalls > 0);

    a.emit('vote:start', { targetId: ids.Bo });
    // Waited for rather than sampled: turns are auto-playing every three
    // seconds behind this, so the next broadcast to arrive is as likely to be
    // one of those as it is to be the vote.
    st = await until(a, (s) => !!s.vote, 4000);
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
    st = await until(a, (s) => s.vote === null, 4000);
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
