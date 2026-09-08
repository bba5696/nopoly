import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GameProvider, useGame } from '@/lib/game-context';
import { authRequired, clearToken, loadToken, socket } from '@/lib/socket';
import { useLiveUpdate } from '@/lib/use-live-update';
import { UpdateOverlay } from '@/components/ui/update-overlay';
import { Gate } from '@/screens/Gate';
import { Home } from '@/screens/Home';
import { Lobby } from '@/screens/Lobby';
import { Game } from '@/screens/Game';
import { GameOver } from '@/screens/GameOver';
import { SharedGame } from '@/screens/SharedGame';
import { sharedIdFromPath } from '@/lib/share-link';

function Notice() {
    const { notice } = useGame();
    return (
        <AnimatePresence>
            {notice && (
                <motion.div
                    key={notice.at}
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="panel fixed left-1/2 top-4 z-[60] -translate-x-1/2 px-4 py-2.5 text-[14px]"
                    style={{ borderColor: 'rgba(255,92,124,.5)' }}
                >
                    {notice.text}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function Router() {
    const { state } = useGame();
    if (!state) return <Home />;
    if (state.phase === 'waiting') return <Lobby />;
    if (state.phase === 'ended') return <GameOver />;
    return <Game />;
}

/**
 * Holds everything behind the password until there's a token the server will
 * accept, then connects the socket. Nothing renders in the meantime — a flash
 * of the game before the gate would look like a way in.
 */
export default function App() {
    const [unlocked, setUnlocked] = useState(null); // null = still deciding
    // A shared end screen is its own page: no socket, no room, and no gate.
    // Read once, because nothing in the app navigates to or away from it.
    const [sharedId] = useState(() => sharedIdFromPath());

    const open = useCallback(() => {
        setUnlocked(true);
        if (!socket.connected) socket.connect();
    }, []);

    useEffect(() => {
        // A shared page never opens a socket: it has nothing to say to the
        // server beyond the one fetch, and a connection would put a spectator
        // nobody invited into the presence count.
        if (sharedId) return undefined;
        let live = true;
        (async () => {
            const required = await authRequired();
            if (!live) return;
            if (!required || loadToken()) open();
            else setUnlocked(false);
        })();
        return () => {
            live = false;
        };
    }, [open, sharedId]);

    // A stale or revoked token is rejected at the handshake — drop it and put
    // the gate back rather than retrying forever.
    useEffect(() => {
        const onError = (err) => {
            if (err?.message !== 'unauthorized') return;
            clearToken();
            socket.disconnect();
            setUnlocked(false);
        };
        socket.on('connect_error', onError);
        return () => socket.off('connect_error', onError);
    }, []);

    // Outside the gate check, so a tab sitting on the login screen also picks
    // up a new build rather than logging in against a stale one.
    const updating = useLiveUpdate();
    if (updating) return <UpdateOverlay />;

    // Before the gate on purpose: whoever holds the link was sent it, and
    // asking them for the room password to look at a scoreboard would be
    // theatre. Nothing on this page can join, chat or play.
    if (sharedId) return <SharedGame id={sharedId} />;

    if (unlocked === null) return null;
    if (!unlocked) return <Gate onUnlocked={open} />;

    return (
        <GameProvider>
            <Notice />
            <Router />
        </GameProvider>
    );
}
