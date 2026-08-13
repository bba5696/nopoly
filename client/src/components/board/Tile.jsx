import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsRight } from 'lucide-react';
import { isCorner, jailIndex, taxLabel, tilePlacement } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';
import { flagFor } from '@/lib/emblems';
import { priceOf, trendColor, trendOf } from '@/lib/market';
import { Slot, SlotBody, SlotEmblem, SlotJail, SlotName, SlotPrice } from '@/components/ui/slot';
import { iconKindFor } from '@/lib/tile-icon-kind';
import { TileIcon } from './TileIcon';

const VACANT_PILL = 'rgba(255,255,255,0.11)';
const VACANT_SURFACE = 'rgba(255,255,255,0.055)';

// The tax chip. Tinted rather than filled: it sits in the same place as a
// property's price and should read as the same kind of fact, just one that
// costs you — a solid red chip there looks like an owner's colour.
const TAX_PILL = 'rgba(255,92,124,0.14)';
const TAX_TEXT = '#ff9db2';

// Silhouettes rather than plain blocks — at this size a square reads as a pip,
// and four pips in a row look like a counter rather than a developed street.
// The dark stroke is what keeps them legible: the pill behind them is the
// owner's colour, which can be anything from navy to yellow.
const HOUSE = 'M6 0 12 5 10.5 5 10.5 11 1.5 11 1.5 5 0 5Z';
// A hotel is one bigger building, not a bigger house: flat roof with a cap.
const HOTEL = 'M0 1h20v2.2H0Z M2 3.2h16V11H2Z';

// Mitred, not rounded: at eight pixels tall a round join swallows the roof
// peak and the house reads as a dot.
function Building({ path, box, width, height }) {
    return (
        <svg
            viewBox={`0 0 ${box} 11`}
            style={{ width, height }}
            fill="#fff"
            stroke="rgba(0,0,0,0.45)"
            strokeWidth="0.5"
            strokeLinejoin="miter"
        >
            <path d={path} />
        </svg>
    );
}

// Sized against the slot rather than by eye: four houses plus their gaps come
// to ~2.7em inside a 3.4em slot, which leaves the pill its rounded ends.
function Houses({ houses }) {
    if (houses === 5) return <Building path={HOTEL} box={20} width="1em" height="0.55em" />;
    return (
        <span className="flex gap-[0.07em]">
            {Array.from({ length: houses }).map((_, i) => (
                <Building key={i} path={HOUSE} box={12} width="0.62em" height="0.57em" />
            ))}
        </span>
    );
}

