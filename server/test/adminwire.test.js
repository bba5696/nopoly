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

    /* ----------------------------------------------------------------- watch */
    ok('watching needs the token too', (await get(`/api/admin/rooms/${code}`)).status === 401);
    const watched = await (await get(`/api/admin/rooms/${code}`, token)).json();
    ok('a room can be watched', !!watched.state && watched.state.roomCode === code);
    ok('with what the game has been doing', watched.state.log.some((l) => /removed by an admin/.test(l.text)));
    ok('but never its chat', !('chat' in watched.state));

    /* ----------------------------------------------------------------- pause */
    const paused = await post(`/api/admin/rooms/${code}/pause`, { paused: true }, token);
    ok('a game can be paused', paused.status === 200);
    ok('the table sees it', await until(() => ada.state?.paused === true));
    ok('and is told who did it', await until(() => ada.state?.log.some((l) => /An admin paused the game/.test(l.text))));
    const whilePaused = await post(`/api/admin/rooms/${code}/play-turn`, {}, token);
    ok('no playing a turn while paused', whilePaused.status === 400);
    ok('pausing twice is refused', (await post(`/api/admin/rooms/${code}/pause`, { paused: true }, token)).status === 400);
    await post(`/api/admin/rooms/${code}/pause`, { paused: false }, token);
    ok('and it resumes', await until(() => ada.state?.paused === false));

    /* ---------------------------------------------------- playing a stuck turn */
    const played = await post(`/api/admin/rooms/${code}/play-turn`, {}, token);
    ok('a stuck turn can be played', played.status === 200, String(played.status));
    ok('and the feed names whose it was', await until(() => ada.state?.log.some((l) => /An admin played \w+'s turn for them/.test(l.text))));
    // The played turn takes the passive option, and declining a purchase opens
    // an auction — so whether there is one to close is up to the dice.
    const listedNow = await (await get('/api/admin/rooms', token)).json();
    const auctionOn = listedNow.rooms.find((r) => r.code === code)?.auction;
    const closed = await post(`/api/admin/rooms/${code}/finish-deadline`, {}, token);
    if (auctionOn) {
        ok('an auction the turn opened can be closed', closed.status === 200, String(closed.status));
        ok('and it is gone', await until(() => !ada.state?.auction));
    } else {
        ok('with no auction on, there is nothing to close', closed.status === 400, String(closed.status));
    }

    /* ----------------------------------------------------------------- unban */
    const rooms1 = await (await get('/api/admin/rooms', token)).json();
    const banned = rooms1.rooms.find((r) => r.code === code)?.banned || [];
    ok('the ban list keeps the name', banned.some((b) => b.id === boJoin.playerId && b.name === 'Bo'), JSON.stringify(banned));
    const unbanned = await post(`/api/admin/rooms/${code}/unban`, { playerId: boJoin.playerId }, token);
    ok('a ban can be lifted', unbanned.status === 200);
    // Kicked mid-game, their estate already went back — so lifting the ban lets
    // them watch, and does not hand them back a seat in a game they are out of.
    const again = await ask(back, 'room:join', { roomCode: code, name: 'Bo', playerId: boJoin.playerId });
    ok('unbanned, they are offered a seat to watch from', again.canSpectate === true && !/banned/i.test(again.error || ''), JSON.stringify(again));
    const watching = await ask(back, 'room:spectate', { roomCode: code, name: 'Bo', playerId: boJoin.playerId });
    ok('and can take it', !watching?.error, JSON.stringify(watching));
    ok('but are not back in the game they were removed from', await until(() => ada.state?.players.find((p) => p.id === boJoin.playerId)?.resigned));
    ok('unbanning someone not banned is refused', (await post(`/api/admin/rooms/${code}/unban`, { playerId: boJoin.playerId }, token)).status === 400);

    /* --------------------------------------------------------- the card game */
    const dee = await client();
    const eli = await client();
    const cards = await ask(dee, 'room:create', { name: 'Dee', game: 'nouno' });
    const cardCode = cards.roomCode || cards.state?.roomCode;
    await ask(eli, 'room:join', { roomCode: cardCode, name: 'Eli' });
    dee.emit('game:start');
    await until(() => dee.state?.phase === 'playing');
    const before = dee.state.turnIndex;
    const cardTurn = await post(`/api/admin/rooms/${cardCode}/play-turn`, {}, token);
    ok('a card game s turn can be played too', cardTurn.status === 200, String(cardTurn.status));
    ok('and it moves on without leaving a suit half-named', await until(() => dee.state?.turnIndex !== before && !dee.state?.choosing));
    const cardView = await (await get(`/api/admin/rooms/${cardCode}`, token)).json();
    ok('watching a card game shows nobody s hand', !JSON.stringify(cardView).includes('"hand"'));

    /* ----------------------------------------------------------------- health */
    const health = await (await get('/api/admin/health', token)).json();
    ok('health says what is running', health.rooms?.total >= 2 && typeof health.version === 'string', JSON.stringify(health.rooms));
    ok('and how close it is to the cap', health.rooms?.max > 0 && health.memory?.rssMb > 0);
    ok('health needs the token', (await get('/api/admin/health')).status === 401);

    /* --------------------------------------------------------------- notices */
    let heard = null;
    cy.on('server:notice', (n) => (heard = n));
    const sent = await post('/api/admin/notice', { text: 'Restarting in 2 minutes', minutes: 2 }, token);
    ok('a notice can be sent', sent.status === 200);
    ok('every open tab gets it', await until(() => heard?.text === 'Restarting in 2 minutes'));
    const late = io(URL, { auth: { token: 'open' }, forceNew: true });
    let lateHeard = null;
    late.on('server:notice', (n) => (lateHeard = n));
    ok('so does a tab that connects afterwards', await until(() => lateHeard?.text === 'Restarting in 2 minutes'));
    await post('/api/admin/notice', { text: '' }, token);
    ok('and clearing it tells them', await until(() => heard === null));
    ok('sending one needs the token', (await post('/api/admin/notice', { text: 'hi' })).status === 401);

    /* ------------------------------------------------------------- audit log */
    const audit = await (await get('/api/admin/log', token)).json();
    const actions = audit.entries.map((x) => x.action);
    ok('the log has the sign-ins', actions.includes('signed in') && actions.includes('wrong key'));
    ok('and what was done', actions.includes('kicked Bo') && actions.includes('paused') && actions.includes('unbanned Bo'));
    ok('newest first', audit.entries[0].action === 'cleared the notice', audit.entries[0].action);
    ok('the log needs the token', (await get('/api/admin/log')).status === 401);
    for (const s of [dee, eli, late]) s.close();

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
