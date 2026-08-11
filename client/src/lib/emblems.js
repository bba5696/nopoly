// Country flags for the property slots.
//
// Real images served from `public/flags/`, pulled once from flagcdn.com (free,
// no key — https://flagcdn.com/w80/<iso2>.png) and vendored so the board has no
// third-party runtime dependency and works offline. Emoji flags are
// deliberately avoided: Windows has no flag glyphs and renders 🇧🇷 as "BR".
//
// To add a country: download https://flagcdn.com/w80/<iso2>.png into
// public/flags/<groupId>.png and add it below.
//
// Everything that isn't a property draws an SVG instead — see
// components/board/TileIcon.jsx.

export const FLAG_SRC = {
    brazil: '/flags/brazil.png',
    palestine: '/flags/palestine.png',
    bangladesh: '/flags/bangladesh.png',
    italy: '/flags/italy.png',
    germany: '/flags/germany.png',
    china: '/flags/china.png',
    france: '/flags/france.png',
    japan: '/flags/japan.png',
    uk: '/flags/uk.png',
    usa: '/flags/usa.png',
};

/** Flag image for a property slot, or undefined for everything else. */
export function flagFor(tile) {
    return tile.type === 'property' ? FLAG_SRC[tile.groupId] : undefined;
}
