import { useState } from 'react';
import { CardFace } from './Card';
import { KIND_BLURB } from '@/lib/nouno';

/**
 * Your hand, fanned.
 *
 * The arc is the same centred-index-times-step arithmetic the board's token
 * layer already uses to pile tokens on one tile: index minus the middle, times
 * a step that tightens as there are more of them. Here it also drives a
 * rotation and a dip, and the whole row sits in a perspective so a lifted card
 * comes toward you rather than merely getting bigger.
 *
 * Two input models, one component. A mouse hovers, so hovering lifts. A finger
 * cannot, so the first tap lifts and the second plays — which is also the only
 * thing standing between a mis-swipe and your last card.
 */

/** How far a card lifts when it is the one you mean. */
const LIFT = 3.4;   // em
/**
 * How much higher the middle of the fan sits than its ends.
 *
 * Upward rather than downward: a hand held in front of you arcs up in the
 * middle, and dropping the ends instead pushes the outermost cards off the
 * bottom of the screen, which is exactly where the hand already is.
 */
const ARCH = 0.55;  // em per card from the middle

export function Hand({ cards, suits, playableIds, onPlay, disabled, size = 15 }) {
    const [armed, setArmed] = useState(null);
    const [hovered, setHovered] = useState(null);
    const n = cards.length;
    const mid = (n - 1) / 2;

    // Tighten as the hand grows: twelve cards at a comfortable spacing is
    // wider than a phone, and a hand you have to scroll is a hand you lose
    // track of. Rotation tightens with it, or a long hand becomes a wheel.
    const spread = Math.max(1.15, 3.6 - n * 0.16);
    const angle = Math.max(1.4, 5.2 - n * 0.18);

    const lifted = hovered ?? armed;

    return (
        <div className="flex w-full flex-col items-center gap-1">
            {/* The line under the fan that says what the card you are looking
                at actually does — the rules, where you need them, rather than
                in a menu you would have to go and find. */}
            <span className="h-4 text-[12px] text-muted-foreground">
                {lifted ? KIND_BLURB(cards.find((c) => c.id === lifted)) : ''}
            </span>
            <div
                className="flex w-full items-end justify-center"
                style={{ perspective: '900px', perspectiveOrigin: '50% 130%', fontSize: size }}
            >
                <div
                    className="relative flex items-end justify-center"
                    style={{ transformStyle: 'preserve-3d', height: '9.6em', width: '100%' }}
                >
                    {cards.map((card, i) => {
                        const t = i - mid;
                        const playable = !disabled && playableIds?.has(card.id);
                        const up = lifted === card.id;
                        return (
                            <CardFace
                                key={card.id}
                                card={card}
                                suits={suits}
                                dim={!playable}
                                className="absolute bottom-0 cursor-pointer"
                                style={{ zIndex: up ? 100 : i }}
                                onHoverStart={() => setHovered(card.id)}
                                onHoverEnd={() => setHovered((h) => (h === card.id ? null : h))}
                                onClick={() => {
                                    if (!playable) return;
                                    // Armed already, or hovered by a mouse:
                                    // this is the second half of the gesture.
                                    if (armed === card.id || hovered === card.id) {
                                        setArmed(null);
                                        onPlay?.(card);
                                        return;
                                    }
                                    setArmed(card.id);
                                }}
                                initial={false}
                                animate={{
                                    x: `${t * spread}em`,
                                    y: up ? `${-LIFT}em` : `${-(mid - Math.abs(t)) * ARCH}em`,
                                    rotateZ: up ? t * angle * 0.3 : t * angle,
                                    // The only reason the row needs a 3D
                                    // context at all: toward the viewer, not
                                    // just larger.
                                    z: up ? 70 : i * 0.6,
                                    scale: up ? 1.06 : 1,
                                }}
                                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.6 }}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
