/** #rrggbb -> rgba() string at the given alpha. */
export function alpha(hex, a) {
    const h = (hex || '#ffffff').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();

/**
 * What goes in someone's token. Their own initials if they set any, otherwise
 * the first letters of their name — which is what everybody had before the
 * profile existed and what most people will leave it as.
 */
export const tag = (player) => player?.initials || initials(player?.name);
