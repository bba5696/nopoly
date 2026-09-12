// Mirrors server/game/engine.js rentFor() for display purposes only —
// the server stays authoritative for anything that moves money.

// Extension included so plain Node can import this file too — the trade
// fairness check below is covered by server/test/lopsided.mjs, which loads this
// module directly rather than keeping a second copy of the thresholds.
import { priceOf } from './market.js';

// Fallbacks only — the live tables come from the board the room is on, since
// boards differ (Worldwide has a third utility).
const DEFAULT_AIRPORT_RENT = [25, 50, 100, 200];
const DEFAULT_UTILITY_MULTIPLIER = [4, 10];

const airportRent = (state) => state?.board?.airportRent || DEFAULT_AIRPORT_RENT;
const utilityMultiplier = (state) => state?.board?.utilityMultiplier || DEFAULT_UTILITY_MULTIPLIER;
const step = (table, owned) => table[Math.min(Math.max(owned - 1, 0), table.length - 1)];

/**
 * Do these two ids own as one? Mirrors engine.sameSide — with teams on, a deed
 * held by your teammate counts towards your sets and your airport tally.
 */
export function sameSide(state, a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (!state.settings?.teams) return false;
    const team = (id) => state.players.find((p) => p.id === id)?.teamId || null;
    const ta = team(a);
    return !!ta && ta === team(b);
}

export function ownsFullGroup(state, ownerId, groupId) {
    if (!groupId || !ownerId) return false;
    const tiles = state.tiles.filter((t) => t.groupId === groupId);
    return tiles.length > 0 && tiles.every((t) => sameSide(state, t.ownerId, ownerId));
}

/**
 * Every country this player's side has completed, in board order.
 *
 * What "completed" means is ownsFullGroup's business — with teams on, a set can
 * be split between two people and still be a set.
 */
export function completedSets(state, playerId) {
    const found = [];
    for (const tile of state.tiles) {
        if (tile.type !== 'property' || !tile.groupId || found.includes(tile.groupId)) continue;
        if (ownsFullGroup(state, playerId, tile.groupId)) found.push(tile.groupId);
    }
    return found;
}

/**
 * What a player's estate would raise if it were all sold right now — buildings
 * come back at half. Mirrors engine.liquidValue, and unlike net worth it's the
 * number that decides whether a debt can actually be covered.
 */
export function liquidValue(state, player) {
    if (!player) return 0;
    return player.properties.reduce((sum, id) => {
        const tile = state.tiles[id];
        return sum + priceOf(tile) + tile.houses * Math.floor((tile.houseCost || 0) / 2);
    }, player.cash);
}

/**
 * Rough worth of one side of a trade: cash plus what the properties would cost
 * to buy, with buildings at what they cost to put up.
 *
 * Deliberately crude. A completed set is worth far more than the sum of its
 * deeds and this doesn't try to know that — it only exists to catch the offer
 * that is obviously lopsided, and being clever here would start second-guessing
 * trades that are actually fine.
 */
export function sideValue(state, side) {
    const tiles = (side?.tiles || []).reduce((sum, id) => {
        const tile = state.tiles[id];
        if (!tile) return sum;
        return sum + priceOf(tile) + tile.houses * (tile.houseCost || 0);
    }, 0);
    return tiles + (side?.cash || 0);
}

/** Below this the gap isn't worth a prompt, however lopsided the ratio looks. */
const LOPSIDED_FLOOR = 120;
/** Giving this many times what you get back is what counts as lopsided. */
const LOPSIDED_RATIO = 1.5;

/**
 * Is this offer bad enough for the person accepting that they should be asked
 * twice? Returns null when it's fine, or the two values when it isn't.
 *
 * Only ever flags a trade against the accepter — talking someone *into* a good
 * deal is not something to warn about.
 */
export function lopsidedFor(state, trade, playerId) {
    if (!trade || trade.toId !== playerId) return null;
    // `give` is what the sender hands over, so it's what the accepter receives.
    const getting = sideValue(state, trade.give);
    const giving = sideValue(state, trade.get);
    if (giving - getting < LOPSIDED_FLOOR) return null;
    if (giving < getting * LOPSIDED_RATIO) return null;
    return { giving, getting, gap: giving - getting };
}

