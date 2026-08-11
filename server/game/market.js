/**
 * Two independent beta rules, both off by default and both settable only while
 * the room is still in the lobby.
 *
 * `settings.dynamicValues` — what a property is worth stops being a constant.
 * Two forces move it, and both are deliberately confined to the early scramble
 * for the board:
 *
 *   traffic   how often players actually land there, relative to the rest of
 *             the board. Emergent rather than random: the squares a few steps
 *             past jail get hot on their own because that's where the dice put
 *             people.
 *   appraisal what the last auction proved someone would pay. Ratchets up
 *             easily and down slowly, so lowballing a tile can't crater it.
 *
 * Both feed one multiplier that scales purchase price and sell-back value. Rent
 * follows the same multiplier but *fades out as the tile develops* — once there
 * are houses on it, or the set is complete, rent is back to the book value.
 * Developed sets already hurt enough without the market piling on.
 *
 * `settings.auctionBalance` — auctions open at half of what the tile is worth
 * rather than $2, so nothing can be picked up for pocket change. Independent of
 * the above, though the two do reinforce each other: dynamic values without a
 * reserve price leaves the appraisal open to being talked down.
 *
 * With a setting off every function here returns the neutral value, so the
 * engine can call them unconditionally.
 */

/**
 * Pseudo-visits mixed into the traffic ratio. Without it the first few landings
 * of a game would swing values wildly off a sample size of nothing.
 */
const VISIT_PRIOR = 3;
/** How hard a tile's visit share pushes its value. */
const TRAFFIC_WEIGHT = 0.35;
const TRAFFIC_MIN = 0.75;
const TRAFFIC_MAX = 1.5;

/** A hammer price above the current appraisal counts double one below it. */
const BID_UP_WEIGHT = 0.3;
const BID_DOWN_WEIGHT = 0.15;
const APPRAISAL_MIN = 0.7;
const APPRAISAL_MAX = 2.0;

/** Auctions open at half of what the tile is currently worth. */
const OPENING_BID_RATIO = 0.5;
const MIN_OPENING_BID = 2;

/** How much of the multiplier reaches rent, indexed by house count. */
const RENT_FADE = [1, 0.5, 0.5, 0, 0, 0];

const OWNABLE = new Set(['property', 'airport', 'utility']);

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
/** Money reads better in fives than in exact fractions of a base price. */
const toMoney = (n) => Math.max(Math.round(n / 5) * 5, 5);

const enabled = (room) => !!room.settings.dynamicValues;
const balancedAuctions = (room) => !!room.settings.auctionBalance;

/**
 * Where this tile sits against an even share of the board's traffic. 1.0 is
 * exactly average; the prior drags everything toward 1.0 early on and lets go
 * as real visits accumulate.
 */
function trafficMult(room, tile) {
    const visits = room.stats.visits;
    let total = 0;
    for (const id in visits) total += visits[id];
    // An even share of the traffic, which depends on how long the board is.
    const expected = total / room.tiles.length;
    const ratio = ((visits[tile.id] || 0) + VISIT_PRIOR) / (expected + VISIT_PRIOR);
    return clamp(1 + TRAFFIC_WEIGHT * (ratio - 1), TRAFFIC_MIN, TRAFFIC_MAX);
}

/** Combined multiplier on price and sell-back value. */
function valueMult(room, tile) {
    if (!enabled(room) || !OWNABLE.has(tile.type)) return 1;
    return clamp(trafficMult(room, tile) * (tile.appraisal || 1), APPRAISAL_MIN, APPRAISAL_MAX);
}

/**
 * The share of the multiplier that reaches rent. Buildings and a complete set
 * are both signals that the tile has graduated past the land-grab phase.
 */
function rentFade(room, tile, setOwned) {
    if (setOwned) return 0;
    // Airports and utilities never build, so the only thing that retires them
    // from the market is the owner collecting the whole lot.
    if (tile.type !== 'property') return RENT_FADE[0];
    return RENT_FADE[tile.houses] ?? 0;
}

function rentMult(room, tile, setOwned) {
    if (!enabled(room)) return 1;
    const fade = rentFade(room, tile, setOwned);
    if (!fade) return 1;
    return 1 + (valueMult(room, tile) - 1) * fade;
}

/** What the tile costs to buy, and what the bank pays to take it back. */
function priceOf(room, tile) {
    if (!enabled(room) || !OWNABLE.has(tile.type)) return tile.price;
    return toMoney(tile.price * valueMult(room, tile));
}

/**
 * The reserve. Reads whatever the tile currently costs, so it works off the
 * book price on its own and off the live price when dynamic values is also on.
 */
function openingBid(room, tile) {
    if (!balancedAuctions(room) || !OWNABLE.has(tile.type)) return MIN_OPENING_BID;
    return Math.max(toMoney(priceOf(room, tile) * OPENING_BID_RATIO), MIN_OPENING_BID);
}

/**
 * Fold an auction result back into the tile's appraisal. Bids above the current
 * value move it at full weight and bids below at half, so a table that quietly
 * agrees not to bid still can't drive anything below the floor.
 */
function appraise(room, tile, hammer) {
    if (!enabled(room) || !OWNABLE.has(tile.type) || !tile.price) return;
    const implied = hammer / tile.price;
    const current = tile.appraisal || 1;
    const weight = implied > current ? BID_UP_WEIGHT : BID_DOWN_WEIGHT;
    tile.appraisal = clamp(current + weight * (implied - current), APPRAISAL_MIN, APPRAISAL_MAX);
}

/** Derived numbers the client needs to render a tile — never stored on it. */
function marketView(room, tile, setOwned) {
    const mult = valueMult(room, tile);
    return {
        marketPrice: priceOf(room, tile),
        marketMult: mult,
        marketRentMult: rentMult(room, tile, setOwned),
    };
}

module.exports = {
    valueMult,
    rentMult,
    priceOf,
    openingBid,
    appraise,
    marketView,
    MIN_OPENING_BID,
};
