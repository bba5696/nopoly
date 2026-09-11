/**
 * What a paused game says about itself, in both games.
 *
 * A pause is how a table says "we'll finish this later", and the question
 * everyone asks next is how much later is allowed — so the line answers it.
 * The day is always named: a pause is kept for a day, so "until 9:40" would
 * usually mean tomorrow's.
 */
export function pausedLine(state) {
    if (!state?.paused) return '';
    if (!state.pausedUntil) return 'Game paused';
    const until = new Date(state.pausedUntil);
    const day = until.toLocaleDateString([], { weekday: 'short' });
    const time = until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `Game paused · kept until ${day} ${time}`;
}
