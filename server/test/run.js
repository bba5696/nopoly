// Test runner.
//
// The suites are plain scripts rather than a framework: each one counts its own
// assertions, prints a tally and exits non-zero if anything failed. So this only
// has to run them in the right conditions and add up the exit codes.
//
// Three kinds, and the difference is what each needs standing behind it:
//
//   engine  nothing at all — they build rooms in memory and call the engine
//   wire    a real server on :3001, shared by all of them, because a socket
//           test is the only way to cover the parts that live in index.js
//           (the timers, the grace period, the presence count, act()'s guards)
//   solo    a suite that drives server processes itself; redeploy boots one,
//           SIGTERMs it the way systemd does and boots another, limits
//           boots servers with the room caps turned down far enough to hit,
//           and cleanup boots servers whose room lifetimes are measured in
//           milliseconds
//
// Two of the wire suites would otherwise sit and wait out a real timer, so the
// shared server is started with both windows shortened. That's the only reason
// those overrides exist in the source.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ENGINE = [
    'payment', 'idle', 'spectate', 'build', 'teams', 'vote',
    'abandon', 'profile', 'leave', 'jail-persist', 'tax',
];
const WIRE = [
    'wire', 'votewire', 'leavewire', 'abandonwire',
    'spectatewire', 'idlewire', 'rentwire', 'presence', 'polling',
];
const SOLO = ['redeploy', 'limits', 'cleanup'];
/** ESM, so it can import the client's copy of the rent maths directly. */
const ESM = ['lopsided.mjs'];

/** Shortened so `presence` and `idlewire` don't sit out a real 3-minute window. */
const SERVER_ENV = {
    PORT: '3001',
    NODE_ENV: 'development',
    NOPOLY_AWAY_MS: '3000',
    NOPOLY_IDLE_MS: '3000',
    // Never the developer's real snapshot, and never the repo's .state — a test
    // run must not be able to resume, or corrupt, a game someone is playing.
    NOPOLY_STATE: path.join(__dirname, 'state-wire'),
    // A .env with a password set would otherwise make every handshake fail.
    // dotenv does not override what is already in the environment.
    NOPOLY_PASSWORD: '',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runFile(file, env = {}) {
    return new Promise((resolve) => {
        const proc = spawn(process.execPath, [path.join(__dirname, file)], {
            cwd: __dirname,
            env: { ...process.env, ...env },
            stdio: 'inherit',
        });
        proc.on('exit', (code) => resolve(code === 0));
    });
}

/** Boot the shared server and wait until it actually answers. */
async function bootServer() {
    // Staged rooms go down before the process comes up: restoreRooms() reads
    // the snapshot once, at boot, and deletes it on the way through.
    require('./fixture').write(SERVER_ENV.NOPOLY_STATE);
    const proc = spawn(process.execPath, ['index.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, ...SERVER_ENV },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));

    for (let i = 0; i < 60; i++) {
        try {
            const res = await fetch('http://localhost:3001/health');
            if (res.ok) return proc;
        } catch {
            /* not up yet */
        }
        await sleep(250);
    }
    proc.kill();
    throw new Error(`server did not come up on :3001\n${out}`);
}

async function main() {
    const only = process.argv[2];
    const want = (name) => !only || name.includes(only);
    const results = [];

    fs.rmSync(SERVER_ENV.NOPOLY_STATE, { recursive: true, force: true });

    const engine = [...ENGINE.map((n) => `${n}.test.js`), ...ESM].filter(want);
    for (const file of engine) {
        console.log(`\n\x1b[1m── ${file}\x1b[0m`);
        results.push([file, await runFile(file)]);
    }

    const wire = WIRE.map((n) => `${n}.test.js`).filter(want);
    if (wire.length) {
        console.log('\n\x1b[2mstarting a server on :3001 for the socket suites…\x1b[0m');
        const server = await bootServer();
        try {
            for (const file of wire) {
                console.log(`\n\x1b[1m── ${file}\x1b[0m`);
                results.push([file, await runFile(file)]);
            }
        } finally {
            server.kill();
        }
    }

    // After the shared server is down: this one wants the port to itself.
    for (const file of SOLO.map((n) => `${n}.test.js`).filter(want)) {
        console.log(`\n\x1b[1m── ${file}\x1b[0m`);
        results.push([file, await runFile(file)]);
    }

    fs.rmSync(SERVER_ENV.NOPOLY_STATE, { recursive: true, force: true });

    const failed = results.filter(([, ok]) => !ok);
    console.log(`\n\x1b[1m${results.length - failed.length}/${results.length} suites passed\x1b[0m`);
    for (const [file] of failed) console.log(`  \x1b[31mFAILED\x1b[0m ${file}`);
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
