import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Scoreboard } from '@/components/Scoreboard';
import { entryFromState, saveEntry } from '@/lib/history';

export function GameOver() {
    const { state, isHost, send, leaveRoom, flash } = useGame();

    // The same record the history keeps, so the screen you are looking at now
    // and the one you open next week are drawn from identical numbers.
    const entry = useMemo(() => entryFromState(state), [state]);

    // Kept the moment the game ends, without being asked. A souvenir nobody
    // opted into costs nothing and lives only in this browser; being asked to
    // save it is a decision at exactly the moment nobody wants one.
    const saved = useRef(null);
    useEffect(() => {
        if (saved.current === entry.id) return;
        saved.current = entry.id;
        saveEntry(entry);
    }, [entry]);

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full max-w-[1120px] flex-col items-center gap-5"
            >
                <Scoreboard entry={entry} flash={flash} />
                <div className="flex w-full max-w-[1120px] flex-col gap-2">
                    <div className="flex gap-3">
                        <Button
                            className="h-13 flex-1 text-base"
                            style={{ height: 52 }}
                            disabled={!isHost}
                            onClick={() => send('game:rematch')}
                        >
                            Another game
                        </Button>
                        <Button
                            variant="outline"
                            className="flex-1 text-base"
                            style={{ height: 52 }}
                            onClick={leaveRoom}
                        >
                            Back to home
                        </Button>
                    </div>
                    <span className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
                        <History className="size-3.5" /> Saved to your past games — find it from the home screen
                    </span>
                </div>
            </motion.div>
        </div>
    );
}
