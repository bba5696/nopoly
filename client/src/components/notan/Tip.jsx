import { cn } from '@/lib/utils';

/**
 * A short line about whatever is under the pointer, in the site's own panel
 * rather than the browser's slow grey title box. Pure CSS — it shows on hover
 * and on keyboard focus, and costs nothing when nobody is looking.
 */
export function Tip({ text, children, side = 'top', className }) {
    if (!text) return children;
    return (
        <span className={cn('group/tip relative inline-flex', className)}>
            {children}
            <span
                role="tooltip"
                className={cn(
                    'panel pointer-events-none absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 px-2.5 py-1.5 text-left text-[12px] leading-snug font-normal text-foreground normal-case tracking-normal opacity-0 transition-opacity delay-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100',
                    side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
                )}
            >
                {text}
            </span>
        </span>
    );
}
