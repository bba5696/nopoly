// Rooms ending on their own.
//
// Nothing in the game ever says "this table is finished with", so the only
// thing keeping the Map from growing for the life of the process is the sweep
// in index.js. Three endings, and they need separate boots: whichever window
// is shortest fires first and hides the other two, so each is exercised with
// the others turned up out of reach.
//
// The one that matters most is `stale`. Every other ending is some flavour of
// "the sockets went away", which is easy to notice; a tab left open on a phone
// in a pocket never goes away, and the turn clock will happily keep playing
// turns for it. That is the room that used to live forever.
//
// SOLO, alongside limits, because the windows have to be measured in
// milliseconds to be reachable and that is not a server anything else can share.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
const fixture = require('./fixture');

const SERVER = path.join(__dirname, '..');
const STATE = path.join(__dirname, 'state-cleanup');
const PORT = 3004;
const URL = `http://localhost:${PORT}`;

/** Far enough out that a rule set to it cannot fire during this suite. */
const NEVER = '3600000';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(env) {
    const p = spawn(process.execPath, ['index.js'], {
        cwd: SERVER,
        env: {
            ...process.env,
            PORT: String(PORT),
            NOPOLY_STATE: STATE,
            NODE_ENV: 'development',
            NOPOLY_PASSWORD: '',
            // Fast enough that a window expiring is noticed inside a test.
            NOPOLY_SWEEP_MS: '100',
            ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    return { proc: p, log: () => out };
}

async function waitUp() {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`${URL}/health`);
            if (r.ok) return true;
        } catch { /* not yet */ }
        await sleep(200);
    }
    return false;
}

async function down(server) {
    server.proc.kill('SIGTERM');
    await new Promise((r) => server.proc.on('exit', r));
    // The port has to be free before the next boot claims it.
    await sleep(300);
}

const connect = () =>
    new Promise((r) => {
        const s = io(URL, { auth: { token: 'open' } });
        s.on('connect', () => r(s));
    });

const create = (s, name = 'Ada') =>
    new Promise((r) => s.emit('room:create', { name }, r));

const roomCount = async () => (await (await fetch(`${URL}/health`)).json()).rooms;

/** Wait for the count to reach `n`, rather than sleeping a guessed interval. */
async function until(n, ms = 4000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if ((await roomCount()) === n) return true;
        await sleep(100);
    }
    return false;
}

(async () => {
    fs.rmSync(STATE, { recursive: true, force: true });

    /* ------------------------------------------------------------- stale */
    // Sockets stay connected throughout, so the empty rule can never be what
    // closes these. Only the absence of requests can.
    let server = boot({ NOPOLY_STALE_ROOM_MS: '700', NOPOLY_EMPTY_ROOM_MS: NEVER, NOPOLY_ENDED_ROOM_MS: NEVER });
    ok('server comes up', await waitUp());

    const abandoned = await connect();
    const kept = await connect();
    const goneCode = (await create(abandoned, 'Ghost')).roomCode;
    const keptCode = (await create(kept, 'Live')).roomCode;
    ok('two rooms to start with', (await roomCount()) === 2);

    const closures = [];
    abandoned.on('room:closed', (text) => closures.push(text));
    kept.on('room:closed', (text) => closures.push(`WRONG ROOM: ${text}`));

    // One of them has a person in front of it. Chat is the cheapest thing a
    // client can send that goes through the same path a real action does.
    for (let i = 0; i < 6; i++) {
        kept.emit('chat:send', { text: `still here ${i}` });
        await sleep(200);
    }

    ok('the untouched room is closed', await until(1), `${await roomCount()} left`);
    ok('the connected socket is told', closures.length === 1, JSON.stringify(closures));
    ok('and told in plain words', /closed/i.test(closures[0] || ''), closures[0]);
    // Still reachable by code, which is the assertion that matters to a player:
    // the survivor was not merely counted, it still works.
    const rejoin = await new Promise((r) => abandoned.emit('room:join', { roomCode: keptCode, name: 'Bo' }, r));
    ok('the surviving room can still be joined', !!rejoin?.roomCode, JSON.stringify(rejoin));
    const dead = await new Promise((r) => abandoned.emit('room:join', { roomCode: goneCode, name: 'Bo' }, r));
    ok('the closed room is gone for good', /no room/i.test(dead?.error || ''), JSON.stringify(dead));

    abandoned.close();
    kept.close();
    await down(server);

    /* ------------------------------------------------------------- empty */
    fs.rmSync(STATE, { recursive: true, force: true });
    server = boot({ NOPOLY_EMPTY_ROOM_MS: '400', NOPOLY_STALE_ROOM_MS: NEVER, NOPOLY_ENDED_ROOM_MS: NEVER });
    ok('second server comes up', await waitUp());

    const leaver = await connect();
    await create(leaver, 'Solo');
    ok('the room exists while they are in it', (await roomCount()) === 1);
    // Held open across the disconnect grace period, or a refresh would be
    // indistinguishable from leaving.
    await sleep(600);
    ok('and is not swept while they are connected', (await roomCount()) === 1);

    leaver.close();
    ok('the empty room is closed', await until(0), `${await roomCount()} left`);

    await down(server);

    /* ------------------------------------------------------------- ended */
    // Staged as a snapshot: reaching a win through the socket API means
    // bankrupting a player with dice, which is a coin flip dressed up as a test.
    fs.rmSync(STATE, { recursive: true, force: true });
    fs.mkdirSync(STATE, { recursive: true });
    const finished = fixture.rentRoom();
    finished.phase = 'ended';
    finished.winnerId = finished.players[0].id;
    fs.writeFileSync(
        path.join(STATE, 'rooms.json'),
        JSON.stringify({ savedAt: Date.now(), rooms: [finished] }),
    );

    server = boot({ NOPOLY_ENDED_ROOM_MS: '400', NOPOLY_EMPTY_ROOM_MS: NEVER, NOPOLY_STALE_ROOM_MS: NEVER });
    ok('third server comes up', await waitUp());
    // Read from the log rather than from /health: the window is short enough
    // that the sweep can beat the first request, and a test that races the
    // thing it is testing fails for the wrong reason.
    ok('the finished game is restored first', /resumed 1 room/.test(server.log()), server.log());
    ok('and then closed', await until(0), `${await roomCount()} left`);

    await down(server);
    fs.rmSync(STATE, { recursive: true, force: true });

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log(`  ✗ ${f}`);
    process.exit(fails.length ? 1 : 0);
})();