export function Tile({ tile, boardSize, groups, fontSize, nameSize, owner, setOwned, onSelect, dim, lit, litColor }) {
    const { side, row, col } = tilePlacement(tile.id, boardSize);
    const corner = isCorner(tile.id, boardSize);
    const jail = tile.id === jailIndex(boardSize);
    const start = tile.id === 0;
    const group = tile.groupId ? groups?.[tile.groupId] : null;
    const isTax = tile.type === 'tax';
    const accent =
        group?.color ||
        (tile.type === 'airport' ? '#9aa0b5' : tile.type === 'utility' ? '#7dd3fc' : isTax ? TAX_TEXT : '#5a5a70');
    const flag = flagFor(tile);
    const iconKind = iconKindFor(tile);
    const trend = trendOf(tile);

    const tone = corner ? 'corner' : owner ? 'owned' : tile.price > 0 ? 'vacant' : 'special';
    // Cards and corners have no price and never get an owner, so they skip the
    // chip entirely and carry their icon in the body. Tax has no price either
    // but does cost you something, so it keeps the chip — see below.
    const plain = corner || tile.price === 0;

    return (
        <Slot
            side={side}
            tone={tone}
            onClick={() => onSelect?.(tile)}
            className={cn(
                setOwned && 'set-owned',
                // Spotlight: hovering a player in the rail drops the rest of
                // the board back so their holdings read at a glance.
                'transition-[filter,opacity] duration-200',
                dim && 'opacity-[0.22] saturate-[0.4]',
                lit && 'z-10',
            )}
            style={{
                gridRow: row,
                gridColumn: col,
                fontSize,
                '--set-color-soft': owner ? alpha(owner.color, 0.5) : 'transparent',
                ...(lit && litColor ? { filter: `drop-shadow(0 0 0.5em ${alpha(litColor, 0.75)})` } : null),
            }}
            surface={{
                animate: {
                    backgroundColor: owner ? alpha(owner.color, setOwned ? 0.3 : 0.21) : VACANT_SURFACE,
                    borderColor: owner ? alpha(owner.color, 0.55) : 'rgba(255,255,255,0.07)',
                },
                transition: { duration: 0.6, ease: 'easeOut' },
            }}
            emblem={
                // plain slots carry their icon in the body instead
                (!plain || isTax) && (
                    <SlotEmblem side={side} ring={owner ? alpha(owner.color, 0.95) : alpha(accent, 0.6)}>
                        {flag ? (
                            <img src={flag} alt="" className="size-full object-cover" draggable={false} />
                        ) : (
                            <TileIcon kind={iconKind} className="text-[1.05em]" />
                        )}
                    </SlotEmblem>
                )
            }
        >
            {/* one-time flash the moment the colour set completes */}
            <AnimatePresence>
                {setOwned && (
                    <motion.span
                        key="setflash"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 0.85, 0] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.1, times: [0, 0.25, 1] }}
                        className="pointer-events-none absolute inset-0"
                        style={{ background: alpha(owner?.color || '#fff', 0.7) }}
                    />
                )}
            </AnimatePresence>

            {jail ? (
                <SlotJail />
            ) : start ? (
                <SlotBody className="gap-[0.15em]">
                    <span className="text-[1.35em] font-bold tracking-[0.06em] text-[#a3e635]">START</span>
                    <ChevronsRight className="size-[1.5em] text-[#a3e635]" strokeWidth={3} />
                </SlotBody>
            ) : isTax ? (
                // Tax is the odd one out: no price and no owner, like a card
                // slot, but it is the one square besides a property that takes
                // money off you. So it is built like a property rather than
                // like a card — rate in the chip a price would be in, emblem on
                // the inner edge, name in between.
                //
                // It used to be a card slot with the rate as loose text under
                // the name, at 0.95em. That is sized off the *slot*, while the
                // name is sized to fit the slot, so the rate came out larger
                // than the name of the tile it belonged to and read as the
                // headline. Moving it into the chip makes it the same size and
                // in the same place as every other number on the board.
                <>
                    <SlotPrice style={{ backgroundColor: TAX_PILL, color: TAX_TEXT }}>
                        {taxLabel(tile)}
                    </SlotPrice>
                    <SlotBody className={side === 'bottom' ? 'pt-[0.9em]' : 'pb-[0.9em]'}>
                        <SlotName className="text-muted-foreground" style={{ fontSize: nameSize }}>
                            {tile.name}
                        </SlotName>
                    </SlotBody>
                </>
            ) : plain ? (
                <SlotBody className="gap-[0.35em]">
                    {/* the name follows the board edge, but the icon stays upright */}
                    <TileIcon
                        kind={iconKind}
                        className="text-[1.75em]"
                        style={{ transform: { left: 'rotate(90deg)', right: 'rotate(-90deg)' }[side] }}
                    />
                    <SlotName className="font-medium text-muted-foreground" style={{ fontSize: nameSize }}>
                        {tile.name}
                    </SlotName>
                </SlotBody>
            ) : (
                <>
                    <SlotPrice
                        animate={{
                            backgroundColor: owner ? owner.color : VACANT_PILL,
                            color: owner ? '#fff' : 'var(--muted-foreground)',
                        }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                    >
                        {/* owned slots drop the price — the colour says it all */}
                        {owner ? (
                            tile.houses > 0 && <Houses houses={tile.houses} />
                        ) : (
                            <>
                                ${priceOf(tile)}
                                {trend && (
                                    <span
                                        className="text-[0.85em] leading-none"
                                        style={{ color: trendColor(trend) }}
                                        title={`${trend.up ? 'Up' : 'Down'} ${trend.pct}% on book value`}
                                    >
                                        {trend.up ? '▲' : '▼'}
                                    </span>
                                )}
                            </>
                        )}
                    </SlotPrice>

                    {/* keep the name clear of the emblem on the inner edge —
                        after rotation that is the content's bottom everywhere
                        except the bottom row, which is reversed */}
                    <SlotBody className={side === 'bottom' ? 'pt-[0.9em]' : 'pb-[0.9em]'}>
                        <SlotName style={{ fontSize: nameSize, color: owner ? '#fff' : 'var(--foreground)' }}>
                            {tile.name}
                        </SlotName>
                    </SlotBody>
                </>
            )}
        </Slot>
    );
}
