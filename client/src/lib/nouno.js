/**
 * What the client needs to know about a card, and nothing more.
 *
 * The server decides every outcome — this is only enough to dim the cards you
 * cannot play and to say what one does when you look at it. The rule is
 * duplicated here on purpose and deliberately kept tiny: a hint that is wrong
 * costs a refused action and a shrug, where a hint that is missing costs you
 * hunting through your own hand.
 */

/** The line under the fan. */
export function KIND_BLURB(card) {
    if (!card) return '';
    switch (card.kind) {
        case 'halt':
            return 'Halt — the next player misses their turn.';
        case 'turn':
            return 'Turn — play goes back the way it came.';
        case 'plus2':
            return 'Plus Two — the next player draws two and misses their turn.';
        case 'any':
            return 'Any — name the suit that carries on.';
        case 'any4':
            return 'Any Plus Four — name the suit; the next player draws four and misses their turn.';
        default:
            return `${card.value} — match the suit or the number.`;
    }
}

/** Mirrors the server's `playable`; see game/nouno/deck.js. */
export function canPlay(card, top, active) {
    if (!card) return false;
    if (!card.suit) return true;
    if (card.suit === active) return true;
    if (!top) return true;
    if (card.kind === 'num') return top.kind === 'num' && card.value === top.value;
    return card.kind === top.kind;
}

/** The ids in a hand that may go down right now, for the dimming. */
export const playableIds = (hand, top, active) =>
    new Set((hand || []).filter((c) => canPlay(c, top, active)).map((c) => c.id));

/** What a card is called, for the feed and the pile. */
export function cardName(card, suits) {
    if (!card) return 'nothing';
    const label =
        card.kind === 'num'
            ? String(card.value)
            : { halt: 'Halt', turn: 'Turn', plus2: 'Plus Two', any: 'Any', any4: 'Any Plus Four' }[card.kind];
    return card.suit ? `${suits?.[card.suit]?.name || card.suit} ${label}` : label;
}
