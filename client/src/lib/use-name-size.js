import { useEffect, useMemo, useState } from 'react';

const BOARD_FONT = "500 100px 'Outfit Variable', system-ui, sans-serif";
/** Share of names allowed to hyphenate onto a second line. */
const FIT_PERCENTILE = 0.82;

let ctx;
function measure(text) {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.font = BOARD_FONT;
    return ctx.measureText(text).width / 100; // em per glyph run
}

/**
 * One name size for the whole board, measured against the real font rather than
 * guessed from character counts.
 *
 * Sizing for the single longest name would drag every other name down with it,
 * so it sizes for the 82nd percentile: nearly everything fits on one line and
 * the two or three outliers hyphenate.
 */
export function useNameSize(tiles, available, max) {
    // Measurements taken before the webfont lands would be wrong, so redo them
    // once it's ready.
    const [fontsReady, setFontsReady] = useState(false);
    useEffect(() => {
        let alive = true;
        document.fonts?.ready.then(() => alive && setFontsReady(true));
        return () => {
            alive = false;
        };
    }, []);

    return useMemo(() => {
        if (!available) return 10;
        // A name can only break at a space, so its longest word sets the floor.
        const widths = tiles
            .map((t) => Math.max(...t.name.split(' ').map(measure)))
            .sort((a, b) => a - b);
        const target = widths[Math.floor((widths.length - 1) * FIT_PERCENTILE)] || 1;
        return Math.max(9, Math.min(available / target, max));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tiles, available, max, fontsReady]);
}
