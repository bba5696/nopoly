import { motion } from 'framer-motion';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';

/**
 * One card.
 *
 * Everything inside it is in `em`, so the whole card is sized by one number on
 * the parent — the same trick the board's slots use, and the reason a hand can
 * tighten on a phone without a second set of numbers for it.
 *
 * The face is drawn rather than imaged: a corner index top and bottom, a big
 * centre glyph, and the suit's colour carrying it. Two hundred and sixteen
 * card faces as pictures would be a download; as CSS they are a component.
 */

const GLYPH = {
    num: (card) => String(card.value),
    halt: () => '⦸',
    turn: () => '⇄',
    plus2: () => '+2',
    any: () => '★',
    any4: () => '+4',
};

/** What the corner index says — short, because there are two of them. */
const INDEX = {
    num: (card) => String(card.value),
    halt: () => '⦸',
    turn: () => '⇄',
    plus2: () => '+2',
    any: () => '★',
    any4: () => '+4',
};

export function CardFace({ card, suits, className, style, dim, ...rest }) {
    const colour = card.suit ? suits?.[card.suit]?.color || '#8b88a0' : '#e9e7f2';
    const glyph = (GLYPH[card.kind] || (() => '?'))(card);
    const index = (INDEX[card.kind] || (() => '?'))(card);
    // A wild belongs to no suit, so it wears all four instead of one.
    const wild = !card.suit;

    return (
        <motion.div
            {...rest}
            className={cn(
                'relative flex select-none items-center justify-center overflow-hidden rounded-[0.5em]',
                'border text-center will-change-transform',
                className,
            )}
            style={{
                width: '4.6em',
                height: '6.9em',
                borderColor: alpha(colour, 0.55),
                background: wild
                    ? 'linear-gradient(150deg,#ff5c7c 0%,#ffb648 33%,#3ddc97 66%,#4cc9f0 100%)'
                    : `linear-gradient(160deg, ${alpha(colour, 0.28)}, ${alpha(colour, 0.1)}), #12121a`,
                boxShadow: `0 0.5em 1.2em -0.6em rgba(0,0,0,.9), inset 0 0 0 0.08em ${alpha(colour, 0.25)}`,
                filter: dim ? 'grayscale(.65) brightness(.62)' : undefined,
                ...style,
            }}
        >
            {/* The oval every card in the world has, so the glyph sits on
                something rather than floating on the colour. */}
            <span
                className="absolute inset-[0.55em] rounded-[50%/32%]"
                style={{ background: wild ? 'rgba(10,10,16,.72)' : 'rgba(10,10,16,.55)' }}
            />
            <span
                className="relative font-medium"
                style={{
                    fontSize: card.kind === 'num' ? '2.6em' : '1.7em',
                    lineHeight: 1,
                    color: wild ? '#f4f3fa' : colour,
                    textShadow: '0 0.06em 0.1em rgba(0,0,0,.6)',
                }}
            >
                {glyph}
            </span>
            <span
                className="absolute top-[0.3em] left-[0.4em] font-medium"
                style={{ fontSize: '0.85em', color: wild ? '#f4f3fa' : colour }}
            >
                {index}
            </span>
            <span
                className="absolute right-[0.4em] bottom-[0.3em] rotate-180 font-medium"
                style={{ fontSize: '0.85em', color: wild ? '#f4f3fa' : colour }}
            >
                {index}
            </span>
        </motion.div>
    );
}

/** The back, for everybody else's cards and for the stock. */
export function CardBack({ className, style }) {
    return (
        <div
            className={cn('rounded-[0.5em] border border-white/10', className)}
            style={{
                width: '4.6em',
                height: '6.9em',
                background:
                    'repeating-linear-gradient(135deg, #241f3d 0 0.5em, #1b1830 0.5em 1em), #1b1830',
                boxShadow: '0 0.4em 1em -0.6em rgba(0,0,0,.9), inset 0 0 0 0.12em rgba(124,92,255,.25)',
                ...style,
            }}
        >
            <span
                className="flex size-full items-center justify-center text-[1.5em] font-medium"
                style={{ color: 'rgba(124,92,255,.55)' }}
            >
                n
            </span>
        </div>
    );
}
