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

/* ------------------------------------------------------------------ socket */

// Connect only once there's a token to present, otherwise the first attempt is
// guaranteed to be rejected and the client sits in a retry loop.
// `undefined` rather than SERVER_URL's empty string: fetch treats '' as a
// relative base, but socket.io-client would try to parse it as a URL.
// `pid` is not a credential — the token is the gate. It only lets the server
// tell two tabs of the same person apart when counting who's online, before a
// join has given this socket a player id of its own.
export const socket = io(SERVER_URL || undefined, {
    autoConnect: false,
    auth: { token: loadToken(), pid: loadIdentity().playerId || null },
});
