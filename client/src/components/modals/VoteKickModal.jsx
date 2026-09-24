import { useEffect, useState } from 'react';
import { Check, Gavel, WifiOff, X } from 'lucide-react';

import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { tag } from '@/lib/color';
import { cn } from '@/lib/utils';
import { SignedOut, kick as adminKick, loadAdminToken, signIn as adminSignIn } from '@/lib/admin';

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

/** Bare seconds up to a minute, then m:ss — five minutes as "287s" reads as noise. */
const clock = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Names for a list of player ids, for the places a vote has to name people. */
const names = (ids, state) =>
    ids
        .map((id) => state.players.find((p) => p.id === id)?.name)
        .filter(Boolean)
        .join(', ');

/**
 * Removing somebody, which is the admin's job alone now.
 *
 * The ballot is shut. It kept being used on whoever was winning rather than on
 * whoever was spoiling the game, and no threshold fixes that — a table that
 * wants somebody gone can always find one more yes. So this is a door rather
 * than a vote: the notice, a way in for whoever holds the key, and then the
 * same list as before with none of the rules on it, since the person reading it
 * is the one the rules existed to protect everybody from.
 *
 * It signs in against the admin key, the same one the panel at /admin uses, and
 * removes people through the same route — which is also the kick that locks
 * nothing behind it.
 */
export function VoteKickPicker({ open, onClose }) {
    const { state, playerId } = useGame();
    const [stage, setStage] = useState('notice');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    // Which name is a press away from being removed. A mis-tap here cannot be
    // undone from in here, so it costs two.
    const [armed, setArmed] = useState(null);

    const others = state.players.filter((p) => p.id !== playerId && !p.bankrupt);

    const close = () => {
        setStage('notice');
        setPassword('');
        setError('');
        setArmed(null);
        onClose();
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError('');
        try {
            await adminSignIn(password);
            setPassword('');
            setStage('picker');
        } catch (err) {
            setPassword('');
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (p) => {
        if (armed !== p.id) {
            setArmed(p.id);
            return;
        }
        setBusy(true);
        setError('');
        try {
            await adminKick(state.roomCode, p.id);
            close();
        } catch (err) {
            setArmed(null);
            // The key is good for a week and then it is not; say so rather than
            // showing the refusal a stale token comes back with.
            if (err instanceof SignedOut) {
                setStage('password');
                setError('Signed out — the password again');
            } else {
                setError(err.message);
            }
        } finally {
            setBusy(false);
        }
    };

    const title = stage === 'picker' ? 'Remove a player' : 'Kick a player';
    const subtitle = stage === 'picker' ? 'Admin' : 'Vote to remove';

    return (
        <Modal open={open} onClose={close} subtitle={subtitle} title={title} width={420}>
            {stage === 'notice' && (
                <div className="flex flex-col gap-4 p-5">
                    <p className="text-[13px] leading-snug text-muted-foreground">
                        Due to abuse, votekick is no longer available and can only be used by admins.
                    </p>
                    {/* Small on purpose. It is a way in for the one person who
                        has the key, not an invitation to the table. */}
                    <button
                        type="button"
                        onClick={() => setStage(loadAdminToken() ? 'picker' : 'password')}
                        className="self-start text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                    >
                        I'm an admin
                    </button>
                </div>
            )}

            {stage === 'password' && (
                <form onSubmit={submit} className="flex flex-col gap-3 p-5">
                    <input
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="admin key"
                        className="h-11 min-w-0 rounded-xl border border-input bg-black/25 px-4 outline-none placeholder:text-muted-foreground focus:border-primary/60"
                    />
                    {error && <span className="label text-[#ff5c7c]">{error}</span>}
                    <Button type="submit" className="h-11" disabled={!password || busy}>
                        {busy ? 'Checking…' : 'Sign in'}
                    </Button>
                </form>
            )}

            {stage === 'picker' && (
                <div className="flex flex-col gap-4 p-5">
                    <p className="text-[13px] leading-snug text-muted-foreground">
                        They are out for good and cannot rejoin. Their property goes back to the bank unlocked, and
                        nobody has to agree.
                    </p>
                    {error && <span className="label text-[#ff5c7c]">{error}</span>}
                    <div className="flex flex-col gap-2">
                        {others.length === 0 && (
                            <span className="py-2 text-[13px] text-muted-foreground">Nobody else at the table.</span>
                        )}
                        {others.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                disabled={busy}
                                onClick={() => remove(p)}
                                className={cn(
                                    'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50',
                                    armed === p.id
                                        ? 'border-[#ff5c7c]/60 bg-[#ff5c7c]/10'
                                        : 'border-white/8 hover:border-white/25',
                                )}
                            >
                                <span
                                    className="mono flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                                    style={{ background: p.color }}
                                >
                                    {tag(p)}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px]">{p.name}</span>
                                    <span
                                        className={cn(
                                            'label truncate',
                                            armed === p.id ? 'text-[#ff5c7c]' : 'text-muted-foreground',
                                        )}
                                    >
                                        {armed === p.id
                                            ? 'press again to remove them'
                                            : p.connected
                                              ? 'remove from the game'
                                              : 'dropped out'}
                                    </span>
                                </span>
                                {!p.connected ? (
                                    <WifiOff className="size-4 shrink-0 text-[#ff9db2]" />
                                ) : (
                                    <Gavel
                                        className={cn(
                                            'size-4 shrink-0',
                                            armed === p.id ? 'text-[#ff5c7c]' : 'text-muted-foreground',
                                        )}
                                    />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
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
