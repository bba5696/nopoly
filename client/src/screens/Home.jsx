import { useState } from 'react';
import { motion } from 'framer-motion';
import { Pencil } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { BuildTag } from '@/components/ui/build-tag';
import { PresencePill } from '@/components/ui/presence';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { loadIdentity } from '@/lib/socket';
import { alpha, initials } from '@/lib/color';

export function Home() {
    const { createRoom, joinRoom, joining, connected } = useGame();
    // Re-read when the editor closes rather than held as a snapshot, or the
    // preview keeps showing what you had before you changed it.
    const [saved, setSaved] = useState(() => loadIdentity());
    const [name, setName] = useState(saved.name || '');
    const [code, setCode] = useState('');
    const [profileOpen, setProfileOpen] = useState(false);

    const trimmed = name.trim();
    const ready = trimmed.length > 0 && connected && !joining;

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
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (ready && code.trim()) joinRoom(code, trimmed);
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
                    <BuildTag />
                </div>
            </motion.div>
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
