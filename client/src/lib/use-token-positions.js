import { useEffect, useRef, useState } from 'react';

const STEP_MS = 130;
/** A jump larger than a dice roll (teleports from cards/jail) snaps instead of walking. */
const MAX_WALK = 12;
/** Beat spent standing on the tile that sent you to jail, before the snap. */
const VIA_PAUSE_MS = 420;

/**
 * Server state is authoritative, but tokens should walk the board a tile at a
 * time rather than teleporting. Returns the positions to *render*, plus whether
 * anything is still in motion (used to hold back the buy prompt).
 *
 * `size` is the length of the ring being played, not a constant — the worldwide
 * board is 48 tiles where the classic one is 40.
 */
export function useTokenPositions(players, size, lastMove) {
    const [display, setDisplay] = useState(() => Object.fromEntries(players.map((p) => [p.id, p.position])));

    // Move seqs whose staging tile has already been stood on, and when. Keyed
    // by seq so a second trip to jail is staged again rather than skipped.
    const viaSeen = useRef(new Map());

    // The server broadcasts on every action by anyone, which at a full table
    // arrives faster than STEP_MS. Reading through a ref keeps one interval
    // alive for the life of the component: restarting it on each broadcast
    // means it never survives long enough to reach its first tick, and tokens
    // hang mid-walk until the table happens to go quiet.
    const latest = useRef({ players, size, lastMove });
    // No dependency array: this needs to run after every render so the interval
    // below always reads the newest broadcast.
    useEffect(() => {
        latest.current = { players, size, lastMove };
    });

    useEffect(() => {
        const handle = setInterval(() => {
            const { players, size, lastMove } = latest.current;
            if (!size) return;
            setDisplay((prev) => {
                const next = { ...prev };
                let changed = false;
                const seen = new Set();
                const now = Date.now();
                for (const p of players) {
                    seen.add(p.id);
                    const cur = next[p.id];
                    if (cur === undefined) {
                        next[p.id] = p.position;
                        changed = true;
                        continue;
                    }

                    // A jail move names the tile that caused it. Head there
                    // first, stand on it a beat, and only then let the token
                    // snap on to the cell — so you see what you landed on.
                    let target = p.position;
                    const staging =
                        lastMove &&
                        lastMove.playerId === p.id &&
                        lastMove.via != null &&
                        lastMove.via !== p.position;
                    if (staging) {
                        const stoodAt = viaSeen.current.get(lastMove.seq);
                        if (stoodAt === undefined) {
                            if (cur !== lastMove.via) target = lastMove.via;
                            else viaSeen.current.set(lastMove.seq, now);
                        }
                        if (viaSeen.current.get(lastMove.seq) > now - VIA_PAUSE_MS) continue;
                    }

                    if (cur === target) continue;
                    // Doubled modulo: a single one leaves negatives negative in
                    // JS, which reads as a short hop and walks the wrong way.
                    const forward = (((target - cur) % size) + size) % size;
                    next[p.id] = forward > MAX_WALK ? target : (cur + 1) % size;
                    changed = true;
                }
                // Only the newest move can be staging; anything older is done.
                if (viaSeen.current.size > 8) {
                    for (const seq of [...viaSeen.current.keys()].slice(0, -4)) viaSeen.current.delete(seq);
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
