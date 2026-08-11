import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsRight } from 'lucide-react';
import { isCorner, jailIndex, tilePlacement } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { flagFor } from '@/lib/emblems';
import { priceOf, trendColor, trendOf } from '@/lib/market';
import { Slot, SlotBody, SlotEmblem, SlotJail, SlotName, SlotPrice } from '@/components/ui/slot';
import { TileIcon, iconKindFor } from './TileIcon';

const VACANT_PILL = 'rgba(255,255,255,0.11)';
const VACANT_SURFACE = 'rgba(255,255,255,0.055)';

function Houses({ houses }) {
    if (houses === 5) {
        return <span className="h-[0.42em] w-[1.15em] rounded-[0.1em] bg-white shadow-[0_0_0.4em_rgba(255,255,255,.8)]" />;
    }
    return (
        <span className="flex gap-[0.14em]">
            {Array.from({ length: houses }).map((_, i) => (
                <span key={i} className="size-[0.36em] rounded-[0.07em] bg-white/90" />
            ))}
        </span>
    );
}

export function Tile({ tile, boardSize, groups, fontSize, nameSize, owner, setOwned, onSelect }) {
    const { side, row, col } = tilePlacement(tile.id, boardSize);
    const corner = isCorner(tile.id, boardSize);
    const jail = tile.id === jailIndex(boardSize);
    const start = tile.id === 0;
    const group = tile.groupId ? groups?.[tile.groupId] : null;
    const accent = group?.color || (tile.type === 'airport' ? '#9aa0b5' : tile.type === 'utility' ? '#7dd3fc' : '#5a5a70');
    const flag = flagFor(tile);
    const iconKind = iconKindFor(tile);
    const trend = trendOf(tile);

    const tone = corner ? 'corner' : owner ? 'owned' : tile.price > 0 ? 'vacant' : 'special';
    // Cards, taxes and corners have no price and never get an owner, so they
    // skip the banner entirely and lead with their emblem.
    const plain = corner || tile.price === 0;

    return (
        <Slot
            side={side}
            tone={tone}
            onClick={() => onSelect?.(tile)}
            className={setOwned ? 'set-owned' : undefined}
            style={{
                gridRow: row,
                gridColumn: col,
                fontSize,
                '--set-color-soft': owner ? alpha(owner.color, 0.5) : 'transparent',
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
                !plain && (
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
