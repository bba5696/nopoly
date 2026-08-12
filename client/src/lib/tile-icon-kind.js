// Which icon a tile asks for, kept apart from the icons themselves.
//
// This is a plain lookup and TileIcon.jsx is a component module. Together in
// one file they trip react-refresh, which can only fast-refresh a module whose
// every export is a component — and the cost of getting that wrong is a full
// reload of the board on each edit, not just a lint warning.

// Keyed by name rather than tile id — ids move between boards, names don't.
const BY_NAME = {
    'Income Tax': 'incomeTax',
    'Earnings Tax': 'incomeTax',
    'Luxury Tax': 'luxuryTax',
    'Premium Tax': 'luxuryTax',
    'Electric Company': 'electric',
    'Power Company': 'electric',
    'Gas Company': 'gas',
    'Water Company': 'water',
    Vacation: 'vacation',
    'Go to Jail': 'goToJail',
};

/** Which icon a slot uses, or null for slots that draw themselves. */
export function iconKindFor(tile) {
    if (tile.type === 'chance') return 'chance';
    if (tile.type === 'chest') return 'chest';
    if (tile.type === 'airport') return 'airport';
    return BY_NAME[tile.name] || null;
}
