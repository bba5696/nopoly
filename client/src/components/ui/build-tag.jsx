/* global __BUILD__ */
// Which build this device is actually running. Worth showing plainly: the
// hashed bundles are cached for a year, so when someone says "the fix didn't
// work", the first thing to establish is whether their browser ever picked it
// up. `__BUILD__` is stamped in by vite.config.js.

const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: '0.0.0', commit: 'dev', builtAt: null };

/** "11 Aug 2026" — a date a player can compare against "when did you deploy?". */
function builtOn() {
    if (!BUILD.builtAt) return 'dev';
    return new Date(BUILD.builtAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

export const buildLabel = `v${BUILD.version} · ${BUILD.commit} · ${builtOn()}`;

export function BuildTag({ className = '' }) {
    return (
        <span
            className={`mono text-[11px] text-muted-foreground/70 ${className}`}
            // The exact timestamp is for the person debugging, not the player.
            title={BUILD.builtAt ? `Built ${new Date(BUILD.builtAt).toLocaleString()}` : 'Development build'}
        >
            {buildLabel}
        </span>
    );
}
