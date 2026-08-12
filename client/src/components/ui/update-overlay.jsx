import { motion } from 'framer-motion';

/**
 * Covers everything while the page reloads onto a new build. Deliberately opaque
 * rather than a toast: the tab is about to disappear underneath whatever you
 * were doing, and a click landing on a board that's one second from reloading
 * is worse than a moment of nothing.
 */
export function UpdateOverlay() {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[#0b0b12]/95 backdrop-blur-sm"
        >
            <div className="flex items-center gap-3">
                <span className="size-2.5 animate-pulse rounded-full bg-primary" />
                <span className="text-xl font-medium">Updating the game</span>
            </div>
            <span className="text-[14px] text-muted-foreground">Back in a few seconds — your game is saved.</span>
        </motion.div>
    );
}
