import { AnimatePresence, motion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';

export function PauseOverlay() {
    const { state, send } = useGame();
    const by = state.players.find((p) => p.id === state.pausedBy);

    return (
        <AnimatePresence>
            {/* z-[55] sits above the modals (z-50) so a pause always wins */}
            {state.paused && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[55] flex flex-col items-center justify-center gap-6 bg-[#0e0e14]/82 backdrop-blur-md"
                >
                    <motion.div
                        initial={{ scale: 0.9 }}
                        animate={{ scale: 1 }}
                        className="flex size-20 items-center justify-center rounded-3xl bg-primary/15 text-primary shadow-[0_0_60px_rgba(124,92,255,.35)]"
                    >
                        <Pause className="size-9" />
                    </motion.div>
                    <div className="flex flex-col items-center gap-1.5">
                        <h2 className="text-3xl font-medium">Game paused</h2>
                        <span className="label">{by ? `${by.name} hit pause` : 'actions are frozen'}</span>
                    </div>
                    <Button className="h-11 px-6 text-base" onClick={() => send('game:pause')}>
                        <Play /> Resume
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
