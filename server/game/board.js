// Board registry. Each board is a plain definition in ./boards; everything
// positional about it — grid size, where the corners fall, how far a lap is —
// is derived here from the length of its layout rather than hardcoded, so
// adding a board is only ever adding a file.
//
// A board must have four equal sides: `layout.length` divisible by 4, with a
// corner tile at each quarter.

const classic = require('./boards/classic');
const worldwide = require('./boards/worldwide');
const grand = require('./boards/grand');

const BOARDS = {
    [classic.id]: classic,
    [worldwide.id]: worldwide,
    [grand.id]: grand,
};

const DEFAULT_BOARD = classic.id;

/** Positional facts implied by a board's length. */
function geometryOf(board) {
    const size = board.layout.length;
    const per = size / 4; // tiles per side, corner included
    return {
        size,
        per,
        // The ring is (per + 1) squares along each edge, sharing its corners.
        grid: per + 1,
        startIndex: 0,
        jailIndex: per,
        vacationIndex: per * 2,
        goToJailIndex: per * 3,
    };
}

function getBoard(id) {
    return BOARDS[id] || BOARDS[DEFAULT_BOARD];
}

function makeTiles(board) {
    return board.layout.map(([name, type, groupId, price, rent, houseCost, extra], id) => ({
        id,
        name,
        type,
        groupId,
        price,
        rent,
        houseCost,
        // Only tax tiles carry this: { amount } or { percent } of net worth.
        tax: type === 'tax' ? extra || { amount: 100 } : null,
        // And only landmarks this: { startBonus } or { rentOff }, kept for
        // whoever stands on the tile rather than for the tile itself.
        boon: type === 'landmark' ? extra || null : null,
        ownerId: null,
        houses: 0,
        // What the last auction says this is worth, as a share of `price`.
        // Only moves while the dynamic-values setting is on.
        appraisal: 1,
    }));
}

/** Everything the client needs to draw a board but that never changes in play. */
function boardMeta(board) {
    return {
        id: board.id,
        name: board.name,
        tagline: board.tagline,
        groups: board.groups,
        airportRent: board.airportRent,
        utilityMultiplier: board.utilityMultiplier,
        ...geometryOf(board),
    };
}

/** Summary of every board, for the lobby picker. */
const BOARD_LIST = Object.values(BOARDS).map((b) => ({
    id: b.id,
    name: b.name,
    tagline: b.tagline,
    size: b.layout.length,
    countries: Object.keys(b.groups).length,
    groups: b.groups,
    // A miniature of the ring, so the picker can draw a preview without
    // shipping the whole layout.
    ring: b.layout.map((t) => (t[2] && b.groups[t[2]] ? b.groups[t[2]].color : null)),
}));

module.exports = {
    BOARDS,
    BOARD_LIST,
    DEFAULT_BOARD,
    getBoard,
    geometryOf,
    makeTiles,
    boardMeta,
};
