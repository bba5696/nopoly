import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** Pill switch used for the room's rule toggles. */
export function Toggle({ checked, onChange, disabled, className, label }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange?.(!checked)}
            className={cn(
                'relative flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                checked ? 'border-primary/60 bg-primary' : 'border-white/12 bg-white/[0.07]',
                className,
            )}
        >
            <motion.span
                layout
                transition={{ type: 'spring', stiffness: 700, damping: 40 }}
                className={cn(
                    'size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.5)]',
                    checked ? 'ml-auto mr-1' : 'ml-1',
                )}
            />
        </button>
    );
}

/** Compact stepper for the numeric room settings. */
export function NumberField({ value, onChange, disabled, min = 0, max = 9999, step = 1, suffix, className }) {
    const clamp = (n) => Math.min(Math.max(n, min), max);
    return (
        <div
            className={cn(
                'mono flex h-8 items-center rounded-lg border border-white/12 bg-black/25 text-[13px]',
                disabled && 'opacity-45',
                className,
            )}
        >
            <button
                type="button"
                disabled={disabled || value <= min}
                onClick={() => onChange(clamp(value - step))}
                className="h-full w-7 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
                −
            </button>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                disabled={disabled}
                onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) onChange(clamp(next));
                }}
                className="w-14 [appearance:textfield] bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            {suffix && <span className="pr-1 text-muted-foreground">{suffix}</span>}
            <button
                type="button"
                disabled={disabled || value >= max}
                onClick={() => onChange(clamp(value + step))}
                className="h-full w-7 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
                +
            </button>
        </div>
    );
}
