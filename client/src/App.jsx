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
import { Nouno } from '@/screens/Nouno';
import { SharedGame } from '@/screens/SharedGame';
import { sharedIdFromPath } from '@/lib/share-link';
import { Admin } from '@/screens/Admin';
import { isAdminPath } from '@/lib/admin';

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
    // The lobby and the end screen are shared; only the playing screen forks,
    // because that is the only one that is about the game rather than about
    // the room.
    if (state.phase === 'waiting') return <Lobby />;
    if (state.phase === 'ended') return <GameOver />;
    if (state.game === 'nouno') return <Nouno />;
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
    // The admin panel likewise: its own key, its own requests, and no seat.
    const [adminPage] = useState(() => isAdminPath());

    const open = useCallback(() => {
        setUnlocked(true);
        if (!socket.connected) socket.connect();
    }, []);

    useEffect(() => {
        // A shared page never opens a socket: it has nothing to say to the
        // server beyond the one fetch, and a connection would put a spectator
        // nobody invited into the presence count.
        if (sharedId || adminPage) return undefined;
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
    }, [open, sharedId, adminPage]);

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
    // Before the room password too. It is not a player's page, and the server
    // demands the admin token on every request it makes regardless.
    if (adminPage) return <Admin />;

    if (unlocked === null) return null;
    if (!unlocked) return <Gate onUnlocked={open} />;

    return (
        <GameProvider>
            <Notice />
            <Router />
        </GameProvider>
    );
}
