/**
 * The admin panel's side of the admin API.
 *
 * The token lives in this browser only, which is what "only my device" comes
 * to on the web — see server/admin.js for why it is a key and not a hardware
 * id. It is kept apart from the room password's token on purpose: signing out
 * of one never touches the other, and a player token is never sent where an
 * admin one is expected.
 */
import { SERVER_URL } from '@/lib/socket';

const KEY = 'nopoly.admin';

export const isAdminPath = (pathname = location.pathname) => pathname.replace(/\/+$/, '') === '/admin';

export function loadAdminToken() {
    try {
        return localStorage.getItem(KEY) || '';
    } catch {
        return '';
    }
}

function saveAdminToken(token) {
    try {
        localStorage.setItem(KEY, token);
    } catch {
        /* storage blocked: signed in for this tab only */
    }
}

export function clearAdminToken() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* nothing kept */
    }
}

/** A refused token is a signed-out panel, not an error to show. */
export class SignedOut extends Error {}

async function call(path, { method = 'GET', body } = {}) {
    const token = loadAdminToken();
    const res = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && path !== '/api/admin/login') {
        clearAdminToken();
        throw new SignedOut('Signed out');
    }
    // A server that predates the panel answers with the app's HTML.
    const data = await res.json().catch(() => ({ error: `The server answered ${res.status}` }));
    if (!res.ok) throw new Error(data.error || `The server answered ${res.status}`);
    return data;
}

export async function signIn(key) {
    const { token } = await call('/api/admin/login', { method: 'POST', body: { key } });
    saveAdminToken(token);
}

const act = (code, what, body = {}) => call(`/api/admin/rooms/${code}/${what}`, { method: 'POST', body });

export const listRooms = () => call('/api/admin/rooms');
export const watchRoom = (code) => call(`/api/admin/rooms/${code}`);
export const kick = (code, playerId) => act(code, 'kick', { playerId });
export const unban = (code, playerId) => act(code, 'unban', { playerId });
export const setPaused = (code, paused) => act(code, 'pause', { paused });
export const playTurn = (code) => act(code, 'play-turn');
export const finishDeadline = (code) => act(code, 'finish-deadline');
export const endRoom = (code) => act(code, 'end');

export const health = () => call('/api/admin/health');
export const auditLog = () => call('/api/admin/log');
/** An empty text clears whatever notice is up. */
export const sendNotice = (text, minutes) => call('/api/admin/notice', { method: 'POST', body: { text, minutes } });
