import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { useElementSize } from '@/lib/use-element-size';
import { gridFor } from '@/lib/board-layout';
import { cn } from '@/lib/utils';
import { Board } from './Board';

/**
 * The board, at a size worth reading, in a window that moves.
 *
 * A ring is drawn as a square fitted to whatever space it is given, so every
 * tile a board adds takes width off every other one. On a laptop that is fine
 * up to about fourteen tiles a side; on a phone it stopped being fine at ten.
 * Shrinking to fit is the wrong trade there — the whole board being visible is
 * worth nothing if none of it can be read.
 *
 * So the board is laid out at whatever size its tiles need, and the viewport
 * scrolls instead. A finger drags it; the buttons in the corner change the
 * size; Fit puts the whole thing back on screen for a look at who owns what.
 * Real layout rather than a CSS transform, so text is rendered at the size it
 * is displayed at instead of being magnified.
 */

/** Below this a tile's name stops being a name and starts being a smudge. */
const MIN_TILE = 34;
/** Must match Board's: how much deeper an edge slot is than it is wide. */
const DEPTH_RATIO = 1.3;
const MAX_ZOOM = 3;
const STEP = 0.25;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

/**
 * The board width at which a middle slot is `MIN_TILE` across.
 *
 * Board splits its width into two edge tracks of `size / grid * DEPTH_RATIO`
 * and `grid - 2` middle ones, so the middle track is what has to clear the
 * floor — the corners are deep enough to be fine either way.
 */
function legibleWidth(grid) {
    const share = Math.max(1 - (2 * DEPTH_RATIO) / grid, 0.2);
    return (MIN_TILE * (grid - 2)) / share;
}

export function BoardViewport({ className, ...board }) {
    const { state } = useGame();
    const grid = gridFor(state.tiles.length);
    const [frameRef, frame] = useElementSize();
    const scroller = useRef(null);

    // The square that fits, and the square that reads. Below xl the frame is a
    // fixed slice of the viewport; at xl it is the middle column, and both are
    // measured rather than guessed at.
    const fit = Math.min(frame.width, frame.height);
    const needed = fit > 0 ? clamp(legibleWidth(grid) / fit, 1, MAX_ZOOM) : 1;

    // `null` means nobody has chosen, so the board opens at the size it needs.
    // A choice sticks until Fit is pressed, including across board changes.
    const [chosen, setChosen] = useState(null);
    const zoom = clamp(chosen ?? needed, 1, MAX_ZOOM);
    const size = Math.round(fit * zoom);
    const zoomable = needed > 1 || zoom > 1;

    // Keep the middle of the board in the middle of the window when the size
    // changes, rather than pinning it to the top-left corner it grew out of.
    const last = useRef(0);
    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el || !size || size === last.current) return;
        const was = last.current;
        last.current = size;
        // The first sizing has nothing to preserve, so it simply centres.
        const ratio = was ? size / was : null;
        const cx = ratio ? (el.scrollLeft + el.clientWidth / 2) * ratio : size / 2;
        const cy = ratio ? (el.scrollTop + el.clientHeight / 2) * ratio : size / 2;
        el.scrollLeft = cx - el.clientWidth / 2;
        el.scrollTop = cy - el.clientHeight / 2;
    }, [size]);

    // Ctrl+wheel is the zoom gesture everywhere else, and a trackpad pinch
    // arrives as one. Without this it would zoom the whole page instead.
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const onWheel = (ev) => {
            if (!ev.ctrlKey && !ev.metaKey) return;
            ev.preventDefault();
            setChosen((z) => clamp((z ?? needed) - ev.deltaY * 0.003, 1, MAX_ZOOM));
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [needed]);

    const nudge = (by) => setChosen((z) => clamp((z ?? needed) + by, 1, MAX_ZOOM));

    return (
        <div ref={frameRef} className={cn('relative', className)}>
            <div
                ref={scroller}
                className="scroll-thin size-full overflow-auto overscroll-contain"
                // A drag is a pan; a pinch is left to the browser, which zooms
                // the page — the buttons are the board's own zoom.
                style={{ touchAction: 'pan-x pan-y' }}
            >
                {/* `w-max` so this box grows to the board rather than to the
                    scroll container. A centred child wider than its container
                    overflows to the left, where scrolling cannot reach it;
                    `min-w-full` keeps it centred while it still fits. */}
                <div className="flex min-h-full w-max min-w-full items-center justify-center">
                    <Board {...board} sizePx={size || undefined} />
                </div>
            </div>

            {zoomable && (
                <div className="pointer-events-auto absolute right-1 bottom-1 flex items-center gap-0.5 rounded-full border border-white/10 bg-[#101018]/85 p-0.5 backdrop-blur-sm">
                    <button
                        type="button"
                        title="Smaller"
                        disabled={zoom <= 1}
                        onClick={() => nudge(-STEP)}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    >
                        <Minus className="size-3.5" />
                    </button>
                    <span className="mono w-10 text-center text-[11px] text-muted-foreground">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        type="button"
                        title="Bigger"
                        disabled={zoom >= MAX_ZOOM}
                        onClick={() => nudge(STEP)}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                    >
                        <Plus className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        title="Fit the whole board on screen"
                        onClick={() => setChosen(1)}
                        className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <Maximize2 className="size-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
}
