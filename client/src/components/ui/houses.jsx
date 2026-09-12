/**
 * Houses and hotels, drawn rather than counted.
 *
 * Lived inside Tile until the sets panel needed the same picture: four little
 * silhouettes say "developed street" at a glance in a way "4" never does, and
 * two drawings of the same thing would eventually stop matching.
 *
 * Everything is in `em`, so one font size on the parent scales the lot — which
 * is how the board slot sizes them against itself.
 */

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
export function Houses({ houses }) {
    if (houses === 5) return <Building path={HOTEL} box={20} width="1em" height="0.55em" />;
    return (
        <span className="flex gap-[0.07em]">
            {Array.from({ length: houses }).map((_, i) => (
                <Building key={i} path={HOUSE} box={12} width="0.62em" height="0.57em" />
            ))}
        </span>
    );
}
