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
const fsp = require('fs/promises');
const path = require('path');

// systemd hands us $STATE_DIRECTORY when the unit declares StateDirectory=,
// which is also the only writable path under ProtectSystem=strict. Falling back
// inside the repo keeps `node index.js` working on a laptop.
const DIR =
    process.env.NOPOLY_STATE ||
    process.env.STATE_DIRECTORY ||
    path.join(__dirname, '..', '.state');
const FILE = path.join(DIR, 'rooms.json');

/** Snapshots older than this are stale enough that resuming would confuse. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

// A temp path unique per write, rather than one shared `rooms.json.tmp`.
// The periodic save is async and the shutdown save is not, so the two can
// overlap — and sharing a temp file means one can be part-way through writing
// it while the other renames it into place, publishing a truncated snapshot.
// Separate temp files make each rename atomic and complete, so the worst case
// is simply that the later rename wins.
let seq = 0;
const tempPath = () => `${FILE}.${process.pid}.${++seq}.tmp`;

const payloadFor = (rooms) => ({ savedAt: Date.now(), rooms: [...rooms.values()] });

/**
 * Write every room out, blocking. Used on the way out, where the process is
 * about to exit and there is nothing left to block.
 *
 * Via a temp file and a rename so a crash mid-write leaves the previous
 * snapshot intact rather than a truncated one — a rename within a directory is
 * atomic.
 */
function save(rooms) {
    const tmp = tempPath();
    try {
        fs.mkdirSync(DIR, { recursive: true });
        const payload = payloadFor(rooms);
        fs.writeFileSync(tmp, JSON.stringify(payload));
        fs.renameSync(tmp, FILE);
        return { ok: true, count: payload.rooms.length };
    } catch (err) {
        // Never let a failed snapshot take the server down with it — the games
        // in memory are still fine, they just won't survive the next restart.
        try {
            fs.rmSync(tmp, { force: true });
        } catch { /* the failure above is the one worth reporting */ }
        return { ok: false, error: err.message };
    }
}

/** Set while an async save is in flight, so a slow disk can't stack them up. */
let writing = false;

/**
 * The same write, without blocking the event loop on the disk. This is the one
 * the 15-second autosave uses: every player's moves run through this process,
 * so a synchronous write stalls the whole table for as long as the disk takes.
 *
 * `JSON.stringify` is still synchronous and still proportional to how many
 * rooms are live — this moves the disk wait off the loop, not the serialising.
 * What bounds that cost is the room cap in index.js.
 *
 * Overlapping calls are dropped rather than queued. The next tick is fifteen
 * seconds away and writes a strictly newer snapshot, so a skipped one costs
 * nothing.
 */
async function saveAsync(rooms) {
    if (writing) return { ok: false, skipped: true };
    writing = true;
    const tmp = tempPath();
    try {
        await fsp.mkdir(DIR, { recursive: true });
        const payload = payloadFor(rooms);
        await fsp.writeFile(tmp, JSON.stringify(payload));
        await fsp.rename(tmp, FILE);
        return { ok: true, count: payload.rooms.length };
    } catch (err) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        return { ok: false, error: err.message };
    } finally {
        writing = false;
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

module.exports = { save, saveAsync, load, clear, FILE };
