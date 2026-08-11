// Mirrors server/game/engine.js rentFor() for display purposes only —
// the server stays authoritative for anything that moves money.

// Fallbacks only — the live tables come from the board the room is on, since
// boards differ (Worldwide has a third utility).
const DEFAULT_AIRPORT_RENT = [25, 50, 100, 200];
const DEFAULT_UTILITY_MULTIPLIER = [4, 10];

const airportRent = (state) => state?.board?.airportRent || DEFAULT_AIRPORT_RENT;
const utilityMultiplier = (state) => state?.board?.utilityMultiplier || DEFAULT_UTILITY_MULTIPLIER;
const step = (table, owned) => table[Math.min(Math.max(owned - 1, 0), table.length - 1)];

export function ownsFullGroup(state, ownerId, groupId) {
    if (!groupId || !ownerId) return false;
    const tiles = state.tiles.filter((t) => t.groupId === groupId);
    return tiles.length > 0 && tiles.every((t) => t.ownerId === ownerId);
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
        const owned = owner.properties.filter((id) => state.tiles[id].type === 'airport').length;
        const value = liveRent(tile, step(airportRent(state), owned));
        return { label: `$${value}`, value };
    }
    if (tile.type === 'utility') {
        const owned = owner.properties.filter((id) => state.tiles[id].type === 'utility').length;
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

export function canBuild(state, player, tile) {
    if (!player || tile.type !== 'property' || tile.ownerId !== player.id) return false;
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
