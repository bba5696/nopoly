/**
 * Games you have finished, kept on this device.
 *
 * There is no database behind this game and a room is reclaimed by the server
 * within the hour, so there is nothing to look a finished game up in — the end
 * screen used to exist only for as long as the tab stayed open. This keeps the
 * numbers it was drawn from in localStorage instead, which means the record
 * belongs to whoever was sitting there: private by default, gone if they clear
 * their browser, and never uploaded anywhere.
 *
 * The trade is that a history is per-device and per-player rather than one
 * shared archive — four people who played the same game each keep their own
 * copy of it. Sharing is therefore a picture rather than a link, which is what
 * `share-card.js` already made for the end screen.
 */

const KEY = 'nopoly.history';
/** Older games fall off the end. Twenty-five is far more than anyone scrolls. */
const MAX = 25;

/**
 * Thin the net-worth samples to at most `max` points, keeping the first and the
 * last.
 *
 * One sample per turn is more than the chart can show: it is a few hundred
 * pixels wide, so past a couple of hundred points every extra one lands on a
 * pixel already drawn. What they do cost is size — a four-hundred-turn game
 * with twelve players is over a hundred kilobytes of samples, which is too big
 * to post as a link and enough to fill a browser's storage in a dozen games.
 *
 * Evenly spaced rather than tail-first: the shape of the game is the point, and
 * dropping its middle would flatten exactly the part people look at.
 */
export function thinSeries(series, max) {
    const list = Array.isArray(series) ? series : [];
    if (list.length <= max) return list;
    const step = (list.length - 1) / (max - 1);
    const out = [];
    for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]);
    // The last sample is the one the standings agree with, so it is never the
    // one rounding drops.
    out[out.length - 1] = list[list.length - 1];
    return out;
}

/** What a saved game keeps, and what a link carries. */
const SAVED_POINTS = 300;
export const SHARED_POINTS = 150;

/** Everything the end screen draws, resolved to plain values. */
export function entryFromState(state) {
    const players = state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        initials: p.initials,
        teamId: p.teamId,
        bankrupt: p.bankrupt,
        netWorth: p.netWorth,
    }));
    const winnerIds = state.winnerTeam
        ? players.filter((p) => p.teamId === state.winnerTeam && !p.bankrupt).map((p) => p.id)
        : players.filter((p) => p.id === state.winnerId).map((p) => p.id);

    const top = (map) => {
        const rows = Object.entries(map || {});
        if (!rows.length) return null;
        return rows.sort((a, b) => b[1] - a[1])[0];
    };
    const visited = top(state.stats.visits);
    const jailed = top(state.stats.jailVisits);

    return {
        // The room and the moment together: a rematch in the same room is a
        // different game and gets its own row.
        id: `${state.roomCode}-${state.stats.endedAt || Date.now()}`,
        roomCode: state.roomCode,
        nickname: '',
        startedAt: state.stats.startedAt || null,
        endedAt: state.stats.endedAt || Date.now(),
        boardName: state.board?.name || null,
        winnerTeam: state.winnerTeam || null,
        winnerIds,
        players,
        // [{ turn, values: { playerId: net } }] — the chart, thinned to what it
        // can actually draw.
        series: thinSeries(state.stats.netWorth || [], SAVED_POINTS),
        facts: {
            turnCount: state.stats.turnCount || 0,
            doubles: state.stats.doubles || 0,
            trades: state.stats.trades || 0,
            chatMessages: state.stats.chatMessages || 0,
        },
        mostVisited: visited ? { name: state.tiles[visited[0]]?.name || '—', count: visited[1] } : null,
        mostJail: jailed
            ? { name: players.find((p) => p.id === jailed[0])?.name || '—', count: jailed[1] }
            : null,
    };
    // The picture is derived from this record wherever it is needed, not kept
    // beside it: a stored card is a second copy of the same chart, and two
    // copies of a thing are two chances for them to disagree.
}

function read() {
    try {
        const raw = localStorage.getItem(KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        // Private windows, cleared storage, a half-written value — an empty
        // history is the right answer to all of them.
        return [];
    }
}

function write(list) {
    try {
        localStorage.setItem(KEY, JSON.stringify(list));
        return true;
    } catch {
        // Out of quota, most likely. Drop the oldest half and try once more
        // rather than losing the game that just finished.
        try {
            localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.ceil(list.length / 2))));
            return true;
        } catch {
            return false;
        }
    }
}

/** Newest first. */
export function loadHistory() {
    return read().sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
}

export function historyCount() {
    return read().length;
}

/**
 * Keep a finished game. Idempotent on the id, so a re-render, a refresh or a
 * reconnect to the same ended room writes the same row rather than a second
 * copy — but a nickname already given to it survives.
 */
export function saveEntry(entry) {
    const list = read();
    const existing = list.find((e) => e.id === entry.id);
    const merged = existing ? { ...entry, nickname: existing.nickname || entry.nickname } : entry;
    const rest = list.filter((e) => e.id !== entry.id);
    write([merged, ...rest].sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, MAX));
    return merged;
}

export function renameEntry(id, nickname) {
    const list = read().map((e) => (e.id === id ? { ...e, nickname: nickname.slice(0, 60) } : e));
    write(list);
    return list;
}

export function removeEntry(id) {
    const list = read().filter((e) => e.id !== id);
    write(list);
    return list;
}

export function clearHistory() {
    try {
        localStorage.removeItem(KEY);
    } catch {
        /* nothing kept means nothing to clear */
    }
}

/** How long the game ran, in the words the end screen uses. */
export function durationOf(entry) {
    if (!entry.startedAt) return '—';
    const ms = (entry.endedAt || Date.now()) - entry.startedAt;
    return `${Math.floor(ms / 60000)} min ${Math.floor((ms % 60000) / 1000)} sec`;
}

/** "just now", "3 hours ago", "12 Sept" — a date nobody has to decode. */
export function whenOf(endedAt) {
    if (!endedAt) return '';
    const mins = Math.round((Date.now() - endedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(endedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The full stamp, for the places that should be exact rather than friendly. */
export function stampOf(endedAt) {
    if (!endedAt) return '';
    return new Date(endedAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** What a saved game is called: what it was named, or who won it. */
export function titleOf(entry) {
    if (entry.nickname) return entry.nickname;
    const winners = entry.players.filter((p) => entry.winnerIds.includes(p.id));
    if (!winners.length) return 'Nobody won';
    return `${winners.map((w) => w.name).join(' & ')} won`;
}
