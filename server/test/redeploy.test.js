// The actual thing being promised: restart the server mid-game and have the
// table carry on. Drives a real server process, kills it with SIGTERM the way
// systemd does, starts a fresh one, and checks the game is still there.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..');
const STATE = path.join(__dirname, 'state-redeploy');
const URL = 'http://localhost:3002';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boot() {
    const p = spawn(process.execPath, ['index.js'], {
        cwd: SERVER,
        env: { ...process.env, PORT: '3002', NOPOLY_STATE: STATE, NODE_ENV: 'development' },
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

const connect = () => new Promise((r) => { const s = io(URL, { auth: { token: 'open' } }); s.on('connect', () => r(s)); });
const quiet = (s) => new Promise((res) => { let last = null; const on = (st) => (last = st); s.on('state', on);
    const t = setInterval(() => { if (!last) return; clearInterval(t); s.off('state', on); res(last); }, 200); });

(async () => {
    fs.rmSync(STATE, { recursive: true, force: true });

    /* ---------------------------------------------------- first process */
    let server = boot();
    ok('server comes up', await waitUp());

    const a = await connect();
    const b = await connect();
    const created = await new Promise((r) => a.emit('room:create', { name: 'Ada' }, r));
    const code = created.roomCode;
    const adaId = created.playerId;
    const bj = await new Promise((r) => b.emit('room:join', { roomCode: code, name: 'Bo' }, r));

    a.emit('room:settings', { startingCash: 2500 });
    a.emit('game:start');
    let st = await quiet(a);
    ok('a game is running', st.phase !== 'waiting', st.phase);
    ok('with the settings we chose', st.settings.startingCash === 2500);

    // Play a little so there is something to lose.
    a.emit('game:roll');
    st = await quiet(a);
    const turnsBefore = st.stats.turnCount;
    a.emit('chat:send', { text: 'mid-game marker' });
    st = await quiet(a);
    ok('chat landed', st.chat.some((c) => c.text === 'mid-game marker'));
    const cashBefore = Object.fromEntries(st.players.map((p) => [p.name, p.cash]));
    const posBefore = Object.fromEntries(st.players.map((p) => [p.name, p.position]));

    /* -------------------------------------------------------------- restart
     * Windows terminates on SIGTERM without running the exit handler, so the
     * graceful-save path can't be driven from here. Waiting for the periodic
     * autosave instead exercises the same persist.save() and additionally
     * covers the case the shutdown hook can't: a hard kill. */
    const snapshot = path.join(STATE, 'rooms.json');
    for (let i = 0; i < 50 && !fs.existsSync(snapshot); i++) await sleep(500);
    ok('the autosave wrote a snapshot', fs.existsSync(snapshot));

    server.proc.kill();
    await new Promise((r) => server.proc.on('exit', r));

    a.close();
    b.close();

    /* ---------------------------------------------------- second process */
    server = boot();
    ok('server comes back', await waitUp());
    await sleep(300);
    ok('boot reported a resume', /State: resumed 1 room/.test(server.log()), server.log().slice(-300));

    // Read now, not at the end: the snapshot must not be replayable, but the
    // 15s autosave legitimately writes a fresh one while the game carries on.
    // Asserting on the file after another dozen round trips was a race with it,
    // and one this suite lost as soon as the machine was busy.
    const consumedOnBoot = !fs.existsSync(path.join(STATE, 'rooms.json'));

    // Rejoin exactly the way the browser does after a reload: same stored id.
    const a2 = await connect();
    const rejoined = await new Promise((r) => a2.emit('room:join', { roomCode: code, name: 'Ada', playerId: adaId }, r));
    ok('the room is still there', !rejoined.error, JSON.stringify(rejoined.error));
    ok('and the same seat is ours', rejoined.playerId === adaId);

    if (!rejoined.state) {
        console.log('rejoin returned:', JSON.stringify(rejoined));
        console.log('--- server log ---\n' + server.log());
        console.log('state dir:', fs.existsSync(STATE) ? fs.readdirSync(STATE) : 'missing');
        process.exit(1);
    }
    const after = rejoined.state;
    ok('the game is still in progress', after.phase !== 'waiting' && after.phase !== 'ended', after.phase);
    ok('both players survived', after.players.length === 2);
    ok('settings survived', after.settings.startingCash === 2500);
    ok('turn count survived', after.stats.turnCount === turnsBefore, `${after.stats.turnCount} vs ${turnsBefore}`);
    ok('chat survived', after.chat.some((c) => c.text === 'mid-game marker'));
    ok('cash survived', after.players.every((p) => p.cash === cashBefore[p.name]),
        JSON.stringify(after.players.map((p) => [p.name, p.cash])));
    ok('board positions survived', after.players.every((p) => p.position === posBefore[p.name]));
    ok('Bo is marked away until he reconnects', after.players.find((p) => p.id === bj.playerId).connected === false);

    // Bo comes back too, and the game is playable.
    const b2 = await connect();
    const bBack = await new Promise((r) => b2.emit('room:join', { roomCode: code, name: 'Bo', playerId: bj.playerId }, r));
    ok('Bo gets his seat back', !bBack.error && bBack.playerId === bj.playerId);
    st = await quiet(a2);
    ok('and shows as connected', st.players.find((p) => p.id === bj.playerId).connected === true);

    ok('the snapshot was consumed on boot', consumedOnBoot);

    /* ----------------------------------------------------------- /version */
    const v = await (await fetch(`${URL}/version`)).json();
    ok('version endpoint answers', typeof v.version === 'string', JSON.stringify(v));
    // Not the mtime fallback: that still changes per build, so it looks like it
    // works, while the client's matching lookup returns null and never reloads.
    ok('and names the built bundle', /assets\/(?:index|main)-.*\.js/.test(v.version) || v.version === 'dev', v.version);

    a2.close();
    b2.close();
    server.proc.kill('SIGTERM');
    await new Promise((r) => server.proc.on('exit', r));
    fs.rmSync(STATE, { recursive: true, force: true });

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
