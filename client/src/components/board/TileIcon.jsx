/**
 * Hand-drawn icons for the slots that aren't properties. Emoji were doing this
 * job before, but they render differently on every platform and sit oddly
 * against the board's palette — these are filled SVGs in the board's own
 * colours, each with a matching glow, and they scale off font-size.
 */

import { iconKindFor } from '@/lib/tile-icon-kind';

const ICONS = {
    chance: {
        glow: '#ff5c9a',
        paths: (
            <>
                <path
                    d="M8.6 8.7a3.6 3.6 0 1 1 4.9 3.35c-.9.36-1.5 1.2-1.5 2.15v.75"
                    fill="none"
                    stroke="#ff5c9a"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                <circle cx="12" cy="19" r="1.9" fill="#ff5c9a" />
            </>
        ),
    },
    exchange: {
        glow: '#3ddc97',
        paths: (
            <>
                {/* Three candles and the line through them. */}
                <rect x="4.2" y="12.4" width="3.1" height="6.6" rx="1" fill="#2fae7a" />
                <rect x="10.4" y="9.2" width="3.1" height="9.8" rx="1" fill="#3ddc97" />
                <rect x="16.6" y="5.4" width="3.1" height="13.6" rx="1" fill="#7ef0bd" />
                <path
                    d="M4.6 11.2 11 8.1l6.2-3.6"
                    fill="none"
                    stroke="#7ef0bd"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </>
        ),
    },
    chest: {
        glow: '#ffa23a',
        paths: (
            <>
                <path d="M3.4 11.4a8.6 8.6 0 0 1 17.2 0v.5H3.4z" fill="#ffb454" />
                <rect x="3.4" y="11.9" width="17.2" height="7.9" rx="1.4" fill="#ef8c1c" />
                <rect x="3.4" y="11.4" width="17.2" height="1.4" fill="#c96a10" />
                <rect x="10.1" y="8.4" width="3.8" height="11.4" fill="#c96a10" />
                <rect x="10.8" y="13.3" width="2.4" height="3.2" rx="1.2" fill="#ffe0b0" />
            </>
        ),
    },
    incomeTax: {
        glow: '#98a4cc',
        paths: (
            <>
                <path
                    d="M6.2 3h11.6a1 1 0 0 1 1 1v16.2l-2.6-1.5-2.6 1.5-2.6-1.5-2.6 1.5L5.2 19V4a1 1 0 0 1 1-1z"
                    fill="#98a4cc"
                />
                <rect x="8.3" y="7" width="7.4" height="1.7" rx=".85" fill="#12121a" />
                <rect x="8.3" y="10.5" width="7.4" height="1.7" rx=".85" fill="#12121a" />
                <rect x="8.3" y="14" width="4.6" height="1.7" rx=".85" fill="#12121a" />
            </>
        ),
    },
    luxuryTax: {
        glow: '#5ad2f5',
        paths: (
            <>
                <path d="M7.4 3.2h9.2l4.2 5.6L12 20.9 3.2 8.8z" fill="#5ad2f5" />
                <path d="M3.2 8.8h17.6L16.6 3.2H7.4z" fill="#a8ebff" />
                <path d="M12 20.9 7.4 3.2h9.2z" fill="#7fdff8" opacity=".45" />
            </>
        ),
    },
    airport: {
        glow: '#8fd0ff',
        paths: (
            <path
                d="M12 2.2c.75 0 1.35.6 1.35 1.35v5.1l7.4 4.35v1.9l-7.4-2.35v4.1l2.1 1.55v1.5L12 18.6l-3.45 1.1v-1.5l2.1-1.55v-4.1L3.25 14.9v-1.9l7.4-4.35v-5.1c0-.75.6-1.35 1.35-1.35z"
                fill="#8fd0ff"
            />
        ),
    },
    electric: {
        glow: '#ffd23a',
        paths: <path d="M13.7 2.4 5.8 13.3h5.1l-1.5 8.3 8.4-11.2h-5.4z" fill="#ffd23a" />,
    },
    water: {
        glow: '#4cc9f0',
        paths: (
            <>
                <path
                    d="M12 2.6c4.2 4.6 6.4 7.9 6.4 10.7A6.4 6.4 0 0 1 12 19.7a6.4 6.4 0 0 1-6.4-6.4c0-2.8 2.2-6.1 6.4-10.7z"
                    fill="#4cc9f0"
                />
                <path
                    d="M9.2 13.5a2.8 2.8 0 0 0 2.8 2.8"
                    fill="none"
                    stroke="#c8f2ff"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                />
            </>
        ),
    },
    gas: {
        glow: '#ff9f45',
        paths: (
            <>
                <path
                    d="M12.6 2.4c.5 3 2 4.2 3.5 5.9a7.4 7.4 0 0 1 2 5 6.1 6.1 0 0 1-12.2 0c0-2.4 1.3-4 2.5-5.3.3 1 .9 1.7 1.7 2 .3-3 1.4-5.6 2.5-7.6z"
                    fill="#ff9f45"
                />
                <path
                    d="M12 12.4c1.4 1.6 2.2 2.7 2.2 3.9a2.2 2.2 0 0 1-4.4 0c0-1.2.8-2.3 2.2-3.9z"
                    fill="#ffe0a8"
                />
            </>
        ),
    },
    vacation: {
        glow: '#3ddc97',
        paths: (
            <>
                <circle cx="6.4" cy="6.2" r="2.9" fill="#ffd23a" />
                <g fill="none" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M13.9 20.9c-.35-4.9.15-8.1 1.5-10.3" stroke="#c98a4b" />
                    <path d="M15.4 10.6c-2.7-1.5-5.2-1-6.9 1.3" stroke="#3ddc97" />
                    <path d="M15.4 10.6c3-.7 5.3.6 6.3 2.9" stroke="#3ddc97" />
                    <path d="M15.4 10.6c-.7-2.9.4-4.9 2.6-6" stroke="#3ddc97" />
                </g>
            </>
        ),
    },
    goToJail: {
        glow: '#ff6b6b',
        paths: (
            <g fill="none" stroke="#ff6b6b" strokeWidth="2.3" strokeLinecap="round">
                <circle cx="7.6" cy="15.5" r="4.3" />
                <circle cx="16.4" cy="15.5" r="4.3" />
                <path d="M9.5 11.7 10.8 8.2M14.5 11.7 13.2 8.2M10.3 6.7h3.4" />
            </g>
        ),
    },
};

export function TileIcon({ tile, kind, className, style, glow = true }) {
    const key = kind || (tile && iconKindFor(tile));
    const icon = key && ICONS[key];
    if (!icon) return null;
    return (
        <svg
            viewBox="0 0 24 24"
            width="1em"
            height="1em"
            aria-hidden="true"
            className={className}
            style={{ filter: glow ? `drop-shadow(0 0 0.22em ${icon.glow}88)` : undefined, ...style }}
        >
            {icon.paths}
        </svg>
    );
}
