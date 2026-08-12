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

/** Your standing in the running vote, which decides what you're shown. */
function useVoteRole() {
    const { state, playerId } = useGame();
    const vote = state.vote;
    if (!vote) return null;
    const target = state.players.find((p) => p.id === vote.targetId);
    if (!target) return null;
    const me = state.players.find((p) => p.id === playerId);
    const isTarget = playerId === vote.targetId;
    const voted = vote.yes.includes(playerId) || vote.no.includes(playerId);
    return { vote, target, isTarget, voted, canVote: !isTarget && !voted && !!me && !me.bankrupt };
}

/**
 * The ballot. Only ever shown to someone who still has a decision to make, and
 * it closes the instant they've made it.
 *
 * It blocks the board on purpose while it's up — a vote you can click away is a
 * vote that hangs until the clock runs out. But once you've voted there's
 * nothing left to decide, so keeping it up is pure obstruction; the tally moves
 * to the header instead and the game carries on.
 */
export function VoteKickModal() {
    const { send } = useGame();
    const role = useVoteRole();
    const left = useCountdown(role?.vote.endsAt ?? 0);
    if (!role?.canVote) return null;
    const { vote, target } = role;

    return (
        <Modal open dismissable={false} subtitle="Vote to remove" title={`Kick ${target.name}?`} width={420}>
            <div className="flex flex-col gap-5 p-5">
                <div className="flex items-center justify-between">
                    <span className="mono text-[15px]">
                        <span style={{ color: '#3ddc97' }}>{vote.yes.length}</span>
                        <span className="text-muted-foreground"> / {vote.needed} needed</span>
                    </span>
                    <span className="mono text-[13px] text-muted-foreground">{left}s</span>
                </div>

                <div className="flex gap-2">
                    <Button variant="destructive" className="h-11 flex-1" onClick={() => send('vote:cast', { agree: true })}>
                        <Check /> Kick
                    </Button>
                    <Button variant="outline" className="h-11 flex-1" onClick={() => send('vote:cast', { agree: false })}>
                        <X /> Keep
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

/**
 * The tally, once you have nothing left to do about it — you've voted, you're
 * the one on trial, or you're out and don't get a say. Lives in the header
 * beside the room code so the board stays clear and playable.
 */
export function VoteStatusChip() {
    const role = useVoteRole();
    const left = useCountdown(role?.vote.endsAt ?? 0);
    if (!role || role.canVote) return null;
    const { vote, target, isTarget } = role;
    const pct = Math.min(100, (vote.yes.length / Math.max(vote.needed, 1)) * 100);

    return (
        <span
            className="relative flex items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5"
            style={{ borderColor: 'rgba(255,92,124,.4)', background: 'rgba(255,92,124,.08)' }}
            title={isTarget ? 'The table is voting on you' : `Vote to kick ${target.name}`}
        >
            {/* Fills toward the threshold, so the state is readable without
                stopping to parse the numbers. */}
            <span
                className="absolute inset-y-0 left-0 transition-[width] duration-300"
                style={{ width: `${pct}%`, background: 'rgba(255,92,124,.18)' }}
            />
            <Gavel className="relative size-3.5 shrink-0 text-[#ff9db2]" />
            {/* The name is the first thing to go on a phone — the header is
                already carrying the room code and the bankrupt button, and the
                tally is what you're actually watching. */}
            <span className="mono relative hidden max-w-[7em] truncate text-[12px] text-[#ff9db2] sm:inline">
                {isTarget ? 'you' : target.name}
            </span>
            <span className="mono relative text-[12px] text-[#ff9db2]">
                {vote.yes.length}/{vote.needed}
            </span>
            <span className="mono relative text-[11px] text-muted-foreground">{left}s</span>
        </span>
    );
}
