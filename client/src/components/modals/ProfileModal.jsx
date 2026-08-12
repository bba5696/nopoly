import { useState } from 'react';
import { Check } from 'lucide-react';

import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { alpha, initials } from '@/lib/color';
import { saveIdentity } from '@/lib/socket';

/**
 * Your initials and your colour.
 *
 * Both are yours alone — two people picking the same colour is allowed, and the
 * server pulls their shades apart afterwards rather than making it a race. So
 * there's nothing to reserve here and nothing to lose by being second.
 */
// Mounted only while open, so the draft is seeded once from what the server
// says and never has to be resynced — a live `me` would otherwise reset the
// field under the cursor on every broadcast.
export function ProfileModal({ onClose }) {
    const { state, playerId, send } = useGame();
    const me = state?.players.find((p) => p.id === playerId) || null;
    const palette = state?.playerColors || [];
    const locked = !!state && state.phase !== 'waiting';
    const teamColours = !!state?.settings?.teams;

    const [letters, setLetters] = useState(() => me?.initials || '');
    const [colour, setColour] = useState(() => me?.baseColor || null);

    if (!me) return null;

    const shown = letters || initials(me.name);
    const preview = colour || me.color;

    const save = () => {
        const patch = { initials: letters };
        if (!locked && !teamColours && colour) patch.color = colour;
        send('room:profile', patch);
        // Kept locally too, so it comes with you into the next room rather than
        // having to be set up again every game.
        saveIdentity({ initials: letters || null, color: patch.color ?? null });
        onClose();
    };

    return (
        <Modal open onClose={onClose} subtitle="Profile" title="How you look" width={420}>
            <div className="flex flex-col gap-5 p-5">
                <div className="flex items-center gap-4">
                    <span
                        className="mono flex size-14 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
                        style={{ background: `linear-gradient(160deg, ${preview}, ${alpha(preview, 0.65)})` }}
                    >
                        {shown}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <span className="label">Initials</span>
                        <input
                            value={letters}
                            onChange={(e) => setLetters(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase())}
                            placeholder={initials(me.name)}
                            className="mono h-11 w-full rounded-xl border border-input bg-black/25 px-3 text-lg tracking-[0.2em] outline-none placeholder:text-muted-foreground focus:border-primary/60"
                        />
                    </div>
                </div>
                <p className="-mt-2 text-[12px] leading-snug text-muted-foreground">
                    Up to three characters. Leave it empty to go back to your name.
                </p>

                <div className="flex flex-col gap-2.5">
                    <span className="label">Colour</span>
                    {teamColours ? (
                        <p className="text-[13px] leading-snug text-muted-foreground">
                            Teams are on — your colour comes from your team.
                        </p>
                    ) : locked ? (
                        <p className="text-[13px] leading-snug text-muted-foreground">
                            Locked once the game starts. The board reads ownership by colour, and moving yours
                            mid-game would change who it says owns what.
                        </p>
                    ) : (
                        <>
                            <div className="grid grid-cols-6 gap-2">
                                {palette.map((c) => {
                                    const active = c === colour;
                                    // Who else is already on it, so picking a
                                    // shared colour is a choice rather than a
                                    // surprise when the shades move.
                                    const sharers = state.players.filter(
                                        (p) => p.id !== playerId && p.baseColor === c,
                                    );
                                    return (
                                        <button
                                            key={c}
                                            type="button"
                                            onClick={() => setColour(c)}
                                            title={sharers.length ? `Also picked by ${sharers.map((p) => p.name).join(', ')}` : undefined}
                                            className="relative flex aspect-square items-center justify-center rounded-lg border transition-transform hover:scale-105"
                                            style={{
                                                background: alpha(c, active ? 0.95 : 0.75),
                                                borderColor: active ? '#fff' : 'transparent',
                                            }}
                                        >
                                            {active && <Check className="size-4 text-black/70" />}
                                            {!active && sharers.length > 0 && (
                                                <span className="mono text-[10px] text-black/60">
                                                    {sharers.length + 1}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[12px] leading-snug text-muted-foreground">
                                Share one if you like — anyone on the same colour gets a different shade of it.
                            </p>
                        </>
                    )}
                </div>

                <Button className="h-11" onClick={save}>
                    Save
                </Button>
            </div>
        </Modal>
    );
}
