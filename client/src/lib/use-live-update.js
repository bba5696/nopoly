import { useEffect, useRef, useState } from 'react';
import { SERVER_URL } from './socket';

/** How often to ask whether a new build has landed. */
const POLL_MS = 20_000;
/** Long enough to read "updating", short enough not to feel like a hang. */
const GRACE_MS = 1800;

/**
 * The hashed bundle this page is actually running, read off its own script tag.
 *
 * This has to come from the DOM rather than from the first poll. The first poll
 * can happen well after load — the tab may have started backgrounded, or
 * offline — and by then the answer may already be the *new* version, which
 * would quietly adopt it as the baseline and leave the tab on stale code
 * forever. The script tag can't be wrong about what it loaded.
 *
 * Null under `vite dev`, where there is no hashed bundle.
 */
function loadedBundle() {
    for (const el of document.querySelectorAll('script[src]')) {
        const match = el.getAttribute('src').match(/assets\/index-[A-Za-z0-9_-]+\.js/);
        if (match) return match[0];
    }
    return null;
}

/**
 * Notices when a new build has been deployed and reloads the page onto it.
 *
 * The server's /version is the hashed bundle name from the built index.html, so
 * it changes on exactly the deploys that need a reload and on no others.
 *
 * Reloading is safe mid-game: the room lives on the server, the seat is held by
 * the id in localStorage, and the client rejoins on connect. Returns true while
 * the overlay should be up.
 */
export function useLiveUpdate() {
    const [updating, setUpdating] = useState(false);
    const baseline = useRef(loadedBundle());

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            if (cancelled || document.hidden) return;
            let version;
            try {
                const res = await fetch(`${SERVER_URL}/version`, { cache: 'no-store' });
                if (!res.ok) return;
                ({ version } = await res.json());
            } catch {
                // Offline, or the server is mid-restart — both resolve on their
                // own, and a failed poll must never trigger a reload loop.
                return;
            }
            if (cancelled || !version || version === 'dev') return;
            // No hashed bundle to compare against — a dev server. Nothing to do.
            if (baseline.current === null) return;
            if (version === baseline.current) return;
            setUpdating(true);
            setTimeout(() => window.location.reload(), GRACE_MS);
        };

        check();
        const timer = setInterval(check, POLL_MS);
        // Coming back to a backgrounded tab is the most likely moment to be on
        // a stale build, and polling is paused while hidden.
        document.addEventListener('visibilitychange', check);
        // A reconnect usually means the server just restarted — exactly when a
        // new version is most likely, and sooner than the next poll.
        window.addEventListener('online', check);

        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', check);
            window.removeEventListener('online', check);
        };
    }, []);

    return updating;
}
