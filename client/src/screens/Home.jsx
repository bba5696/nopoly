import { useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, History, Pencil, Scale, Volume2 } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { BuildTag } from '@/components/ui/build-tag';
import { PresencePill } from '@/components/ui/presence';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { loadIdentity } from '@/lib/socket';
import { alpha, initials } from '@/lib/color';
import { historyCount } from '@/lib/history';
import { PastGames } from '@/screens/PastGames';

export function Home() {
    const { createRoom, joinRoom, spectate, joining, connected } = useGame();
    // Re-read when the editor closes rather than held as a snapshot, or the
    // preview keeps showing what you had before you changed it.
    const [saved, setSaved] = useState(() => loadIdentity());
    const [name, setName] = useState(saved.name || '');
    const [code, setCode] = useState('');
    const [profileOpen, setProfileOpen] = useState(false);
    // Why the join was refused, when watching is still on the table.
    const [watchOffer, setWatchOffer] = useState(null);
    // Games finished on this device. Counted once on mount: the list is only
    // written to when a game ends, which cannot happen while this screen is up.
    const [pastOpen, setPastOpen] = useState(false);
    const [pastCount] = useState(() => historyCount());

    const trimmed = name.trim();
    const ready = trimmed.length > 0 && connected && !joining;

    // A screen rather than a modal: it holds a whole end screen inside it,
    // and a modal that big is a screen wearing a costume.
    if (pastOpen) return <PastGames onClose={() => setPastOpen(false)} />;

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel flex w-full max-w-[520px] flex-col gap-8 p-10"
            >
                <header className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2.5">
                        <span className="text-4xl font-medium tracking-tight">nopoly</span>
                        <span className="label">beta</span>
                    </div>
                    <PresencePill />
                </header>

                <div className="flex flex-col gap-3">
                    <span className="label">Your name</span>
                    <div className="flex items-center gap-3">
                        {/* Doubles as the way into the profile — the thing it
                            previews is the thing it edits, so there's nowhere
                            else the control would belong. */}
                        <button
                            type="button"
                            title="Change your initials and colour"
                            onClick={() => setProfileOpen(true)}
                            className="mono relative flex size-13 shrink-0 items-center justify-center rounded-full border border-white/10 text-sm font-semibold transition-transform hover:scale-105"
                            style={{
                                width: 52,
                                height: 52,
                                // Your colour once you've picked one; the old
                                // faint primary tint until then.
                                background: saved.color
                                    ? `linear-gradient(160deg, ${saved.color}, ${alpha(saved.color, 0.65)})`
                                    : 'color-mix(in oklab, var(--primary) 15%, transparent)',
                                color: saved.color ? '#fff' : 'var(--primary)',
                            }}
                        >
                            {/* Whatever you last set, so the preview matches
                                what the table will actually see. */}
                            {saved.initials || (trimmed ? initials(trimmed) : '··')}
                            <Pencil className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-background p-0.5 text-muted-foreground" />
                        </button>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value.slice(0, 16))}
                            placeholder="type a nickname…"
                            className="h-13 min-w-0 flex-1 rounded-xl border border-input bg-black/25 px-4 text-lg outline-none placeholder:text-muted-foreground focus:border-primary/60"
                            style={{ height: 52 }}
                        />
                    </div>
                </div>

                <div className="flex flex-col gap-3.5">
                    <Button className="h-14 text-lg" disabled={!ready} onClick={() => createRoom(trimmed)}>
                        Create a game
                    </Button>
                    <form
                        className="flex gap-3"
                        onSubmit={async (e) => {
                            e.preventDefault();
                            if (!ready || !code.trim()) return;
                            const res = await joinRoom(code, trimmed);
                            // No seat going, but the room will still have us.
                            if (res?.canSpectate) setWatchOffer(res.reason || res.error);
                        }}
                    >
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                            placeholder="room code"
                            className="mono h-13 min-w-0 flex-1 rounded-xl border border-dashed border-input bg-black/25 px-4 text-lg tracking-[0.25em] outline-none placeholder:tracking-normal placeholder:text-muted-foreground focus:border-primary/60"
                            style={{ height: 52 }}
                        />
                        <Button type="submit" variant="outline" className="w-28 text-base" style={{ height: 52 }} disabled={!ready || !code.trim()}>
                            Join
                        </Button>
                    </form>
                </div>

                <div className="flex flex-col gap-2 border-t border-white/8 pt-5">
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                        Rooms are private — share the 5-character code with your friends. No player cap, no paywalls.
                    </p>
                    {/* Plain anchors, not routes: both are their own pages
                        outside the app, so they must reload rather than be
                        handled in front of the router that doesn't exist. */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <a
                            href="/sounds.html"
                            className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <Volume2 className="size-3.5" /> Hear the sounds
                        </a>
                        {pastCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setPastOpen(true)}
                                className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <History className="size-3.5" /> Past games ({pastCount})
                            </button>
                        )}
                        <a
                            href="/legal.html"
                            className="flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <Scale className="size-3.5" /> Terms &amp; privacy
                        </a>
                    </div>
                    <p className="text-[12px] leading-relaxed text-muted-foreground/70">
                        By playing you agree to the{' '}
                        <a href="/legal.html" className="underline underline-offset-2 hover:text-foreground">
                            terms
                        </a>
                        . You must be 13 or older. Chat is visible to everyone in your room.
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {/* New tab, deliberately: the socket is already open by
                            the time anyone reads this, and navigating away to
                            look at a profile would drop it. */}
                        <a
                            href="https://github.com/bba5696"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mono text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground"
                        >
                            made by @bba5696
                        </a>
                        <span className="text-[11px] text-muted-foreground/40">·</span>
                        <BuildTag />
                    </div>
                </div>
            </motion.div>
            {/* Offered rather than assumed: watching a game you meant to play
                in is a different evening, and being dropped into it silently
                would read as the join having half-worked. */}
            <Modal
                open={!!watchOffer}
                onClose={() => setWatchOffer(null)}
                subtitle="No seat available"
                title={watchOffer || ''}
                width={400}
            >
                <div className="flex flex-col gap-5 p-5">
                    <p className="text-[14px] leading-relaxed text-muted-foreground">
                        You can still watch {code.trim().toUpperCase()} — the board, the money and the history, live.
                        You won't have a turn, and you can leave whenever you like.
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" className="h-11 flex-1" onClick={() => setWatchOffer(null)}>
                            Never mind
                        </Button>
                        <Button
                            className="h-11 flex-1"
                            disabled={joining}
                            onClick={() => {
                                spectate(code, trimmed);
                                setWatchOffer(null);
                            }}
                        >
                            <Eye /> Watch
                        </Button>
                    </div>
                </div>
            </Modal>

            {profileOpen && (
                <ProfileModal
                    fallbackName={trimmed}
                    onClose={() => {
                        setProfileOpen(false);
                        setSaved(loadIdentity());
                    }}
                />
            )}
        </div>
    );
}
