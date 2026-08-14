// The limits that stand in for the password once the gate is off.
//
// Creating a room is the only thing an unknown caller can do that costs the
// server memory, so with an open server these two limits are what keeps a loop
// calling room:create from filling a gigabyte. Both are wire-level — they live
// in index.js, not the engine — and both need their own server, because the
// numbers have to be small enough to actually reach. That makes this a SOLO
// suite alongside redeploy rather than one of the shared-server WIRE ones.
//
// Two boots, because the two limits can't both be exercised against one set of
// numbers: whichever is lower trips first and hides the other.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..');
const STATE = path.join(__dirname, 'state-limits');
const PORT = 3003;
const URL = `http://localhost:${PORT}`;

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
            // A .env with a password set would make every handshake fail.
            NOPOLY_PASSWORD: '',
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

(async () => {
    fs.rmSync(STATE, { recursive: true, force: true });

    /* ------------------------------------------------- the global room cap */
    // Per-IP set high so it can't fire first — every socket here is 127.0.0.1,
    // so without that they'd all share one bucket and trip the wrong limit.
    let server = boot({ NOPOLY_MAX_ROOMS: '3', NOPOLY_ROOMS_PER_IP: '99' });
    ok('server comes up', await waitUp());

    const a = await connect();
    const made = [];
    for (let i = 0; i < 3; i++) {
        const res = await create(a, `P${i}`);
        if (res?.roomCode) made.push(res.roomCode);
    }
    ok('rooms up to the cap are created', made.length === 3, `got ${made.length}`);
    ok('the codes are distinct', new Set(made).size === 3);
    ok('the server counts them all', (await roomCount()) === 3);

    const overCap = await create(a, 'Late');
    ok('the one past the cap is refused', !!overCap?.error, JSON.stringify(overCap));
    ok('and says the server is full', /full/i.test(overCap?.error || ''), overCap?.error);
    ok('and no room was made for it', (await roomCount()) === 3);

    // A refusal must not be a disconnect: the same socket has to still work,
    // or a full server would look like a broken one.
    const joined = await new Promise((r) => a.emit('room:join', { roomCode: made[0], name: 'Bo' }, r));
    ok('joining an existing room still works when full', !!joined?.roomCode, JSON.stringify(joined));

    a.close();
    await down(server);

    /* --------------------------------------------------- the per-IP limiter */
    // Cap set high this time, so the per-IP limit is the one that trips.
    server = boot({ NOPOLY_MAX_ROOMS: '99', NOPOLY_ROOMS_PER_IP: '2' });
    ok('second server comes up', await waitUp());

    const b = await connect();
    const first = await create(b, 'One');
    const second = await create(b, 'Two');
    ok('rooms up to the per-IP limit are created', !!first?.roomCode && !!second?.roomCode);

    const third = await create(b, 'Three');
    ok('the third from one IP is refused', !!third?.error, JSON.stringify(third));
    ok('and says so in terms of time, not capacity', /minutes/i.test(third?.error || ''), third?.error);

    // The limit is per IP, not per socket — opening a new connection is the
    // obvious way around it and must not work.
    const c = await connect();
    const viaNewSocket = await create(c, 'Four');
    ok('a fresh socket from the same IP is refused too', !!viaNewSocket?.error, JSON.stringify(viaNewSocket));
    ok('still only the two rooms exist', (await roomCount()) === 2);

    b.close();
    c.close();
    await down(server);

    /* ------------------------------------------------------------ the guard */
    // Production without a password refuses to boot unless the intent is
    // stated. This is what stops an EnvironmentFile that failed to load from
    // quietly publishing the site.
    const refused = boot({ NODE_ENV: 'production', PORT: String(PORT + 1) });
    const code = await new Promise((r) => refused.proc.on('exit', r));
    ok('production with no password and no opt-in refuses to start', code === 1, `exit ${code}`);
    ok('and says which variable would allow it', /NOPOLY_OPEN/.test(refused.log()), refused.log().slice(0, 200));

    fs.rmSync(STATE, { recursive: true, force: true });

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log(`  ✗ ${f}`);
    process.exit(fails.length ? 1 : 0);
})();