/** How many tiles of a kind the owner's whole side holds. */
function sideHolding(state, ownerId, type) {
    return state.tiles.filter((t) => t.type === type && sameSide(state, t.ownerId, ownerId)).length;
}

/**
 * The dynamic-values multiplier the server is currently charging on this tile.
 * It's already faded out server-side for built-up or fully-owned tiles, so this
 * is 1 whenever the market has stopped applying.
 */
const liveRent = (tile, base) => Math.round(base * (tile.marketRentMult ?? 1));

export function currentRent(state, tile) {
    const owner = state.players.find((p) => p.id === tile.ownerId);
    if (!owner) return null;
    if (tile.type === 'property') {
        if (tile.houses > 0) return { label: `$${tile.rent[tile.houses]}`, value: tile.rent[tile.houses] };
        const doubled = state.settings.doubleRent && ownsFullGroup(state, owner.id, tile.groupId);
        const value = liveRent(tile, doubled ? tile.rent[0] * 2 : tile.rent[0]);
        return { label: `$${value}`, value };
    }
    if (tile.type === 'airport') {
        const owned = sideHolding(state, owner.id, 'airport');
        const value = liveRent(tile, step(airportRent(state), owned));
        return { label: `$${value}`, value };
    }
    if (tile.type === 'utility') {
        const owned = sideHolding(state, owner.id, 'utility');
        return { label: `×${diceMult(tile, step(utilityMultiplier(state), owned))}`, value: 0 };
    }
    return null;
}

/** Utilities charge a multiple of the dice, so the market shifts that multiple. */
function diceMult(tile, base) {
    const live = base * (tile.marketRentMult ?? 1);
    return Number.isInteger(live) ? live : live.toFixed(1);
}

/**
 * Full rent ladder for the property card shown when you land on a tile.
 *
 * Only the rows the market can actually reach are scaled. Everything past the
 * first one implies a completed set — houses need one, and the last airport or
 * utility row *is* one — and a completed set pays book rate.
 */
export function rentTable(state, tile) {
    const mult = tile.marketMult ?? 1;
    const scaled = (base) => `$${Math.round(base * mult)}`;

    if (tile.type === 'property') {
        return [
            { k: 'rent', v: scaled(tile.rent[0]) },
            ...(state.settings.doubleRent ? [{ k: 'with full set', v: `$${tile.rent[0] * 2}` }] : []),
            { k: '1 house', v: `$${tile.rent[1]}` },
            { k: '2 houses', v: `$${tile.rent[2]}` },
            { k: '3 houses', v: `$${tile.rent[3]}` },
            { k: '4 houses', v: `$${tile.rent[4]}` },
            { k: 'hotel', v: `$${tile.rent[5]}` },
            { k: 'house cost', v: `$${tile.houseCost}` },
        ];
    }
    if (tile.type === 'airport') {
        const table = airportRent(state);
        const all = table.length - 1;
        return table.map((r, i) => ({
            k: `${i + 1} airport${i ? 's' : ''}`,
            v: i === all ? `$${r}` : scaled(r),
        }));
    }
    if (tile.type === 'utility') {
        const table = utilityMultiplier(state);
        const all = table.length - 1;
        return table.map((m, i) => ({
            k: `${i + 1} utilit${i ? 'ies' : 'y'}`,
            v: i === all ? `×${m} dice` : `×${diceMult(tile, m)} dice`,
        }));
    }
    return [];
}

/** Anyone on the side can develop the side's set, out of their own cash. */
export function canBuild(state, player, tile) {
    if (!player || tile.type !== 'property' || !sameSide(state, tile.ownerId, player.id)) return false;
    if (!ownsFullGroup(state, player.id, tile.groupId)) return false;
    if (tile.houses >= 5) return false;
    if (player.cash < tile.houseCost) return false;
    if (!state.settings.evenBuild) return true;
    const group = state.tiles.filter((t) => t.groupId === tile.groupId);
    return tile.houses === Math.min(...group.map((t) => t.houses));
}

export function canSell(state, player, tile) {
    if (!player || tile.ownerId !== player.id || tile.houses < 1) return false;
    if (!state.settings.evenBuild) return true;
    const group = state.tiles.filter((t) => t.groupId === tile.groupId);
    return tile.houses === Math.max(...group.map((t) => t.houses));
}
