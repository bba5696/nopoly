import { io } from 'socket.io-client';

// A production build is served by the game server itself, so same-origin (an
// empty base) is both correct and impossible to misconfigure — the old
// localhost fallback silently produced a build that connected to nothing.
// VITE_SERVER_URL still overrides, for hosting the client separately.
export const SERVER_URL =
    import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '');

/* ------------------------------------------------------------------ access */

const TOKEN_KEY = 'nopoly.token';

export const loadToken = () => localStorage.getItem(TOKEN_KEY) || '';
export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    // The socket reads `auth` fresh on every connection attempt, so the new
    // token is picked up by the reconnect rather than needing a page reload.
    // Spread rather than replaced: `pid` rides along in here too.
    socket.auth = { ...socket.auth, token };
}
export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    socket.auth = { ...socket.auth, token: '' };
}

/** Whether this deployment has a password at all. */
export async function authRequired() {
    try {
        const res = await fetch(`${SERVER_URL}/auth/required`);
        return (await res.json()).required;
    } catch {
        // Server unreachable — assume a gate rather than flashing the game.
        return true;
    }
}

/**
 * The colour palette, for the profile editor on the home screen where there's
 * no room state to read it from. Fetched once and shared — the list never
 * changes while the page is open.
 */
let metaPromise = null;
export function loadMeta() {
    metaPromise ??= fetch(`${SERVER_URL}/meta`)
        .then((r) => r.json())
        .catch(() => ({ playerColors: [] }));
    return metaPromise;
}

export async function login(password) {
    const res = await fetch(`${SERVER_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || 'Could not sign in' };
    saveToken(body.token);
    return { token: body.token };
}

/* --- identity persisted across reloads so a refresh rejoins the same seat --- */
/* Ahead of the socket, which reads it while this module is still evaluating. */

const KEY = 'nopoly.identity';

export function loadIdentity() {
    try {
        return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
        return {};
    }
}

export function saveIdentity(patch) {
    const next = { ...loadIdentity(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
}

export function clearRoom() {
    saveIdentity({ roomCode: null });
}

/**
 * A stable id for this browser, minted on first load rather than on first join.
 *
 * The head count identifies people by this, and it used to be the player id —
 * which does not exist until you have joined a room. So every socket opened
 * from the home screen fell back to being counted as its own person, and
 * refreshing the page announced a new one each time. On a WebSocket that hid
 * itself, since the old socket closes the instant the tab reloads and the count
 * was corrected before anyone saw it. Behind a proxy that only carries polling,
 * the abort doesn't reach the server and the dead socket lingers for a ping
 * timeout, so the refreshes visibly stack up before settling.
 *
 * Not a credential and never trusted as one: the token is the gate, and the
 * server uses this only to tell two tabs of one person apart.
 */
const CLIENT_KEY = 'nopoly.client';

export function clientId() {
    try {
        const found = localStorage.getItem(CLIENT_KEY);
        if (found) return found;
        const made = crypto.randomUUID();
        localStorage.setItem(CLIENT_KEY, made);
        return made;
    } catch {
        // Private mode with storage blocked. Falls back to per-socket counting,
        // which is what the whole app did before this existed.
        return null;
    }
}

/* ------------------------------------------------------------------ socket */

// Connect only once there's a token to present, otherwise the first attempt is
// guaranteed to be rejected and the client sits in a retry loop.
// `undefined` rather than SERVER_URL's empty string: fetch treats '' as a
// relative base, but socket.io-client would try to parse it as a URL.
// `pid` is not a credential — the token is the gate. It only lets the server
// tell two tabs of the same person apart when counting who's online, before a
// join has given this socket a player id of its own. It is the browser's own
// id rather than the player id: the server maps it onto a seat once there is
// one, and until then it is the only thing that says two tabs are one person.
//
// `transports` is deliberately left at its default of ['polling', 'websocket'].
// Socket.IO opens on HTTP long-polling and upgrades to a WebSocket only if the
// upgrade succeeds, so the same build works whether it reaches the server
// directly or through a CDN that won't carry an upgrade — which is exactly what
// the Vercel rewrite in vercel.json is. Pinning this to ['websocket'] looks
// like a tidy-up and would leave that route dead.
export const socket = io(SERVER_URL || undefined, {
    autoConnect: false,
    auth: { token: loadToken(), pid: clientId() },
});
