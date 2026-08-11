import { useEffect, useRef, useState } from 'react';

const STEP_MS = 130;
/** A jump larger than a dice roll (teleports from cards/jail) snaps instead of walking. */
const MAX_WALK = 12;

/**
 * Server state is authoritative, but tokens should walk the board a tile at a
 * time rather than teleporting. Returns the positions to *render*, plus whether
 * anything is still in motion (used to hold back the buy prompt).
 *
 * `size` is the length of the ring being played, not a constant — the worldwide
 * board is 48 tiles where the classic one is 40.
 */
export function useTokenPositions(players, size) {
    const [display, setDisplay] = useState(() => Object.fromEntries(players.map((p) => [p.id, p.position])));

    // The server broadcasts on every action by anyone, which at a full table
    // arrives faster than STEP_MS. Reading through a ref keeps one interval
    // alive for the life of the component: restarting it on each broadcast
    // means it never survives long enough to reach its first tick, and tokens
    // hang mid-walk until the table happens to go quiet.
    const latest = useRef({ players, size });
    // No dependency array: this needs to run after every render so the interval
    // below always reads the newest broadcast.
    useEffect(() => {
        latest.current = { players, size };
    });

    useEffect(() => {
        const handle = setInterval(() => {
            const { players, size } = latest.current;
            if (!size) return;
            setDisplay((prev) => {
                const next = { ...prev };
                let changed = false;
                const seen = new Set();
                for (const p of players) {
                    seen.add(p.id);
                    const cur = next[p.id];
                    if (cur === undefined) {
                        next[p.id] = p.position;
                        changed = true;
                        continue;
                    }
                    if (cur === p.position) continue;
                    // Doubled modulo: a single one leaves negatives negative in
                    // JS, which reads as a short hop and walks the wrong way.
                    const forward = (((p.position - cur) % size) + size) % size;
                    next[p.id] = forward > MAX_WALK ? p.position : (cur + 1) % size;
                    changed = true;
                }
                for (const id of Object.keys(next)) {
                    if (!seen.has(id)) {
                        delete next[id];
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }, STEP_MS);
        return () => clearInterval(handle);
    }, []);

    const moving = players.some((p) => display[p.id] !== undefined && display[p.id] !== p.position);
    return { display, moving };
}
