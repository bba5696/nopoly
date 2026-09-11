// The admin panel's API, over real HTTP against a real server.
//
// What matters most here is what a stranger gets: nothing without the key,
// nothing with a wrong one, and not many tries at it. After that, that a kick
// is a kick — out of the room, banned from coming back, and told why — and that
// ending a game sends everyone home.
const { io } = require('socket.io-client');

const URL = process.env.TEST_URL || 'http://localhost:3001';
const KEY = process.env.NOPOLY_ADMIN_KEY;

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const post = (path, body, token) =>
    fetch(URL + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body || {}),
    });
const get = (path, token) =>
    fetch(URL + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

function client() {
    const s = io(URL, { auth: { token: 'open' }, forceNew: true });
    s.state = null;
    s.closed = null;
    s.on('state', (st) => (s.state = st));
    s.on('room:closed', (text) => (s.closed = text));
    return new Promise((resolve) => s.on('connect', () => resolve(s)));
}
const ask = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
const until = async (fn, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (fn()) return true;
        await new Promise((r) => setTimeout(r, 25));
    }
    return false;
};

(async () => {
    if (!KEY) {
        console.log('\nNOPOLY_ADMIN_KEY is not set for this run — the runner sets it');
        process.exit(1);
    }

    /* ------------------------------------------------------ the door is shut */
    ok('no token, no rooms', (await get('/api/admin/rooms')).status === 401);
    ok('a made-up token, no rooms', (await get('/api/admin/rooms', '9999999999999.abc')).status === 401);
    ok('a player token is not an admin token', (await get('/api/admin/rooms', 'open')).status === 401);
    const noKick = await post('/api/admin/rooms/ABCDE/end', {}, null);
    ok('no token, no ending games', noKick.status === 401);

    const wrong = await post('/api/admin/login', { key: 'not-the-key-at-all' });
    ok('a wrong key is refused', wrong.status === 401);
    const wrongBody = await wrong.json();
    ok('and gets no token', !wrongBody.token);

    /* ------------------------------------------------------------ signing in */
    const good = await post('/api/admin/login', { key: KEY });
    const { token } = await good.json();
    ok('the right key mints a token', good.status === 200 && typeof token === 'string');

    /* ------------------------------------------------------ a room to act on */
    const ada = await client();
    const bo = await client();
    const cy = await client();
    const made = await ask(ada, 'room:create', { name: 'Ada' });
    const code = made.roomCode || made.state?.roomCode;
    const boJoin = await ask(bo, 'room:join', { roomCode: code, name: 'Bo' });
    await ask(cy, 'room:join', { roomCode: code, name: 'Cy' });
    ada.emit('game:start');
    await until(() => ada.state && ada.state.phase !== 'waiting');

    const listed = await (await get('/api/admin/rooms', token)).json();
    const row = listed.rooms.find((r) => r.code === code);
    ok('the panel sees the room', !!row);
    ok('with its players', row?.players.length === 3, String(row?.players.length));
    ok('and that it is under way', row && row.phase !== 'waiting' && !!row.currentId, row?.phase);
    ok('and never anybody s cash or cards', !JSON.stringify(listed).includes('"cash"') && !JSON.stringify(listed).includes('"hand"'));

    /* ------------------------------------------------------------------ kick */
    const kicked = await post(`/api/admin/rooms/${code}/kick`, { playerId: boJoin.playerId }, token);
    ok('a kick goes through', kicked.status === 200, String(kicked.status));
    ok('the kicked player is told why', await until(() => /admin removed you/.test(bo.closed || '')), bo.closed);
    ok('the table sees them out', await until(() => ada.state?.players.find((p) => p.id === boJoin.playerId)?.resigned));
    ok('and the feed says who did it', await until(() => ada.state?.log.some((l) => /Bo was removed by an admin/.test(l.text))));

    const back = await client();
    const retry = await ask(back, 'room:join', { roomCode: code, name: 'Bo', playerId: boJoin.playerId });
    ok('and they cannot walk back in', !!retry.error, JSON.stringify(retry));

    const unknown = await post(`/api/admin/rooms/${code}/kick`, { playerId: 'nobody' }, token);
    ok('kicking nobody is an error, not a crash', unknown.status === 400);
    const gone = await post('/api/admin/rooms/ZZZZZ/kick', { playerId: 'x' }, token);
    ok('a room that is not there is a 404', gone.status === 404);

    /* ------------------------------------------------------------------- end */
    const ended = await post(`/api/admin/rooms/${code}/end`, {}, token);
    ok('ending a game goes through', ended.status === 200);
    ok('everyone still there is told', await until(() => /admin ended/.test(ada.closed || '') && /admin ended/.test(cy.closed || '')));
    const after = await (await get('/api/admin/rooms', token)).json();
    ok('and the room is gone', !after.rooms.some((r) => r.code === code));

    /* -------------------------------------------------- not many tries at it */
    let limited = false;
    for (let i = 0; i < 8; i++) {
        const r = await post('/api/admin/login', { key: `guess-${i}-xxxxxxxxxxxx` });
        if (r.status === 429) limited = true;
    }
    ok('guessing runs out of tries', limited);
    const locked = await post('/api/admin/login', { key: KEY });
    ok('even the right key waits once that happens', locked.status === 429, String(locked.status));
    ok('but a token already issued keeps working', (await get('/api/admin/rooms', token)).status === 200);

    for (const s of [ada, bo, cy, back]) s.close();
    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    process.exit(fails.length ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
