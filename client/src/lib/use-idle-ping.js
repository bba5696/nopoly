import { useEffect, useRef } from 'react';

/** Never more than one ping in this window, however much the mouse moves. */
const THROTTLE_MS = 8_000;

/**
 * Tell the server you're still there, so the turn clock doesn't play your turn
 * for you.
 *
 * Only while it's your turn — nobody else's presence is being timed, and
 * pinging on everyone's mouse movement would be a socket message every few
 * seconds from every player in the room for no reason.
 *
 * Deliberately not sent when the turn begins: the whole point is that the clock
 * only stops for someone who is actually at the keyboard, and announcing your
 * arrival automatically would defeat it. Moving the mouse is the proof.
 */
export function useIdlePing(active, send) {
    const last = useRef(0);

    useEffect(() => {
        if (!active) return;
        const ping = () => {
            const now = Date.now();
            if (now - last.current < THROTTLE_MS) return;
            last.current = now;
            send('game:active');
        };
        // Pointer covers mouse and touch; scroll and keys catch the people
        // reading the board or typing in chat without moving anything.
        const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
        for (const name of events) window.addEventListener(name, ping, { passive: true });
        return () => {
            for (const name of events) window.removeEventListener(name, ping);
        };
    }, [active, send]);
}
