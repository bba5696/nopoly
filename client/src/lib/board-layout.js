// Maps tile ids onto a square CSS grid, running clockwise from the top-left
// corner. Everything is derived from the board's length rather than fixed, so
// the same maths lays out the 40-tile ring on 11x11 and the 48-tile one on
// 13x13.
//
// With `per` = size / 4 tiles per side:
//
//   0            top-left      (Start)
//   1..per-1     top row, left to right
//   per          top-right     (Jail)
//   ..2per-1     right column, top to bottom
//   2per         bottom-right  (Vacation)
//   ..3per-1     bottom row, right to left
//   3per         bottom-left   (Go to jail)
//   ..size-1     left column, bottom to top

/** Tiles per side, corner included. */
export const perSide = (size) => size / 4;
/** Squares along one edge of the ring; corners are shared with the next edge. */
export const gridFor = (size) => perSide(size) + 1;

export function tilePlacement(id, size) {
    const per = perSide(size);
    const grid = per + 1;
    if (id === 0) return { row: 1, col: 1, side: 'top' };
    if (id < per) return { row: 1, col: 1 + id, side: 'top' };
    if (id === per) return { row: 1, col: grid, side: 'top' };
    if (id < per * 2) return { row: 1 + (id - per), col: grid, side: 'right' };
    if (id === per * 2) return { row: grid, col: grid, side: 'bottom' };
    if (id < per * 3) return { row: grid, col: grid - (id - per * 2), side: 'bottom' };
    if (id === per * 3) return { row: grid, col: 1, side: 'bottom' };
    return { row: grid - (id - per * 3), col: 1, side: 'left' };
}

export const isCorner = (id, size) => id % perSide(size) === 0;
export const jailIndex = (size) => perSide(size);

/** Which edge of the tile the colour band sits on (always the inner edge). */
export function bandSide(side) {
    return { bottom: 'top', left: 'right', top: 'bottom', right: 'left' }[side];
}

export const money = (n) =>
    `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export const shortMoney = (n) => {
    const abs = Math.abs(n);
    if (abs >= 10000) return `${n < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
    return money(n);
};

export const HOUSE_LABEL = ['', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel'];

/** Short tag shown in the tile's band, mirroring the wireframe. */
export function tileTag(tile, groups) {
    switch (tile.type) {
        case 'property':
            return groups?.[tile.groupId]?.name?.toUpperCase() || tile.groupId?.toUpperCase() || '';
        case 'airport':
            return 'AIRPORT';
        case 'utility':
            return 'UTILITY';
        case 'chance':
            return 'SURPRISE';
        case 'chest':
            return 'TREASURE';
        case 'tax':
            return 'TAX';
        default:
            return '';
    }
}
