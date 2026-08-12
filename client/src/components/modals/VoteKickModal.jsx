import { useEffect, useState } from 'react';
import { Check, Gavel, X } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { initials } from '@/lib/color';

/** Seconds left, ticking locally between broadcasts. */
function useCountdown(endsAt) {
    const [left, setLeft] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    useEffect(() => {
        const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
        tick();
        const t = setInterval(tick, 500);
        return () => clearInterval(t);
    }, [endsAt]);
    return left;
}

/**
 * Picker for starting a vote. Deliberately a separate modal rather than a
 * control on each rail row — the rows are already tap-to-pin, and a kick button
 * one pixel from that is a bad place to put a mis-tap.
 */
export function VoteKickPicker({ open, onClose }) {
    const { state, playerId, send } = useGame();
    const others = state.players.filter((p) => p.id !== playerId && !p.bankrupt);

    return (
        <Modal open={open} onClose={onClose} subtitle="Vote to remove" title="Kick a player" width={420}>
            <div className="flex flex-col gap-4 p-5">
                <p className="text-[13px] leading-snug text-muted-foreground">
                    Everyone still in the game votes. It needs a majority, and mid-game it's the same as resigning —
                    their property goes back to the bank and they can't rejoin.
                </p>
                <div className="flex flex-col gap-2">
                    {others.length === 0 && (
                        <span className="py-2 text-[13px] text-muted-foreground">Nobody else to vote on.</span>
                    )}
                    {others.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                                send('vote:start', { targetId: p.id });
                                onClose();
                            }}
                            className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2.5 text-left transition-colors hover:border-white/25"
                        >
                            <span
                                className="mono flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                                style={{ background: p.color }}
                            >
                                {initials(p.name)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[15px]">{p.name}</span>
                            <Gavel className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

/**
 * The running vote. Not dismissable for anyone who still has a say — a vote you
 * can click away is a vote that never resolves until the clock runs out. The
 * person on trial gets to watch, because finding out only when it lands is
 * worse.
 */
export function VoteKickModal() {
    const { state, playerId, send } = useGame();
    const vote = state.vote;
    const left = useCountdown(vote?.endsAt ?? 0);
    if (!vote) return null;

    const target = state.players.find((p) => p.id === vote.targetId);
    const me = state.players.find((p) => p.id === playerId);
    if (!target) return null;

    const isTarget = playerId === vote.targetId;
    const voted = vote.yes.includes(playerId) || vote.no.includes(playerId);
    const canVote = !isTarget && !voted && !!me && !me.bankrupt;

    return (
        <Modal
            open
            dismissable={false}
            subtitle={isTarget ? 'The table is voting' : 'Vote to remove'}
            title={isTarget ? 'You are being voted out' : `Kick ${target.name}?`}
            width={420}
        >
            <div className="flex flex-col gap-5 p-5">
                <div className="flex items-center justify-between">
                    <span className="mono text-[15px]">
                        <span style={{ color: '#3ddc97' }}>{vote.yes.length}</span>
                        <span className="text-muted-foreground"> / {vote.needed} needed</span>
                    </span>
                    <span className="mono text-[13px] text-muted-foreground">{left}s</span>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{
                            width: `${Math.min(100, (vote.yes.length / Math.max(vote.needed, 1)) * 100)}%`,
                            background: '#ff5c7c',
                        }}
                    />
                </div>

                {canVote ? (
                    <div className="flex gap-2">
                        <Button variant="destructive" className="h-11 flex-1" onClick={() => send('vote:cast', { agree: true })}>
                            <Check /> Kick
                        </Button>
                        <Button variant="outline" className="h-11 flex-1" onClick={() => send('vote:cast', { agree: false })}>
                            <X /> Keep
                        </Button>
                    </div>
                ) : (
                    <span className="text-center text-[13px] text-muted-foreground">
                        {isTarget
                            ? 'You cannot vote on your own removal.'
                            : voted
                              ? 'Vote cast — waiting on the others.'
                              : "You're out of the game, so you don't get a vote."}
                    </span>
                )}
            </div>
        </Modal>
    );
}
