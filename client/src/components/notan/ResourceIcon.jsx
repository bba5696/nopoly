import { LOOK } from '@/lib/notan';

/**
 * The island's resources as line icons, drawn in the same 24-unit grid and
 * stroke as the lucide icons the rest of the site uses, so a sheep sits next
 * to a chat bubble without looking like it came from somewhere else.
 *
 * An <svg> either way: in HTML it is an inline icon, and inside the board's own
 * SVG it nests, placed with `x` and `y`.
 */
const SHAPES = {
    brick: (
        <>
            <rect x="3" y="5" width="18" height="14" rx="1.5" />
            <path d="M3 12h18M9 5v7M15 12v7" />
        </>
    ),
    lumber: (
        <>
            <path d="M12 3 6.5 10.5h3L5.5 16h13l-4-5.5h3L12 3Z" />
            <path d="M12 16v5" />
        </>
    ),
    wool: (
        <>
            <path d="M10.5 16.5a2 2 0 0 1-1.9-2.9 2 2 0 0 1 .6-3.7 2.2 2.2 0 0 1 3.7-1.8 2.2 2.2 0 0 1 3.9.1 2.2 2.2 0 0 1 3.3 2.4 2 2 0 0 1 .2 3.6 2 2 0 0 1-2.3 2.3h-7.5Z" />
            <ellipse cx="6" cy="10.5" rx="2.4" ry="2.9" transform="rotate(-25 6 10.5)" />
            <path d="M4.2 8.2 2.6 7.4M11.5 16.5v3.5M17 16.5v3.5" />
        </>
    ),
    grain: (
        <>
            <path d="M12 21V8" />
            <path d="M12 12c-2.6 0-4-1.4-4-4 2.6 0 4 1.4 4 4ZM12 12c2.6 0 4-1.4 4-4-2.6 0-4 1.4-4 4Z" />
            <path d="M12 17c-2.6 0-4-1.4-4-4 2.6 0 4 1.4 4 4ZM12 17c2.6 0 4-1.4 4-4-2.6 0-4 1.4-4 4Z" />
            <path d="M12 8c-1.2-1.4-1.2-3.4 0-5 1.2 1.6 1.2 3.6 0 5Z" />
        </>
    ),
    ore: (
        <>
            <path d="M2.5 20 9.5 7l4 7 2.5-4 5.5 10h-19Z" />
            <path d="m7.6 10.5 1.9-3.5 1.9 3.5" />
        </>
    ),
    desert: (
        <>
            <circle cx="12" cy="10" r="3.5" />
            <path d="M12 3v1.5M5 10H3.5M20.5 10H19M7 5l1 1M17 5l-1 1M3 19c3-2 6-2 9 0s6 2 9 0" />
        </>
    ),
    any: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.4M12 17h.01" />
        </>
    ),
};

export function ResourceIcon({ kind, size = 18, color, x, y, strokeWidth = 2, className }) {
    return (
        <svg
            x={x}
            y={y}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || LOOK[kind]?.fill || 'currentColor'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-label={LOOK[kind]?.name}
            role="img"
            style={{ pointerEvents: 'none', flexShrink: 0 }}
        >
            {SHAPES[kind] || SHAPES.any}
        </svg>
    );
}
