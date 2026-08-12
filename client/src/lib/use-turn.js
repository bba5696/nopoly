import { useGame } from './game-context';

export const JAIL_FINE = 50;

/**
 * What the player can actually do right now.
 *
 * Pulled out of the board's middle because the same set of decisions has to be
 * offered in two places: inside the ring on a desktop, and in a bar under the
 * board on a phone, where the middle of a forty-tile board is a couple of
 * hundred pixels across and can't hold a button anyone can hit.
 */
export function useTurn(moving) {
    const { state, me, isMyTurn } = useGame();
    // A debt freezes the turn until it's cleared. The actions still render so
    // the turn still reads as yours — they're just dead, and say why.
    const debt = me?.debt || null;
    const canRoll = isMyTurn && state.phase === 'rolling' && !moving;
    const canEnd =
        isMyTurn && !moving && (state.phase === 'resolving' || (state.phase === 'rolling' && state.hasRolled));
    const inJail = !!(isMyTurn && me?.inJail && state.phase === 'rolling');
    // A double earns another roll, but the server only re-arms it when the turn
    // is handed back — so "End turn" is what you press to keep going, which
    // reads like the opposite of what it does.
    const rollingAgain =
        isMyTurn && state.doublesCount > 0 && state.doublesCount < 3 && !me?.inJail && !me?.bankrupt;
    const payJail = inJail && me.cash >= JAIL_FINE;
    const useCard = inJail && me.jailCards > 0;

    return {
        debt,
        canRoll,
        canEnd,
        inJail,
        rollingAgain,
        payJail,
        useCard,
        any: !!(payJail || useCard || canRoll || canEnd),
    };
}
