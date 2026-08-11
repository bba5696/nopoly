import { useEffect, useMemo, useRef } from 'react';
import { useGame } from '@/lib/game-context';

/**
 * Running account of what the game has done — rolls, purchases, rent, cards.
 * Lives in the middle of the board (richup-style) so the chat panel stays
 * purely for what players type.
 *
 * Newest first, so the thing that just happened is always the top line and you
 * scroll *down* into the past.
 */
export function GameFeed() {
    const { state } = useGame();
    const scrollRef = useRef(null);
    const entries = useMemo(() => state.log.slice().reverse(), [state.log]);

    // New lines arrive at the top, so jump back up to keep them in view.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [entries.length]);

    if (entries.length === 0) return null;

    return (
        <div
            ref={scrollRef}
            // no frame — it sits straight on the board and only the scrollbar
            // shows up, and only once there's enough history to scroll
            className="scroll-thin flex max-h-[150px] w-full max-w-[380px] flex-col gap-1 overflow-y-auto px-3 text-center"
        >
            {entries.map((entry, i) => (
                <p
                    key={entry.id}
                    className="text-[12.5px] leading-snug"
                    // the newest line reads brightest, the rest recede
                    style={{ color: i === 0 ? 'var(--foreground)' : 'var(--muted-foreground)' }}
                >
                    {entry.text}
                </p>
            ))}
        </div>
    );
}
