// The deck nouno is played with.
//
// A hundred and eight cards: per suit one 0 and two each of 1-9, two Halt, two
// Turn and two Plus Two, then four Any and four Any Plus Four. The counts are
// the ones everybody already knows, because a card game whose rules have to be
// learned from scratch is a card game nobody plays twice.
//
// The names are ours. So are the suits — ember, solar, fern and tide, in the
// site's own palette rather than the four colours of a box you can buy. The
// rules of a trick-taking or shedding game aren't anybody's property, but a
// name and a look are, and this project has taken that line once already with
// the board.
//
// Built rather than written out: a hundred and eight literals is a hundred and
// eight chances to typo a count nobody would notice until a game ran short.

const { shuffle } = require('../cards');

/** The four suits, in the palette the rest of the site uses. */
const SUITS = {
    ember: { name: 'Ember', color: '#ff5c7c' },
    solar: { name: 'Solar', color: '#ffb648' },
    fern: { name: 'Fern', color: '#3ddc97' },
    tide: { name: 'Tide', color: '#4cc9f0' },
};
const SUIT_IDS = Object.keys(SUITS);

/**
 * What each kind of card does, in the words the client shows under the fan.
 * Kept here rather than in the client so the description and the rule that
 * implements it are edited in the same file.
 */
const KINDS = {
    num: { label: (v) => String(v), blurb: 'A number. Match the suit or the number.' },
    halt: { label: () => 'Halt', blurb: 'Halt — the next player misses their turn.' },
    turn: { label: () => 'Turn', blurb: 'Turn — play goes back the way it came.' },
    plus2: { label: () => '+2', blurb: 'Plus Two — the next player draws two and misses their turn.' },
    any: { label: () => 'Any', blurb: 'Any — name the suit that carries on.' },
    any4: { label: () => '+4', blurb: 'Any Plus Four — name the suit; the next player draws four and misses their turn.' },
};

/** The wilds, which belong to no suit and may be played on anything. */
const isWild = (card) => card.kind === 'any' || card.kind === 'any4';

function makeDeck() {
    const cards = [];
    const add = (suit, kind, value, n) => {
        for (let i = 0; i < n; i++) {
            cards.push({ id: `${suit || 'any'}-${kind}${value ?? ''}-${i}`, suit, kind, value });
        }
    };
    for (const suit of SUIT_IDS) {
        add(suit, 'num', 0, 1);
        for (let v = 1; v <= 9; v++) add(suit, 'num', v, 2);
        add(suit, 'halt', null, 2);
        add(suit, 'turn', null, 2);
        add(suit, 'plus2', null, 2);
    }
    add(null, 'any', null, 4);
    add(null, 'any4', null, 4);
    return shuffle(cards);
}

/** What a card is called, for the log and for the face. */
function nameOf(card) {
    if (!card) return 'nothing';
    const kind = KINDS[card.kind];
    const label = kind ? kind.label(card.value) : card.kind;
    return card.suit ? `${SUITS[card.suit].name} ${label}` : label;
}

/**
 * Whether a card may go down on this pile.
 *
 * `active` rather than the top card's suit, because a wild changes what is
 * being followed without changing what is lying there.
 */
function playable(card, top, active) {
    if (!card) return false;
    if (isWild(card)) return true;
    if (card.suit === active) return true;
    if (!top) return true;
    if (card.kind === 'num') return top.kind === 'num' && card.value === top.value;
    return card.kind === top.kind;
}

/** What a hand is worth to whoever went out: faces, twenty, and fifty. */
const scoreOf = (card) => (card.kind === 'num' ? card.value : isWild(card) ? 50 : 20);

module.exports = { SUITS, SUIT_IDS, KINDS, makeDeck, nameOf, playable, isWild, scoreOf };
