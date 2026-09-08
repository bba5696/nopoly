import { AnimatePresence, motion } from 'framer-motion';
import { RotateCw, RotateCcw } from 'lucide-react';
import { CardBack, CardFace } from './Card';
import { alpha, tag } from '@/lib/color';
import { cn } from '@/lib/utils';

/**
 * The middle of the table: what has been played, what is left to draw, and
 * which way play is going.
 *
 * The pile keeps a few cards under the top one, rotated a little each, because
 * a single card lying alone reads as a card rather than as a pile — and the
 * discard growing is most of what tells you a game is moving.
 */
export function Pile({ top, active, suits, count, size = 16 }) {
    const colour = active ? suits?.[active]?.color : '#8b88a0';
    return (
        <div className="relative flex items-center justify-center" style={{ fontSize: size }}>
            {/* The suit being followed, which after a wild is not the suit of
                the card lying there — so it gets said out loud. */}
            <span
                className="absolute -inset-6 rounded-full blur-2xl"
                style={{ background: alpha(colour, 0.22) }}
            />
            {[2, 1].map((n) => (
                <span
                    key={n}
                    className="absolute rounded-[0.5em] border border-white/8 bg-[#15151f]"
                    style={{
                        width: '4.6em',
                        height: '6.9em',
                        transform: `rotate(${n * 7 - 10}deg) translateY(${n * 0.12}em)`,
                    }}
                />
            ))}
            <AnimatePresence mode="popLayout">
                {top && (
                    <motion.div
                        key={top.id}
                        initial={{ scale: 0.7, y: -30, opacity: 0, rotate: -12 }}
                        animate={{ scale: 1, y: 0, opacity: 1, rotate: 2 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                        className="relative"
                    >
                        <CardFace card={top} suits={suits} />
                    </motion.div>
                )}
            </AnimatePresence>
            {count > 1 && (
                <span className="mono absolute -bottom-6 text-[11px] text-muted-foreground">{count} played</span>
            )}
        </div>
    );
}

/** The stock, and the button that takes one off it. */
export function Stock({ count, onDraw, canDraw, size = 16 }) {
    return (
        <div className="flex flex-col items-center gap-2" style={{ fontSize: size }}>
            <button
                type="button"
                disabled={!canDraw}
                onClick={onDraw}
                title={canDraw ? 'Draw a card' : 'Not your turn'}
                className={cn(
                    'relative transition-transform',
                    canDraw ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default opacity-60',
                )}
            >
                {[2, 1, 0].map((n) => (
                    <span
                        key={n}
                        className={n === 0 ? 'relative block' : 'absolute inset-0'}
                        style={{ transform: `translate(${n * 0.12}em, ${n * -0.12}em)` }}
                    >
                        <CardBack />
                    </span>
                ))}
            </button>
            <span className="mono text-[11px] text-muted-foreground">{count} left</span>
        </div>
    );
}

/** Which way it is going, in one glyph. */
export function TurnArrow({ direction }) {
    const Icon = direction === 1 ? RotateCw : RotateCcw;
    return (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Icon className="size-4" />
            {direction === 1 ? 'clockwise' : 'anticlockwise'}
        </span>
    );
}

/**
 * Somebody else's hand: a few backs and a count.
 *
 * Never one back per card — a hand of twenty would run off the table, and the
 * number is the thing you actually want to know.
 */
export function OpponentHand({ player, count, active, said, size = 9, tilt = 0 }) {
    const shown = Math.min(count, 6);
    const mid = (shown - 1) / 2;
    return (
        <div className="relative flex flex-col items-center">
            {/* Turned to face the middle of the table. Rotating the cards moves
                where they *look* but not the box they occupy, so the name is
                laid over them rather than under: at ninety degrees, under is
                somewhere else entirely. */}
            <div
                className="relative flex items-end justify-center"
                style={{ fontSize: size, height: '7.4em', width: '7.4em', transform: `rotate(${tilt}deg)` }}
            >
                {Array.from({ length: shown }).map((_, i) => (
                    <span
                        key={i}
                        className="absolute bottom-0"
                        style={{ transform: `translateX(${(i - mid) * 1.5}em) rotate(${(i - mid) * 5}deg)` }}
                    >
                        <CardBack />
                    </span>
                ))}
            </div>
            <span
                className={cn(
                    'absolute -bottom-2 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] whitespace-nowrap backdrop-blur-sm transition-colors',
                    active ? 'border-white/25 bg-[#1a1a25]/95' : 'border-white/10 bg-[#12121a]/90',
                )}
            >
                <span
                    className="mono flex size-4 items-center justify-center rounded-full text-[8px] text-white"
                    style={{ background: player.color, opacity: player.out ? 0.4 : 1 }}
                >
                    {tag(player)}
                </span>
                <span className={cn(active && 'font-medium')}>{player.name}</span>
                <span className="mono text-[11px] text-muted-foreground">{count}</span>
                {said && <span className="label !text-[9px] text-[#ffb648]">last</span>}
            </span>
        </div>
    );
}
