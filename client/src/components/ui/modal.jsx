import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, width = 460, children, dismissable = true }) {
    useEffect(() => {
        if (!open || !dismissable) return;
        const onKey = (e) => e.key === 'Escape' && onClose?.();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose, dismissable]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
                    onClick={() => dismissable && onClose?.()}
                >
                    <motion.div
                        initial={{ opacity: 0, y: 18, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '100%', maxWidth: width }}
                        className="panel relative max-h-[90vh] overflow-hidden"
                    >
                        {title ? (
                            <header className="panel-divider flex items-center justify-between gap-3 px-5 py-4">
                                <div className="flex flex-col gap-0.5">
                                    {subtitle && <span className="label">{subtitle}</span>}
                                    <h2 className="text-xl font-medium">{title}</h2>
                                </div>
                                {dismissable && (
                                    <button
                                        onClick={onClose}
                                        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                        <X className="size-4" />
                                    </button>
                                )}
                            </header>
                        ) : (
                            // No title: the child owns the whole surface, so the
                            // close control floats instead of taking a header row.
                            dismissable && (
                                <button
                                    onClick={onClose}
                                    className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/35 text-white/70 backdrop-blur-sm transition-colors hover:text-white"
                                >
                                    <X className="size-4" />
                                </button>
                            )
                        )}
                        <div className="scroll-thin max-h-[calc(90vh-72px)] overflow-y-auto">{children}</div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
