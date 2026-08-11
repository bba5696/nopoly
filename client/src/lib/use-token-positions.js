import { useEffect, useState } from 'react';

const STEP_MS = 130;
/** A jump larger than a dice roll (teleports from cards/jail) snaps instead of walking. */
const MAX_WALK = 12;

/**
 * Server state is authoritative, but tokens should walk the board a tile at a
 * time rather than teleporting. Returns the positions to *render*, plus whether
 * anything is still in motion (used to hold back the buy prompt).
 */
export function useTokenPositions(players) {
    const [display, setDisplay] = useState(() => Object.fromEntries(players.map((p) => [p.id, p.position])));

    useEffect(() => {
        const tick = () => {
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
                    const forward = (p.position - cur + 40) % 40;
                    next[p.id] = forward > MAX_WALK ? p.position : (cur + 1) % 40;
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
        };
        const handle = setInterval(tick, STEP_MS);
        return () => clearInterval(handle);
    }, [players]);

    const moving = players.some((p) => display[p.id] !== undefined && display[p.id] !== p.position);
    return { display, moving };
}
