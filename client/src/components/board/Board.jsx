import { useMemo } from 'react';
import { useGame } from '@/lib/game-context';
import { useElementSize } from '@/lib/use-element-size';
import { useNameSize } from '@/lib/use-name-size';
import { gridFor } from '@/lib/board-layout';
import { Tile } from './Tile';
import { TokenLayer } from './TokenLayer';
import { BoardCenter } from './BoardCenter';

const PAD = 10;
const GAP = 3;
/** How much deeper a ring slot is than it is wide, along the top and bottom. */
const DEPTH_RATIO = 1.3;

export function Board({ display, moving, onSelectTile }) {
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
    const nameSize = useNameSize(state.tiles, narrow - 8, tileFont * 0.95);

    const ownerOf = useMemo(() => {
        const map = {};
        for (const p of state.players) map[p.id] = p;
        return map;
    }, [state.players]);

    const track = `${geom.depth}px repeat(${GRID - 2}, minmax(0, 1fr)) ${geom.depth}px`;

    return (
        // Square, because a ring only has evenly sized slots when the nine
        // middle columns and nine middle rows work out the same — stretching it
        // wider makes the top and bottom slots chunky and the sides thin.
        // Leftover width goes to the rails instead.
        // Height budget: header (~42px) + the layout's 8px padding top and bottom.
        <div className="relative mx-auto aspect-square w-full max-w-[min(100%,calc(100svh-58px))]">
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
                {state.tiles.map((tile) => (
                    <Tile
                        key={tile.id}
                        tile={tile}
                        boardSize={tileCount}
                        groups={board?.groups}
                        fontSize={tileFont}
                        nameSize={nameSize}
                        owner={tile.ownerId ? ownerOf[tile.ownerId] : null}
                        setOwned={!!tile.groupId && state.completedGroups[tile.groupId] === tile.ownerId}
                        onSelect={onSelectTile}
                    />
                ))}
                <BoardCenter moving={moving} />
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
