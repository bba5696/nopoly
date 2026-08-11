/**
 * Shared-password gate for the whole site.
 *
 * One password for the friend group, set as NOPOLY_PASSWORD. Leaving it unset
 * disables the gate entirely, which is what you want in local dev — the server
 * says so loudly at boot so it can't be missed in production.
 *
 * The check that matters is the Socket.IO handshake, not the login screen: the
 * game server is the actual resource, and a client-side gate is bypassed by
 * opening a socket straight at it. Signing in over HTTP only mints the token
 * the handshake then demands.
 *
 * Tokens are HMACs keyed by the password itself, so they survive a restart and
 * every one of them stops working the moment the password changes.
 */

const crypto = require('crypto');

const PASSWORD = process.env.NOPOLY_PASSWORD || '';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month; this is a game, not a bank

/** Wrong guesses allowed per IP before it has to wait. */
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const enabled = () => PASSWORD.length > 0;

/** Compare without leaking how much of the password matched via timing. */
function sameSecret(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    // timingSafeEqual throws on a length mismatch, so hash first to equal width.
    const ah = crypto.createHash('sha256').update(ab).digest();
    const bh = crypto.createHash('sha256').update(bb).digest();
    return crypto.timingSafeEqual(ah, bh);
}

const sign = (payload) => crypto.createHmac('sha256', PASSWORD).update(payload).digest('hex');

function issueToken() {
    const expires = Date.now() + TOKEN_TTL_MS;
    return `${expires}.${sign(String(expires))}`;
}

function verifyToken(token) {
    if (!enabled()) return true;
    if (typeof token !== 'string') return false;
    const [expires, signature] = token.split('.');
    if (!expires || !signature) return false;
    if (!Number(expires) || Number(expires) < Date.now()) return false;
    return sameSecret(signature, sign(expires));
}

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

module.exports = {
    enabled,
    issueToken,
    verifyToken,
    sameSecret,
    password: () => PASSWORD,
    tooManyAttempts,
    noteFailure,
    clearAttempts,
};
