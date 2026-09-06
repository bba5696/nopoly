import { useEffect, useState } from 'react';
import { Check, Clock, Gavel, WifiOff, X } from 'lucide-react';

import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { tag } from '@/lib/color';

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
 * The wall clock as something that changes, since every cooldown here is a
 * deadline and a deadline read once at render is stale the moment it's drawn.
 * Only runs while the picker is open — nothing else on screen needs the tick.
 */
function useNow(active) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return undefined;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [active]);
    return now;
}

/** Bare seconds up to a minute, then m:ss — five minutes as "287s" reads as noise. */
const clock = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Whole minutes, rounded up — any wait at all reads as "1 min", never "0". */
const mins = (ms) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * Whether the turn clock has recently had to play for them, which mid-game is
 * the only thing a vote can be called about. The same rule as the server's, off
 * the same two numbers, so the picker can't offer a vote that would be refused.
 */
const stalling = (p, state, now) => !!p.lastStallAt && now - p.lastStallAt < (state.stallWindowMs || 0);

/** Names for a list of player ids, for the places a vote has to name people. */
const names = (ids, state) =>
    ids
        .map((id) => state.players.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ');

/**
 * Picker for starting a vote. Deliberately a separate modal rather than a
 * control on each rail row — the rows are already tap-to-pin, and a kick button
 * one pixel from that is a bad place to put a mis-tap.
 */
export function VoteKickPicker({ open, onClose }) {
    const { state, playerId, send } = useGame();
    const now = useNow(open);
    const others = state.players.filter((p) => p.id !== playerId && !p.bankrupt);
    // The server decides every one of these; the picker only mirrors them, so
    // that a name you can't vote on says why rather than failing when pressed.
    const opens = state.voteOpensAt || 0;
    const tooEarly = opens > now;
    const mine = state.callerCooldown?.[playerId] || 0;
    const yours = mine > now ? mins(mine - now) : 0;
    const inLobby = state.phase === 'waiting';

    /** Why this player can't be voted on, or null if they can. */
    const blocked = (p) => {
        // Someone who has dropped out is never a ballot — it's a countdown,
        // and none of the rules below apply to it.
        if (!p.connected) return null;
        if (yours) return `you called the last vote · ${yours} min`;
        if (tooEarly) return `kicking opens in ${mins(opens - now)} min`;
        const until = state.voteCooldown?.[p.id] || 0;
        if (until > now) return `just voted on · ${mins(until - now)} min`;
        if (inLobby) return null;
        return stalling(p, state, now) ? null : 'taking their turns';
    };

    return (
        <Modal open={open} onClose={onClose} subtitle="Vote to remove" title="Kick a player" width={420}>
            <div className="flex flex-col gap-4 p-5">
                <p className="text-[13px] leading-snug text-muted-foreground">
                    Only for someone the turn clock has had to play for — being ahead isn't grounds. Everyone else
                    still in the game has to agree, up to four votes, and who voted goes in the log. Mid-game it's
                    the same as resigning: their property goes back to the bank and they can't rejoin. Someone
                    who's already dropped out gets five minutes to reconnect instead of a vote.
                </p>
                <div className="flex flex-col gap-2">
                    {others.length === 0 && (
                        <span className="py-2 text-[13px] text-muted-foreground">Nobody else to vote on.</span>
                    )}
                    {others.map((p) => {
                        const why = blocked(p);
                        return (
                            <button
                                key={p.id}
                                type="button"
                                disabled={!!why}
                                onClick={() => {
                                    send('vote:start', { targetId: p.id });
                                    onClose();
                                }}
                                className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2.5 text-left transition-colors hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-white/8"
                            >
                                <span
                                    className="mono flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                                    style={{ background: p.color }}
                                >
                                    {tag(p)}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px]">{p.name}</span>
                                    {/* The grounds, or what's standing in the
                                        way of them. Either way it's the
                                        sentence you'd otherwise have to guess
                                        at from a button that does nothing. */}
                                    <span className="label truncate text-muted-foreground">
                                        {why ||
                                            (p.connected
                                                ? `clock played ${p.stalls} turn${p.stalls === 1 ? '' : 's'}`
                                                : 'dropped out')}
                                    </span>
                                </span>
                                {/* Which of the two this turns into, before you
                                    press it rather than after. */}
                                {!p.connected && <span className="label shrink-0 text-[#ff9db2]">away · 5 min</span>}
                                {!p.connected ? (
                                    <WifiOff className="size-4 shrink-0 text-[#ff9db2]" />
                                ) : why ? (
                                    <Clock className="size-4 shrink-0 text-muted-foreground" />
                                ) : (
                                    <Gavel className="size-4 shrink-0 text-muted-foreground" />
                                )}
                            </button>
                        );
                    })}
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
    // A countdown on someone who has dropped out has no ballot at all — the
    // only thing that can end it is them coming back.
    const waiting = vote.mode === 'abandon';
    return {
        vote,
        target,
        isTarget,
        voted,
        waiting,
        canVote: !waiting && !isTarget && !voted && !!me && !me.bankrupt,
    };
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
    const { state, send } = useGame();
    const role = useVoteRole();
    const left = useCountdown(role?.vote.endsAt ?? 0);
    if (!role?.canVote) return null;
    const { vote, target } = role;
    const caller = state.players.find((p) => p.id === vote.byId);

    return (
        <Modal open dismissable={false} subtitle="Vote to remove" title={`Kick ${target.name}?`} width={420}>
            <div className="flex flex-col gap-5 p-5">
                <div className="flex items-center justify-between">
                    <span className="mono text-[15px]">
                        <span style={{ color: '#3ddc97' }}>{vote.yes.length}</span>
                        <span className="text-muted-foreground"> / {vote.needed} needed</span>
                    </span>
                    <span className="mono text-[13px] text-muted-foreground">{clock(left)}</span>
                </div>

                {/* Who is asking, and on what grounds. A vote that arrives
                    anonymous is one you answer on the name of the target alone,
                    which is exactly how a table talks itself into a pile-on. */}
                <div className="flex flex-col gap-1.5 rounded-xl border border-white/8 px-3 py-2.5">
                    <span className="text-[13px] leading-snug">
                        <span className="text-muted-foreground">Called by </span>
                        {caller?.name || 'someone'}
                        <span className="text-muted-foreground">
                            {' · the clock has played '}
                            {target.stalls} of {target.name}'s turns
                        </span>
                    </span>
                    {/* Live, not just in the log afterwards. Everyone can see
                        the tally already; hiding the names behind it only made
                        it deniable. */}
                    {(vote.yes.length > 0 || vote.no.length > 0) && (
                        <span className="label leading-snug">
                            {vote.yes.length > 0 && (
                                <span style={{ color: '#3ddc97' }}>kick: {names(vote.yes, state)}</span>
                            )}
                            {vote.yes.length > 0 && vote.no.length > 0 && (
                                <span className="text-muted-foreground"> · </span>
                            )}
                            {vote.no.length > 0 && (
                                <span className="text-muted-foreground">keep: {names(vote.no, state)}</span>
                            )}
                        </span>
                    )}
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
    const { vote, target, isTarget, waiting } = role;
    // A countdown empties as it runs; a ballot fills as it's answered. Both
    // read as "how close is this to happening" without parsing the numbers.
    const pct = waiting
        ? Math.max(0, Math.min(100, ((left * 1000) / Math.max(vote.endsAt - vote.startedAt, 1)) * 100))
        : Math.min(100, (vote.yes.length / Math.max(vote.needed, 1)) * 100);
    const Icon = waiting ? WifiOff : Gavel;

    return (
        <span
            className="relative flex items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5"
            style={{ borderColor: 'rgba(255,92,124,.4)', background: 'rgba(255,92,124,.08)' }}
            title={
                waiting
                    ? `${target.name} dropped out — out of the game unless they reconnect in time`
                    : isTarget
                      ? 'The table is voting on you'
                      : `Vote to kick ${target.name}`
            }
        >
            {/* Fills toward the threshold, so the state is readable without
                stopping to parse the numbers. */}
            <span
                className="absolute inset-y-0 left-0 transition-[width] duration-300"
                style={{ width: `${pct}%`, background: 'rgba(255,92,124,.18)' }}
            />
            <Icon className="relative size-3.5 shrink-0 text-[#ff9db2]" />
            {/* The name is the first thing to go on a phone — the header is
                already carrying the room code and the bankrupt button, and the
                clock is what you're actually watching. */}
            <span className="mono relative hidden max-w-[7em] truncate text-[12px] text-[#ff9db2] sm:inline">
                {isTarget ? 'you' : target.name}
            </span>
            {!waiting && (
                <span className="mono relative text-[12px] text-[#ff9db2]">
                    {vote.yes.length}/{vote.needed}
                </span>
            )}
            <span className="mono relative text-[11px] text-muted-foreground">{clock(left)}</span>
        </span>
    );
}
