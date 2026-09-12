/**
 * What is actually at stake in an auction.
 *
 * The question everyone at the table asks out loud while the clock runs is not
 * what the tile costs — it is whether the person in front is about to finish a
 * set. That used to be unanswerable: the auction was a modal over a blacked-out
 * board, so the one thing you needed to look at was the one thing covered up.
 *
 * So the answer is worked out here, once, and used in two places: the panel in
 * the middle of the board says it in words, and the board itself lights the
 * country in the leader's colour when the answer is yes.
 *
 * Display only — the server decides who wins and what rent it charges. These
 * mirror its rules (see rent.js, which mirrors rentFor) rather than asking it,
 * because the answer has to change the instant a bid lands.
 */
import { sameSide } from './rent.js';

/**
 * Everything the auctioned tile belongs with: its country, or — for airports
 * and utilities, which have no country — every tile of the same kind.
 *
 * Both are a set in the sense that matters here: holding all of them is what
 * changes what they charge.
 */
export function lotGroup(state, tile) {
    if (!tile) return [];
    if (tile.groupId) return state.tiles.filter((t) => t.groupId === tile.groupId);
    if (tile.type === 'airport' || tile.type === 'utility') {
        return state.tiles.filter((t) => t.type === tile.type);
    }
    return [tile];
}

/** What the group is called, in the words the panel uses. */
export function lotGroupName(state, tile, board) {
    if (!tile) return '';
    if (tile.groupId) return board?.groups?.[tile.groupId]?.name || 'this country';
    if (tile.type === 'airport') return 'the airports';
    if (tile.type === 'utility') return 'the utilities';
    return tile.name;
}

/**
 * How the group stands if `playerId` wins the lot — held now, held after, and
 * whether that is the whole set.
 *
 * Counted by side rather than by owner, so a teammate's deed counts towards it,
 * which is how the server counts a set.
 */
export function lotStakes(state, tile, playerId) {
    const group = lotGroup(state, tile);
    const total = group.length;
    const held = group.filter((t) => t.id !== tile.id && sameSide(state, t.ownerId, playerId)).length;
    const after = held + 1;
    return {
        total,
        held,
        after,
        completes: total > 1 && after === total,
    };
}

/**
 * What the lot would charge if `playerId` won it, and what it charges now —
 * the consequence of a set, in the only units anyone cares about.
 *
 * Returns null when there is nothing worth saying: an unowned tile whose group
 * stays unfinished pays its own printed rent either way, and the rent ladder
 * beside the panel already says so.
 */
export function lotRent(state, tile, playerId) {
    if (!playerId) return null;
    const { completes } = lotStakes(state, tile, playerId);

    if (tile.type === 'property') {
        if (!completes || !state.settings?.doubleRent) return null;
        const base = Math.round(tile.rent[0] * (tile.marketRentMult ?? 1));
        return { now: `$${base}`, then: `$${tile.rent[0] * 2}`, why: 'the whole set pays double' };
    }

    // Airports and utilities charge by how many of them one side holds, so
    // every extra one moves the rent — not only the last.
    const owned = state.tiles.filter((t) => t.type === tile.type && sameSide(state, t.ownerId, playerId)).length;
    if (tile.type === 'airport' || tile.type === 'utility') {
        const table = tile.type === 'airport' ? state.board?.airportRent : state.board?.utilityMultiplier;
        if (!table?.length) return null;
        const at = (n) => table[Math.min(Math.max(n - 1, 0), table.length - 1)];
        const unit = tile.type === 'airport' ? (v) => `$${v}` : (v) => `×${v} dice`;
        return {
            now: owned ? unit(at(owned)) : '—',
            then: unit(at(owned + 1)),
            why: `${owned + 1} of ${table.length}`,
        };
    }
    return null;
}
