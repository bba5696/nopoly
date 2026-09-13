import { useEffect, useRef } from 'react';

/** Never more than one turn-clock ping in this window, however much the mouse moves. */
const THROTTLE_MS = 8_000;
/**
 * The off-turn ping only has to beat a one-minute bar, so it can be far
 * sparser than the turn clock's.
 */
const INPUT_THROTTLE_MS = 20_000;

/**
 * Call `fire` on real input — at most once per `ms` — while `active`.
 *
 * Pointer covers mouse and touch; scroll and keys catch the people reading the
 * board or typing in chat without moving anything.
 *
 * The callback is read through a ref, so the listeners go on once rather than
 * coming off and back on with every state update the game screen renders.
 */
function useInputListener(active, ms, fire) {
    const last = useRef(0);
    const latest = useRef(fire);
    useEffect(() => {
        latest.current = fire;
    });

    useEffect(() => {
        if (!active) return;
        const ping = () => {
            const now = Date.now();
            if (now - last.current < ms) return;
            last.current = now;
            latest.current();
        };
        const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
        for (const name of events) window.addEventListener(name, ping, { passive: true });
        return () => {
            for (const name of events) window.removeEventListener(name, ping);
        };
    }, [active, ms]);
}

/**
 * Tell the server you're still there, so the turn clock doesn't play your turn
 * for you.
 *
 * Only while it's your turn — nobody else's turn is being timed, and this goes
 * through the ordinary action path, which sends the whole table a fresh state.
 *
 * Deliberately not sent when the turn begins: the whole point is that the clock
 * only stops for someone who is actually at the keyboard, and announcing your
 * arrival automatically would defeat it. Moving the mouse is the proof.
 */
export function useIdlePing(active, send) {
    useInputListener(active, THROTTLE_MS, () => send('game:active'));
}

/**
 * Tell the server you're at the keyboard at all, your turn or not.
 *
 * A vote-kick locks the removed player's estate only if they were actually
 * playing when the vote was called, and between your own turns nothing else
 * says so. `presence:input` stamps the time and broadcasts nothing, so a table
 * of people moving their mice is not a table of state updates.
 */
export function useInputPing(active, send) {
    useInputListener(active, INPUT_THROTTLE_MS, () => send('presence:input'));
}
