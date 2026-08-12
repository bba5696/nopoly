// Room snapshots, so a redeploy doesn't end everyone's game.
//
// Rooms live in memory and always will — this is one process holding a handful
// of games for a friend group, not a database problem. But a restart used to
// take every game running at the time with it, which meant a one-line fix
// couldn't be shipped until everyone had gone to bed. A snapshot on the way
// out and a read on the way back in is enough to make a redeploy a blip.
//
// The state is plain JSON already (no Maps, no class instances, no functions),
// so this is genuinely just a write and a parse.

const fs = require('fs');
const path = require('path');

// systemd hands us $STATE_DIRECTORY when the unit declares StateDirectory=,
// which is also the only writable path under ProtectSystem=strict. Falling back
// inside the repo keeps `node index.js` working on a laptop.
const DIR =
    process.env.NOPOLY_STATE ||
    process.env.STATE_DIRECTORY ||
    path.join(__dirname, '..', '.state');
const FILE = path.join(DIR, 'rooms.json');
const TMP = `${FILE}.tmp`;

/** Snapshots older than this are stale enough that resuming would confuse. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Write every room out. Via a temp file and a rename so a crash mid-write
 * leaves the previous snapshot intact rather than a truncated one — a rename
 * within a directory is atomic.
 */
function save(rooms) {
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const payload = { savedAt: Date.now(), rooms: [...rooms.values()] };
        fs.writeFileSync(TMP, JSON.stringify(payload));
        fs.renameSync(TMP, FILE);
        return { ok: true, count: payload.rooms.length };
    } catch (err) {
        // Never let a failed snapshot take the server down with it — the games
        // in memory are still fine, they just won't survive the next restart.
        return { ok: false, error: err.message };
    }
}

/**
 * Read the snapshot back. Returns [] for anything that isn't a usable file, so
 * a first boot, a corrupt write and a stale snapshot all behave the same way:
 * start empty rather than start wrong.
 */
function load() {
    try {
        const raw = fs.readFileSync(FILE, 'utf8');
        const payload = JSON.parse(raw);
        if (!payload || !Array.isArray(payload.rooms)) return [];
        if (Date.now() - (payload.savedAt || 0) > MAX_AGE_MS) return [];
        return payload.rooms.filter((r) => r && typeof r.roomCode === 'string');
    } catch {
        return [];
    }
}

/** Drop the snapshot once it's been restored, so a crash can't replay it. */
function clear() {
    try {
        fs.rmSync(FILE, { force: true });
    } catch {
        /* nothing to clean up */
    }
}

module.exports = { save, load, clear, FILE };
