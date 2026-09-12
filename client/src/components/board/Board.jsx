import { useMemo } from 'react';
import { useGame } from '@/lib/game-context';
import { cn } from '@/lib/utils';
import { useElementSize } from '@/lib/use-element-size';
import { useNameSize } from '@/lib/use-name-size';
import { gridFor } from '@/lib/board-layout';
import { lotGroup, lotStakes } from '@/lib/auction';
import { Tile } from './Tile';
import { TokenLayer } from './TokenLayer';
import { BoardCenter } from './BoardCenter';

const PAD = 10;
const GAP = 3;
/** How much deeper a ring slot is than it is wide, along the top and bottom. */
const DEPTH_RATIO = 1.3;

export function Board({ display, moving, spotlight, onSelectTile, sizePx, auctionMin, onAuctionMin }) {
    const { state, board, current } = useGame();
    const [gridRef, size] = useElementSize();

    // The ring is as long as the board the room is playing on.
    const tileCount = state.tiles.length;
    const GRID = gridFor(tileCount);

    const geom = useMemo(() => {
        // `size` is already the grid's content box, so only the gaps come off —
        // subtracting the padding here as well would shrink every track and
        // walk the tokens off-centre a little further with each column.
        const innerW = Math.max(size.width - GAP * (GRID - 1), 0);
        const innerH = Math.max(size.height - GAP * (GRID - 1), 0);
        // The ring has one depth on all four sides, like a real board: slots
        // stand perpendicular to their edge instead of lying flat along it.
        // Capped against the height so the nine middle rows never collapse.
        const depth = Math.min((innerW / GRID) * DEPTH_RATIO, innerH * 0.26);
        const midW = Math.max((innerW - 2 * depth) / (GRID - 2), 0);
        const midH = Math.max((innerH - 2 * depth) / (GRID - 2), 0);
        return { depth, midW, midH };
    }, [size.width, size.height, GRID]);

    // Slot internals are all in `em`. The binding constraint is the narrow
    // dimension — how much room a name has to run along its edge.
    const narrow = Math.min(geom.midW, geom.midH);
    const tileFont = Math.max(8, Math.min(narrow * 0.3, 22));

    // One size for every name on the board — per-tile shrinking looked
    // arbitrary, with some names noticeably smaller than their neighbours.
    //
    // Measured against the name's real box, which is the slot less the body's
    // own `0.25em` padding either side. Being a few pixels optimistic used to
    // cost nothing, since a name that didn't quite fit simply hung over the
    // edge; now that the name is held to the slot's width it breaks mid-word
    // instead, so the allowance has to be honest.
    const nameRoom = Math.max(narrow - tileFont * 0.5 - 8, 8);
    const nameSize = useNameSize(state.tiles, nameRoom, tileFont * 0.95);

    const ownerOf = useMemo(() => {
        const map = {};
        for (const p of state.players) map[p.id] = p;
        return map;
    }, [state.players]);

    // Which tiles the board is drawing attention to, and in what colour.
    //
    // Two things ask for it. Hovering somebody in the roster lights what they
    // own; an auction lights the country being sold, and wins, because an
    // auction holds up the whole table. The auction lights it in the leader's
    // colour the moment they would complete the set — so "Bo is about to finish
    // Egypt" is something you see on the board rather than something you work
    // out from it.
    const focus = useMemo(() => {
        const auction = state.auction;
        if (auction) {
            const lot = state.tiles[auction.tileId];
            const group = lotGroup(state, lot);
            const leader = auction.bidderId ? ownerOf[auction.bidderId] : null;
            const completes = leader && lotStakes(state, lot, leader.id).completes;
            return {
                ids: new Set(group.map((t) => t.id)),
                lotId: lot.id,
                color: (completes && leader.color) || board?.groups?.[lot.groupId]?.color || '#7dd3fc',
                // The middle is the auction panel now, so it is the last thing
                // that should be dropped back.
                dimCenter: false,
            };
        }
        if (!spotlight) return null;
        return {
            ids: new Set(state.tiles.filter((t) => t.ownerId === spotlight).map((t) => t.id)),
            lotId: null,
            color: ownerOf[spotlight]?.color,
            dimCenter: true,
        };
    }, [state, spotlight, ownerOf, board]);

    const track = `${geom.depth}px repeat(${GRID - 2}, minmax(0, 1fr)) ${geom.depth}px`;

    return (
        // Square, because a ring only has evenly sized slots when the nine
        // middle columns and nine middle rows work out the same — stretching it
        // wider makes the top and bottom slots chunky and the sides thin.
        // Leftover width goes to the rails instead.
        // Height budget: header (~42px) + the layout's 8px padding top and bottom.
        //
        // `sizePx` hands that decision to BoardViewport, which sizes the board
        // to what its tiles need to be readable and scrolls if that is larger
        // than the room available. Without it the board fits itself to its box,
        // which is what every other caller wants.
        <div
            className={cn(
                'relative aspect-square',
                sizePx ? 'shrink-0' : 'mx-auto w-full max-w-[min(100%,calc(100svh-58px))]',
            )}
            style={sizePx ? { width: sizePx, height: sizePx } : undefined}
        >
            <div
                ref={gridRef}
                className="grid size-full rounded-3xl border border-white/[0.06] bg-[#0b0b12]/80 shadow-[0_50px_110px_-60px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,.04)]"
                style={{
                    padding: PAD,
                    gap: GAP,
                    gridTemplateColumns: track,
                    gridTemplateRows: track,
                }}
            >
                {/* `setOwned` compares by side, not by owner: with teams on, a
                    complete set can be split between two teammates. */}
                {state.tiles.map((tile) => (
                    <Tile
                        key={tile.id}
                        tile={tile}
                        boardSize={tileCount}
                        groups={board?.groups}
                        fontSize={tileFont}
                        nameSize={nameSize}
                        owner={tile.ownerId ? ownerOf[tile.ownerId] : null}
                        setOwned={!!tile.groupId && state.completedGroups[tile.groupId] === tile.side}
                        onSelect={onSelectTile}
                        dim={!!focus && !focus.ids.has(tile.id)}
                        lit={!!focus && focus.ids.has(tile.id)}
                        litColor={focus?.color}
                        lot={focus?.lotId === tile.id}
                    />
                ))}
                <BoardCenter
                    moving={moving}
                    dim={!!focus?.dimCenter}
                    auctionMin={auctionMin}
                    onAuctionMin={onAuctionMin}
                />
            </div>
            <TokenLayer
                players={state.players}
                display={display}
                activeId={current?.id}
                boardSize={tileCount}
                geom={geom}
                gap={GAP}
                inset={PAD + 1}
            />
        </div>
    );
}
