import { useEffect, useRef } from 'react';

import {
    playAuction,
    playBankrupt,
    playCashIn,
    playCashOut,
    playJail,
    playRivalBuy,
    playRivalSet,
    playRoll,
    playSet,
} from './sound';

/**
 * Everything the rest of the table does, made audible.
 *
 * Every sound in the game used to be fired locally by the person doing the
 * thing — the roll from the Roll button's own click handler, the purchase from
 * inside the buy modal. Which meant that while you were waiting for your turn,
 * and a game of this spends most of its time waiting, the app was completely
 * silent. That reads as nothing happening.
 *
 * So these come off state transitions instead, and fire for everyone. The ones
 * you cause yourself are skipped, since your own click already played them
 * without waiting for the round trip.
 */
export function useTableSounds(state, playerId) {
    // Seeded from the first state rather than empty, or reconnecting mid-game
    // replays every set and every bankruptcy at once.
    const seen = useRef(null);

    useEffect(() => {
        if (!state) return;
        const now = {
            move: state.lastMove?.seq ?? 0,
            mover: state.lastMove?.playerId ?? null,
            pay: state.lastPayment?.seq ?? 0,
            owned: state.tiles.filter((t) => t.ownerId).length,
            sets: state.completedGroups || {},
            jailed: state.players.filter((p) => p.inJail).map((p) => p.id),
            out: state.players.filter((p) => p.bankrupt).map((p) => p.id),
            // The tile under the hammer, not merely whether one is: a declined
            // purchase straight after an auction opens the next one, and the
            // gavel should sound for that too.
            lot: state.auction ? state.auction.tileId : null,
        };
        const was = seen.current;
        seen.current = now;
        if (!was) return;

        // Someone else's dice. Tied to the move sequence rather than the dice
        // values, which repeat and would swallow a roll of the same numbers.
        if (now.move !== was.move && now.mover && now.mover !== playerId) playRoll(true);

        // Money changing hands. Only the two people involved hear it — rent is
        // a private disaster, and a chime on every table-wide charge would fire
        // several times a lap for everyone. Sequenced rather than compared by
        // value, since the same rent to the same rival twice in a lap is common
        // and would otherwise sound once.
        const pay = state.lastPayment;
        if (pay && now.pay !== was.pay && pay.amount > 0) {
            if (pay.fromId === playerId) playCashOut();
            else if (pay.toId === playerId) playCashIn();
        }

        // An auction opening. Everyone hears it, the bidders included: this is
        // the one sound in the game whose job is to interrupt, and it replaces a
        // modal that used to black out the screen to do the same job.
        if (now.lot !== was.lot && now.lot !== null) playAuction();

        // A deed changed hands. Counting owned tiles catches a purchase and an
        // auction alike, and misses a trade — which is right, a trade already
        // announces itself to both sides.
        if (now.owned > was.owned && state.pendingAction?.playerId !== playerId) playRivalBuy();

        // A set completed. Whose it is decides which of the two you hear, and
        // everybody hears one of them.
        const mine = state.settings.teams && state.players.find((p) => p.id === playerId)?.teamId;
        const myKey = mine ? `team:${mine}` : `p:${playerId}`;
        for (const [group, side] of Object.entries(now.sets)) {
            if (was.sets[group] === side) continue;
            if (side === myKey) playSet();
            else playRivalSet();
            // One per update: two sets completing on the same roll is a trade
            // landing, and two fanfares over each other is just noise.
            break;
        }

        if (now.jailed.some((id) => !was.jailed.includes(id) && id !== playerId)) playJail();
        if (now.out.length > was.out.length) playBankrupt();
    }, [state, playerId]);
}
