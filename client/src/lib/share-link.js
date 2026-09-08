/**
 * A finished game, put somewhere a link can reach — for a few minutes.
 *
 * The history is kept in this browser, which is the right place for it and no
 * use for showing anybody else. A link is the exception: the end screen is
 * posted to the server, held in memory under an id nobody could guess, and
 * dropped at the deadline whether it was opened or not. Nothing is written to
 * disk and there is no way to list what exists, so the link is the only way in.
 *
 * Only what the picture already shows goes up — names, colours, standings and
 * the chart. Whoever holds the link can see it, so making one is a decision,
 * which is why it is a button rather than something that happens on its own.
 */

/** Everything the shared page draws. The card is rebuilt on the far side. */
function payload(entry) {
    const { card, id, ...rest } = entry;
    void card;
    void id;
    return rest;
}

export async function createShareLink(entry) {
    const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(entry)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not make a link');
    return { ...data, url: `${location.origin}${data.path}` };
}

export async function fetchShare(id) {
    const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
    if (res.status === 410) return { expired: true };
    if (!res.ok) throw new Error('Could not open that link');
    return res.json();
}

/** "9 minutes", "40 seconds" — how long is left, in words. */
export function timeLeft(expiresAt) {
    const ms = Math.max((expiresAt || 0) - Date.now(), 0);
    const mins = Math.floor(ms / 60000);
    if (mins >= 1) return `${mins} minute${mins === 1 ? '' : 's'}`;
    return `${Math.ceil(ms / 1000)} seconds`;
}

/** The id in /s/<id>, or null when this isn't a shared-game URL. */
export function sharedIdFromPath(pathname = location.pathname) {
    const m = /^\/s\/([A-Za-z0-9_-]{6,32})\/?$/.exec(pathname);
    return m ? m[1] : null;
}
