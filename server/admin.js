/**
 * The site admin's key.
 *
 * Room codes are the only thing standing between a stranger and a game, so
 * anything that lists them is a list of every open door on the server. That is
 * what an admin panel is, and it is why this is off unless NOPOLY_ADMIN_KEY is
 * set — and refuses to turn on with a key short enough to guess.
 *
 * Not a hardware ID. A web page cannot read one, and the browser id the client
 * does send (`pid`) is a value the browser reports about itself: anyone can put
 * any string there. "Only my device" is therefore a secret that only your
 * device has — the key, entered once and kept in that browser as a token.
 *
 * Built like the password gate in auth.js, and deliberately not sharing its
 * secret: tokens are HMACs keyed by the admin key, so a player's token is never
 * an admin's, every admin token dies the moment the key changes, and they
 * survive a restart without being stored anywhere.
 */

const crypto = require('crypto');
const { sameSecret } = require('./auth');

const KEY = process.env.NOPOLY_ADMIN_KEY || '';
/** Long enough that the attempt limit below makes guessing it hopeless. */
const MIN_KEY_LENGTH = 16;
/** A week: remembered on your device, but not forever if a laptop walks off. */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Tighter than the room password's: there is one person who should be here. */
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const tooShort = () => KEY.length > 0 && KEY.length < MIN_KEY_LENGTH;
const enabled = () => KEY.length >= MIN_KEY_LENGTH;

const sign = (payload) => crypto.createHmac('sha256', `admin:${KEY}`).update(payload).digest('hex');

function issueToken() {
    const expires = Date.now() + TOKEN_TTL_MS;
    return `${expires}.${sign(`admin.${expires}`)}`;
}

function verifyToken(token) {
    // Unlike the room password, off means closed rather than open.
    if (!enabled()) return false;
    if (typeof token !== 'string') return false;
    const [expires, signature] = token.split('.');
    if (!expires || !signature) return false;
    if (!Number(expires) || Number(expires) < Date.now()) return false;
    return sameSecret(signature, sign(`admin.${expires}`));
}

const checkKey = (candidate) => enabled() && sameSecret(String(candidate || ''), KEY);

/* ------------------------------------------------------- brute-force limits */

const attempts = new Map(); // ip -> { count, until }

function tooManyAttempts(ip) {
    const rec = attempts.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.until) {
        attempts.delete(ip);
        return false;
    }
    return rec.count >= MAX_ATTEMPTS;
}

function noteFailure(ip) {
    const rec = attempts.get(ip);
    if (!rec || Date.now() > rec.until) {
        attempts.set(ip, { count: 1, until: Date.now() + ATTEMPT_WINDOW_MS });
        return;
    }
    rec.count += 1;
}

const clearAttempts = (ip) => attempts.delete(ip);

/** Express middleware: the bearer token, or a 401 that says nothing else. */
function requireAdmin(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!verifyToken(token)) return res.status(401).json({ error: 'Not signed in as admin' });
    next();
}

/* ------------------------------------------------------------ the audit log */

// Every sign-in, right or wrong, and everything done with the panel, with the
// address it came from. The key is the whole lock, so this is how its owner
// finds out somebody else has it: a kick they did not make, or a sign-in from
// an address that is not theirs.
//
// In memory, the newest 200, and gone on restart — the same lines go to the
// console, so `journalctl` holds the long history. Written to the log before
// the action's own line, so a failure halfway through still leaves a record of
// who tried.

const AUDIT_MAX = 200;
const audit = [];

function record(req, action, detail = '') {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    audit.unshift({ at: Date.now(), ip, action, detail: String(detail).slice(0, 200) });
    if (audit.length > AUDIT_MAX) audit.length = AUDIT_MAX;
    const line = `Admin: ${action}${detail ? ` — ${detail}` : ''} (${ip})`;
    if (action === 'wrong key') console.warn(line);
    else console.log(line);
}

const auditLog = () => audit.slice();

module.exports = {
    enabled,
    tooShort,
    MIN_KEY_LENGTH,
    issueToken,
    verifyToken,
    checkKey,
    tooManyAttempts,
    noteFailure,
    clearAttempts,
    requireAdmin,
    record,
    auditLog,
};
