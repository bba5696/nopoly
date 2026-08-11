/**
 * Client-side view of the dynamic property value system. The server sends both
 * the book price (`price`) and the live one (`marketPrice`); with the setting
 * off they're identical, so everything here degrades to the plain numbers.
 */

/** Below this, a drift isn't worth putting an arrow on. */
const TREND_THRESHOLD = 0.04;

export const priceOf = (tile) => tile?.marketPrice ?? tile?.price ?? 0;

/**
 * How far a tile has moved from its book value, or null when it hasn't moved
 * enough to be worth showing.
 */
export function trendOf(tile) {
    const mult = tile?.marketMult ?? 1;
    if (Math.abs(mult - 1) < TREND_THRESHOLD) return null;
    return {
        up: mult > 1,
        pct: Math.round(Math.abs(mult - 1) * 100),
        // Rent stops tracking the market once a tile is built up or its set is
        // complete — worth saying out loud, since the price still moves.
        rentFollows: (tile?.marketRentMult ?? 1) !== 1,
    };
}

export const TREND_UP = '#3ddc97';
export const TREND_DOWN = '#ff5c7c';
export const trendColor = (trend) => (trend?.up ? TREND_UP : TREND_DOWN);
