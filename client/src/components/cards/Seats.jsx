import { OpponentHand } from './Table';

/**
 * Everyone else, sat round the table.
 *
 * You are at the bottom, so the others are spread along the arc above you —
 * left, over the top, and round to the right. The spread widens with how many
 * of them there are rather than being fixed: two people opposite each other
 * and ten shoulder to shoulder are the same table, and one fixed spread makes
 * one of those look wrong.
 *
 * Their cards stay flat. Turning each hand to face the middle was the more
 * literal reading of a table, and it looked like a pile of cards knocked over:
 * the backs are decoration, and decoration set at ninety degrees just reads as
 * broken. The curve does the work of saying they are sitting round something.
 */

/** Where each seat sits, in degrees: 0 is the right, 90 is the top. */
export function seatAngles(n) {
    if (n <= 0) return [];
    if (n === 1) return [90];
    const span = Math.min(52 * (n - 1), 200);
    const start = 90 + span / 2;
    return Array.from({ length: n }, (_, i) => start - (i * span) / (n - 1));
}

/**
 * How big everyone else s cards are drawn.
 *
 * Scaled to how many of them there are, not fixed: three people round a table
 * have room for cards you can actually see, and eleven do not. A single size
 * that fits a full table makes a four-player game look like it is being played
 * at the far end of a hall.
 */
export const seatSize = (n) => Math.max(9, 24 - n * 2);

export function Seats({ players, currentId, said, size }) {
    const angles = seatAngles(players.length);
    const cardSize = size ?? seatSize(players.length);
    return (
        <>
            {players.map((p, i) => {
                const theta = (angles[i] * Math.PI) / 180;
                // A wider ellipse than tall: a table seen from a chair at it,
                // rather than from directly above.
                const left = 50 + 34 * Math.cos(theta);
                const top = 44 - 27 * Math.sin(theta);
                return (
                    <div
                        key={p.id}
                        className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                        style={{ left: `${left}%`, top: `${top}%` }}
                    >
                        <OpponentHand
                            player={p}
                            count={p.handCount}
                            active={currentId === p.id}
                            said={said.has(p.id)}
                            size={cardSize}
                            // Only a lean, following the curve. Enough to say
                            // where they are sitting, not enough to turn their
                            // cards on their side.
                            tilt={(angles[i] - 90) / 7}
                        />
                    </div>
                );
            })}
        </>
    );
}
