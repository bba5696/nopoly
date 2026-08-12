import { motion } from 'framer-motion';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Board slot primitive — the rounded frame every square on the board is built
 * from:
 *
 *   <Slot side="bottom" tone="owned" surface={…} emblem={<SlotEmblem/>}>
 *     <SlotBanner side="bottom" />       outer-edge strip
 *     <SlotBody><SlotName /></SlotBody>
 *   </Slot>
 *
 * `side` is which edge of the board the slot sits on. The content is rotated so
 * it faces that edge — names on the side columns read along the board the way
 * they do on a physical set — and so the banner always hugs the *outer* edge
 * with the emblem facing the middle.
 *
 * Cells are not square, so the rotated content box has to swap its width and
 * height. It does that with container query units against the card surface,
 * which keeps the whole thing pure CSS.
 *
 * The card surface is a separate clipped layer inside an unclipped button. That
 * lets the emblem hang half outside the frame while the banner and the
 * set-completion flash still get clipped to the rounded corners.
 *
 * Everything is sized in `em`, so a slot scales purely off the font-size the
 * board hands it.
 */
const CONTENT_TRANSFORM = { top: '', bottom: '', left: 'rotate(-90deg)', right: 'rotate(90deg)' };
const CONTENT_DIRECTION = { top: 'column', bottom: 'column-reverse', left: 'column', right: 'column' };
const isVertical = (side) => side === 'left' || side === 'right';

/** Emblems sit on the inner edge — the one facing the middle of the board. */
const EMBLEM_POSITION = {
    bottom: { top: 0, left: '50%', transform: 'translate(-50%, -55%)' },
    top: { bottom: 0, left: '50%', transform: 'translate(-50%, 55%)' },
    left: { right: 0, top: '50%', transform: 'translate(55%, -50%)' },
    right: { left: 0, top: '50%', transform: 'translate(-55%, -50%)' },
};

const surfaceVariants = cva('absolute inset-0 overflow-hidden rounded-[0.55em] border', {
    variants: {
        tone: {
            vacant: 'border-white/[0.07]',
            owned: 'border-transparent',
            special: 'border-white/[0.05]',
            corner: 'border-white/[0.09]',
        },
    },
    defaultVariants: { tone: 'vacant' },
});

export function Slot({ side = 'bottom', tone, surface, emblem, className, style, children, ...props }) {
    return (
        <button
            type="button"
            data-slot="slot"
            className={cn(
                'group/slot relative outline-none transition-[filter] duration-200 hover:z-10 hover:brightness-[1.35] focus-visible:z-10',
                className,
            )}
            style={style}
            {...props}
        >
            <motion.span
                data-slot="slot-surface"
                className={surfaceVariants({ tone })}
                style={{ containerType: 'size' }}
                {...surface}
            >
                <span
                    className="absolute left-1/2 top-1/2 flex"
                    style={{
                        // swapped box on the rotated sides, via the surface's
                        // own dimensions
                        width: isVertical(side) ? '100cqh' : '100cqw',
                        height: isVertical(side) ? '100cqw' : '100cqh',
                        flexDirection: CONTENT_DIRECTION[side],
                        transform: `translate(-50%, -50%) ${CONTENT_TRANSFORM[side]}`,
                    }}
                >
                    {children}
                </span>
            </motion.span>
            {/* outside the clipped surface so it can hang over the edge */}
            {emblem}
        </button>
    );
}

/**
 * Small pill near the outer edge: the price while the slot is vacant, a solid
 * chip in the owner's colour once it's claimed.
 */
export function SlotPrice({ className, children, ...props }) {
    return (
        <span data-slot="slot-price" className="flex shrink-0 justify-center px-[0.3em] py-[0.4em]">
            <motion.span
                className={cn(
                    // min-height keeps the chip a chip once it's owned and has
                    // no price text left inside it
                    'mono flex min-h-[1.35em] min-w-[2.9em] items-center justify-center gap-[0.25em] rounded-full px-[0.5em] text-[0.7em] leading-none',
                    className,
                )}
                {...props}
            >
                {children}
            </motion.span>
        </span>
    );
}

export function SlotBody({ className, children }) {
    return (
        <span
            data-slot="slot-body"
            className={cn(
                'flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-[0.2em] px-[0.25em] text-center',
                className,
            )}
        >
            {children}
        </span>
    );
}

export function SlotName({ className, children, ...props }) {
    return (
        <span
            data-slot="slot-name"
            // Hyphenation was meant to save the handful of names too long for
            // one line. On a phone every slot is too narrow for its name and
            // only the first clamped line survives, so the board turned into
            // "Sal-", "Lux-ur-", "Sur-prise" — a trailing hyphen promises a
            // rest of the word that never arrives.
            //
            // `break-words` rather than nothing at all: a long name with no
            // space in it has no break to take, and it would spill out of the
            // slot in both directions and show its middle ("alvado") instead
            // of its start.
            //
            // `w-full` is what makes any of that work: the body centres its
            // children, so without it the name is sized to its own text and
            // simply grows past the slot — there is no line box to break.
            lang="en"
            className={cn('line-clamp-2 w-full leading-[1.08] break-words', className)}
            {...props}
        >
            {children}
        </span>
    );
}

/**
 * Round emblem straddling the inner edge of the card. Rendered outside the
 * clipped surface so it can hang over the frame.
 */
export function SlotEmblem({ side = 'bottom', ring, className, style, children, ...props }) {
    return (
        <span
            data-slot="slot-emblem"
            className={cn(
                'pointer-events-none absolute z-[5] flex size-[1.6em] items-center justify-center overflow-hidden rounded-full bg-[#12121a] text-[0.95em] leading-none',
                className,
            )}
            style={{
                ...EMBLEM_POSITION[side],
                boxShadow: `0 0 0 0.12em ${ring || 'rgba(255,255,255,.18)'}, 0 0.15em 0.35em rgba(0,0,0,.7)`,
                ...style,
            }}
            {...props}
        >
            {children}
        </span>
    );
}

/**
 * The jail corner: a "passing by" lane along the outside and a barred cell for
 * anyone actually locked up.
 */
export function SlotJail({ className }) {
    return (
        <span className={cn('relative size-full', className)}>
            <span className="label absolute inset-x-[0.3em] top-[0.35em] text-center !text-[0.55em] leading-none">
                Passing by
            </span>
            {/* the cell sits in the inner corner, leaving the outer edges as
                the lane for anyone merely passing through */}
            <span
                className="absolute bottom-[0.3em] left-[0.3em] flex h-[66%] w-[74%] items-end justify-center overflow-hidden rounded-[0.35em] border border-white/20 bg-white/[0.07]"
                style={{
                    backgroundImage:
                        'repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0 0.13em, transparent 0.13em 0.5em)',
                }}
            >
                <span className="mono w-full bg-black/70 py-[0.15em] text-center text-[0.58em] font-medium leading-none text-white">
                    In Prison
                </span>
            </span>
        </span>
    );
}
