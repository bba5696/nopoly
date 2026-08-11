import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { gridFor, jailIndex, tilePlacement } from '@/lib/board-layout';
import { alpha, initials } from '@/lib/color';

/**
 * Jail is two places at once: the barred cell in the slot's inner corner, and
 * the lane along its outer edges. Offsets are fractions of the slot.
 */
const JAIL_SPOT = {
    locked: { dx: -0.12, dy: 0.14 },
    visiting: { dx: 0.29, dy: -0.29 },
};

/** How far apart stacked tokens sit, as a share of a token's width. */
const STACK_STEP = 0.58;
const STACK_MIN_STEP = 0.3;
/** A crowded slot may spill a little past its edges rather than squash flat. */
const STACK_ROOM = 1.15;
/** The player whose turn it is stands proud of the pile. */
const ACTIVE_SCALE = 1.24;

/** Grid tracks are `depth | n × mid | depth`, so position isn't a flat multiple. */
const trackSize = (index, depth, mid, grid) => (index === 1 || index === grid ? depth : mid);
const trackOffset = (index, depth, mid, gap) =>
    index === 1 ? 0 : depth + gap + (index - 2) * (mid + gap);

/**
 * All player tokens live in one overlay above the grid rather than inside the
 * tiles — tiles clip their overflow, so a token animating between them would
 * disappear mid-walk. `geom` is the measured ring geometry and `inset` the
 * board's border + padding, which together line this layer up exactly with the
 * grid's content box.
 */
export function TokenLayer({ players, display, activeId, boardSize, geom, gap = 0, inset }) {
    const { depth, midW, midH } = geom;
    const token = Math.min(midW, midH) * 0.52;
    const grid = gridFor(boardSize);
    const jailId = jailIndex(boardSize);

    /**
     * Tokens sharing a slot overlap into a single pile rather than shrinking
     * to sit side by side. The pile tightens up as more players land on the
     * same square so it never outgrows the slot.
     */
    const slots = useMemo(() => {
        const byTile = {};
        for (const p of players) {
            if (p.bankrupt) continue;
            const pos = display[p.id] ?? p.position;
            // Locked up and just visiting are the same square but read very
            // differently, so they get their own piles.
            const key = pos === jailId && p.inJail ? 'jail' : pos;
            (byTile[key] ||= []).push(p.id);
        }
        const room = Math.min(midW, midH) * STACK_ROOM;
        const out = {};
        for (const ids of Object.values(byTile)) {
            const n = ids.length;
            const step =
                n > 1
                    ? Math.min(token * STACK_STEP, Math.max((room - token) / (n - 1), token * STACK_MIN_STEP))
                    : 0;
            ids.forEach((id, i) => {
                out[id] = { offset: (i - (n - 1) / 2) * step };
            });
        }
        return out;
    }, [players, display, midW, midH, token, jailId]);

    if (!midW || !midH) return null;

    return (
        <div className="pointer-events-none absolute z-20" style={{ inset }}>
            {players.map((p) => {
                if (p.bankrupt) return null;
                const pos = display[p.id] ?? p.position;
                const { row, col } = tilePlacement(pos, boardSize);
                const slot = slots[p.id] || { offset: 0 };
                const active = p.id === activeId;
                const w = trackSize(col, depth, midW, grid);
                const h = trackSize(row, depth, midH, grid);
                const jail = pos === jailId ? JAIL_SPOT[p.inJail ? 'locked' : 'visiting'] : null;
                return (
                    <motion.div
                        key={p.id}
                        initial={false}
                        animate={{
                            left:
                                trackOffset(col, depth, midW, gap) +
                                (0.5 + (jail?.dx || 0)) * w +
                                slot.offset -
                                token / 2,
                            top: trackOffset(row, depth, midH, gap) + (0.5 + (jail?.dy || 0)) * h - token / 2,
                            scale: active ? ACTIVE_SCALE : 1,
                        }}
                        transition={{ type: 'spring', stiffness: 900, damping: 46, mass: 0.5 }}
                        className="mono absolute flex items-center justify-center rounded-full font-semibold text-white"
                        style={{
                            width: token,
                            height: token,
                            fontSize: token * 0.4,
                            // whoever's turn it is sits on top of the pile
                            zIndex: active ? 2 : 1,
                            background: `linear-gradient(160deg, ${p.color}, ${alpha(p.color, 0.7)})`,
                            border: '1.5px solid rgba(255,255,255,.45)',
                            boxShadow: active
                                ? `0 0 0 2px ${alpha(p.color, 0.5)}, 0 0 16px ${alpha(p.color, 0.9)}`
                                : '0 2px 6px rgba(0,0,0,.75)',
                            opacity: p.connected ? 1 : 0.5,
                        }}
                        title={p.name}
                    >
                        {initials(p.name)}
                    </motion.div>
                );
            })}
        </div>
    );
}
