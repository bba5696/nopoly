import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Scoreboard } from '@/components/Scoreboard';
import { fetchShare, timeLeft } from '@/lib/share-link';
import { stampOf } from '@/lib/history';

/**
 * Somebody else's finished game, opened from a link.
 *
 * Rendered outside the password gate and outside the game context: there is no
 * room to join and nothing to be a player in, and asking for a password to look
 * at a scoreboard somebody deliberately sent you would be theatre. The page
 * holds nothing but what the link carried.
 */
export function SharedGame({ id }) {
    const [state, setState] = useState({ loading: true });
    // Re-rendered each second so the countdown is honest rather than the number
    // it happened to be when the page opened.
    const [, tick] = useState(0);

    useEffect(() => {
        let live = true;
        fetchShare(id)
            .then((data) => live && setState(data.expired ? { expired: true } : { entry: data.entry, expiresAt: data.expiresAt }))
            .catch((err) => live && setState({ error: err.message }));
        return () => {
            live = false;
        };
    }, [id]);

    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, []);

    const gone = state.expired || (state.expiresAt && state.expiresAt <= Date.now());

    if (state.loading) {
        return <div className="flex min-h-svh items-center justify-center text-muted-foreground">Opening…</div>;
    }

    if (gone || state.error) {
        return (
            <div className="flex min-h-svh items-center justify-center p-6">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel flex max-w-[440px] flex-col items-center gap-3 p-10 text-center"
                >
                    <Clock className="size-7 text-muted-foreground/70" />
                    <span className="text-xl">{state.error || 'This link has expired'}</span>
                    <p className="text-[13px] leading-snug text-muted-foreground">
                        Shared games are held for an hour and then dropped — nothing is kept on the
                        server. Ask whoever sent it for a fresh link, or for the picture instead.
                    </p>
                    <Button variant="outline" className="mt-2" onClick={() => (location.href = '/')}>
                        Go to nopoly
                    </Button>
                </motion.div>
            </div>
        );
    }

    const entry = state.entry;

    return (
        <div className="flex min-h-svh flex-col items-center gap-5 p-6">
            <div className="flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                    <LinkIcon className="size-3.5 shrink-0" />
                    {/* The name it was given comes first: it is the only thing
                        on this page that says why it was sent to you. */}
                    {entry.nickname && <span className="truncate text-foreground">{entry.nickname}</span>}
                    <span className="shrink-0">
                        {entry.nickname ? '· ' : 'Shared game · '}expires in {timeLeft(state.expiresAt)}
                    </span>
                </span>
                <div className="flex items-center gap-3">
                    <span className="mono text-[12px] text-muted-foreground">{stampOf(entry.endedAt)}</span>
                    <Button variant="outline" size="sm" onClick={() => (location.href = '/')}>
                        Play nopoly
                    </Button>
                </div>
            </div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex w-full justify-center">
                <Scoreboard entry={entry} />
            </motion.div>
        </div>
    );
}
