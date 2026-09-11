import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Activity,
    Eye,
    EyeOff,
    Gavel,
    LogOut,
    Megaphone,
    Pause,
    Play,
    RefreshCw,
    ScrollText,
    ShieldCheck,
    SkipForward,
    Trophy,
    UserCheck,
    UserX,
    Users,
    XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { alpha, tag } from '@/lib/color';
import { gameName } from '@/lib/games';
import { money } from '@/lib/board-layout';
import { cn } from '@/lib/utils';
import {
    SignedOut,
    auditLog,
    clearAdminToken,
    endRoom,
    finishDeadline,
    health,
    kick,
    listRooms,
    loadAdminToken,
    playTurn,
    sendNotice,
    setPaused,
    signIn,
    unban,
    watchRoom,
} from '@/lib/admin';

/**
 * The site admin's view of every room on the server, at /admin.
 *
 * Outside the room password on purpose, and outside the game's socket: it has
 * its own key, checked by the server on every request, and nothing on this page
 * joins, watches or counts as present in a room. It polls rather than
 * listening, because it is one tab someone opens now and then — not worth a
 * second kind of connection the server has to reason about.
 *
 * What it can do is deliberately short. Everything here either removes someone
 * or saves a stuck game without ending it; nothing edits a player's money or
 * property, because a result the key holder could have changed is a result
 * nobody at the table can trust.
 */

const POLL_MS = 3000;
const HEALTH_MS = 10000;

function ago(at, now) {
    if (!at || !now) return '—';
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
}

function duration(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h ${m % 60} min`;
    return `${Math.floor(h / 24)} days`;
}

const PHASE = { waiting: 'In the lobby', ended: 'Finished' };
const phaseLabel = (phase) => PHASE[phase] || 'Playing';

/** Polls `fn` while `on`, first load on the next tick rather than in the effect. */
function usePoll(fn, ms, on = true) {
    useEffect(() => {
        if (!on) return undefined;
        const first = setTimeout(fn, 0);
        const t = setInterval(fn, ms);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, [fn, ms, on]);
}

/* ------------------------------------------------------------------ sign in */

function SignIn({ onSignedIn }) {
    const [key, setKey] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!key || busy) return;
        setBusy(true);
        setError('');
        try {
            await signIn(key);
            onSignedIn();
        } catch (err) {
            setError(err.message);
            setKey('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.form
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                onSubmit={submit}
                className="panel flex w-full max-w-[420px] flex-col gap-7 p-10"
            >
                <header className="flex flex-col items-center gap-3 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                        <ShieldCheck className="size-5" />
                    </span>
                    <span className="text-3xl font-medium tracking-tight">Admin</span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                        Enter the admin key. This browser stays signed in for a week.
                    </span>
                </header>
                <div className="flex flex-col gap-2">
                    <input
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="admin key"
                        className="min-w-0 rounded-xl border border-input bg-black/25 px-4 text-lg outline-none placeholder:text-muted-foreground focus:border-primary/60"
                        style={{ height: 52 }}
                    />
                    {error && <span className="label text-center text-[#ff5c7c]">{error}</span>}
                </div>
                <Button type="submit" style={{ height: 52 }} className="text-lg" disabled={!key || busy}>
                    {busy ? 'Checking…' : 'Sign in'}
                </Button>
            </motion.form>
        </div>
    );
}

/* ----------------------------------------------------------------- controls */

/**
 * A button that has to be pressed twice. Used for everything that throws
 * people out of a game they are in the middle of, which cannot be undone.
 */
function ConfirmButton({ label, confirmLabel, icon: Icon, onConfirm, className }) {
    const [armed, setArmed] = useState(false);
    useEffect(() => {
        if (!armed) return undefined;
        const t = setTimeout(() => setArmed(false), 3000);
        return () => clearTimeout(t);
    }, [armed]);
    return (
        <Button
            size="sm"
            variant={armed ? 'default' : 'outline'}
            className={cn(armed && 'bg-[#ff5c7c] text-white hover:bg-[#ff7590]', className)}
            onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
        >
            <Icon /> {armed ? confirmLabel : label}
        </Button>
    );
}

/* ------------------------------------------------------------------- health */

function Stat({ label, value, warn }) {
    return (
        <div className="flex min-w-[96px] flex-col rounded-lg border border-white/8 px-3 py-2">
            <span className="label opacity-70">{label}</span>
            <span className={cn('mono text-[14px]', warn && 'text-[#ffb648]')}>{value}</span>
        </div>
    );
}

function HealthStrip({ data }) {
    if (!data) return null;
    const full = data.rooms.total / data.rooms.max;
    return (
        <div className="flex w-full flex-wrap gap-2">
            <Stat label="build" value={String(data.version).slice(0, 10)} />
            <Stat label="up for" value={duration(data.uptimeMs)} />
            <Stat label="online" value={`${data.online ?? '—'} · ${data.playing ?? '—'} playing`} />
            <Stat label="rooms" value={`${data.rooms.total} / ${data.rooms.max}`} warn={full >= 0.8} />
            <Stat
                label="in them"
                value={`${data.rooms.playing} live · ${data.rooms.waiting} lobby · ${data.rooms.ended} done`}
            />
            <Stat label="memory" value={`${data.memory.rssMb} MB`} warn={data.memory.rssMb > 700} />
            <Stat label="links" value={data.sharedLinks} />
        </div>
    );
}

/* ------------------------------------------------------------------- notice */

/**
 * A banner on every open tab. For "restarting in two minutes" — deploys
 * resume games already, but a table would rather finish the turn than find
 * out from the update screen.
 */
function NoticeComposer({ active, onSend, onClear }) {
    const [text, setText] = useState('Restarting in 2 minutes — games will resume');
    const [minutes, setMinutes] = useState(3);
    return (
        <div className="panel flex w-full flex-col gap-2 px-4 py-3">
            <span className="label flex items-center gap-1.5">
                <Megaphone className="size-3.5" /> Notice to everyone online
            </span>
            {active ? (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 text-[14px]">
                        <span className="text-[#ffb648]">Showing:</span> {active.text}
                    </span>
                    <Button size="sm" variant="outline" onClick={onClear}>
                        Take it down
                    </Button>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        value={text}
                        maxLength={160}
                        onChange={(e) => setText(e.target.value)}
                        className="min-w-[200px] flex-1 rounded-lg border border-input bg-black/25 px-3 py-1.5 text-[14px] outline-none focus:border-primary/60"
                    />
                    <select
                        value={minutes}
                        onChange={(e) => setMinutes(Number(e.target.value))}
                        className="rounded-lg border border-input bg-black/25 px-2 py-1.5 text-[13px] outline-none"
                    >
                        {[1, 3, 5, 10, 30].map((m) => (
                            <option key={m} value={m}>
                                for {m} min
                            </option>
                        ))}
                    </select>
                    <Button size="sm" disabled={!text.trim()} onClick={() => onSend(text.trim(), minutes)}>
                        Send
                    </Button>
                </div>
            )}
        </div>
    );
}

/* ---------------------------------------------------------------- watching */

/**
 * The room as a spectator sees it — who has what, where, and the last things
 * the game did. A summary rather than the board: enough to tell a stuck game
 * from a slow one, and a griefer from somebody losing.
 */
function WatchPanel({ code, game }) {
    const [view, setView] = useState(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => {
        try {
            setView((await watchRoom(code)).state);
            setError('');
        } catch (err) {
            setError(err.message);
        }
    }, [code]);
    usePoll(load, POLL_MS);

    if (error) return <p className="px-4 pb-3 text-[13px] text-[#ff5c7c]">{error}</p>;
    if (!view) return <p className="px-4 pb-3 text-[13px] text-muted-foreground">Loading…</p>;

    const cards = game === 'nouno';
    const current = view.players?.[view.turnIndex];
    const feed = (view.log || []).slice(-14).reverse();

    return (
        <div className="grid gap-3 border-t border-white/8 px-4 py-3 md:grid-cols-[1.1fr_1fr]">
            <div className="flex flex-col gap-1.5">
                <span className="label opacity-70">
                    {cards
                        ? `Top card ${view.top ? `${view.top.kind}${view.top.value ?? ''}` : '—'} · following ${view.active || '—'} · ${view.stockCount} in the stock`
                        : `${current ? `${current.name} is up` : ''}${view.auction ? ' · auction running' : ''}${view.pendingAction ? ` · waiting on ${view.pendingAction.type}` : ''}`}
                </span>
                <div className="scroll-thin overflow-x-auto">
                    <table className="w-full text-[13px]">
                        <thead>
                            <tr className="text-left text-muted-foreground">
                                <th className="py-1 pr-3 font-normal">Player</th>
                                {cards ? (
                                    <th className="py-1 pr-3 font-normal">Cards</th>
                                ) : (
                                    <>
                                        <th className="py-1 pr-3 font-normal">Cash</th>
                                        <th className="py-1 pr-3 font-normal">Worth</th>
                                        <th className="py-1 pr-3 font-normal">Deeds</th>
                                        <th className="py-1 pr-3 font-normal">On</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {(view.players || []).map((p, i) => (
                                <tr
                                    key={p.id}
                                    className={cn(
                                        (p.resigned || p.bankrupt || p.out) && 'opacity-40',
                                        i === view.turnIndex && 'text-[#ffb648]',
                                    )}
                                >
                                    <td className="py-1 pr-3">
                                        <span className="flex items-center gap-1.5">
                                            <span className="size-2 rounded-full" style={{ background: p.color }} />
                                            {p.name}
                                        </span>
                                    </td>
                                    {cards ? (
                                        <td className="mono py-1 pr-3">{p.handCount}</td>
                                    ) : (
                                        <>
                                            <td className="mono py-1 pr-3">
                                                {money(p.cash)}
                                                {p.debt ? <span className="text-[#ff5c7c]"> owes</span> : null}
                                            </td>
                                            <td className="mono py-1 pr-3">{money(p.netWorth)}</td>
                                            <td className="mono py-1 pr-3">{(p.properties || []).length}</td>
                                            <td className="max-w-[140px] truncate py-1 pr-3">
                                                {p.inJail ? 'Jail' : view.tiles?.[p.position]?.name || '—'}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="label opacity-70">What happened</span>
                <div className="scroll-thin flex max-h-[220px] flex-col gap-1 overflow-y-auto">
                    {feed.map((l) => (
                        <span key={l.id} className="text-[12.5px] leading-snug text-muted-foreground">
                            {l.text}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------- rooms */

function RoomCard({ room, now, run }) {
    const [watching, setWatching] = useState(false);
    const live = room.phase !== 'waiting' && room.phase !== 'ended';
    const code = room.code;

    return (
        <div className="panel flex flex-col">
            <header className="panel-divider flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="mono text-lg tracking-widest">{code}</span>
                        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px]">{gameName(room.game)}</span>
                        <span
                            className={cn(
                                'rounded-full px-2 py-0.5 text-[11px]',
                                live ? 'bg-[#3ddc97]/15 text-[#3ddc97]' : 'bg-white/5 text-muted-foreground',
                                room.paused && 'bg-[#ffb648]/15 text-[#ffb648]',
                            )}
                        >
                            {room.paused ? 'Paused' : phaseLabel(room.phase)}
                        </span>
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                        {room.board ? `${room.board} · ` : ''}
                        {live ? `${room.turnCount} turns · ` : ''}
                        last move {ago(room.lastActionAt, now)}
                        {room.spectators ? ` · ${room.spectators} watching` : ''}
                    </span>
                    {room.paused && room.pausedUntil && (
                        <span className="text-[12px] text-[#ffb648]">
                            Paused — kept even if everyone leaves, until{' '}
                            {new Date(room.pausedUntil).toLocaleString([], {
                                weekday: 'short',
                                hour: 'numeric',
                                minute: '2-digit',
                            })}
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setWatching((w) => !w)}>
                        {watching ? <EyeOff /> : <Eye />} {watching ? 'Stop watching' : 'Watch'}
                    </Button>
                    {live && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                                run(() => setPaused(code, !room.paused), room.paused ? `${code} resumed` : `${code} paused`)
                            }
                        >
                            {room.paused ? <Play /> : <Pause />} {room.paused ? 'Resume' : 'Pause'}
                        </Button>
                    )}
                    {live && !room.paused && room.deadline && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => run(() => finishDeadline(code), `Closed the auction in ${code}`)}
                        >
                            <Gavel /> {room.auction ? 'Close auction' : 'End countdown'}
                        </Button>
                    )}
                    {live && !room.paused && !room.auction && room.currentId && (
                        <ConfirmButton
                            label="Play turn"
                            confirmLabel={`Play ${room.players.find((p) => p.id === room.currentId)?.name || 'their'}'s turn`}
                            icon={SkipForward}
                            onConfirm={() => run(() => playTurn(code), `Played a turn in ${code}`)}
                        />
                    )}
                    {/* Two ways to end a game in progress. With results is the
                        usual one — whoever is ahead wins, and the end screen is
                        what saves the game to everyone's history. Without is for
                        a game not worth keeping. A lobby or a finished game has
                        no result to show, so it only closes. */}
                    {live ? (
                        <>
                            <ConfirmButton
                                label="End · show results"
                                confirmLabel="Whoever's ahead wins"
                                icon={Trophy}
                                onConfirm={() =>
                                    run(() => endRoom(code, true), `${code} ended — everyone is on the end screen`)
                                }
                            />
                            <ConfirmButton
                                label="End · no results"
                                confirmLabel="Send everyone home"
                                icon={XCircle}
                                onConfirm={() => run(() => endRoom(code, false), `${code} was closed`)}
                            />
                        </>
                    ) : (
                        <ConfirmButton
                            label="Close room"
                            confirmLabel={`Close ${code}`}
                            icon={XCircle}
                            onConfirm={() => run(() => endRoom(code, false), `${code} was closed`)}
                        />
                    )}
                </div>
            </header>

            <div className="flex flex-col gap-1.5 p-3">
                {room.players.map((p) => (
                    <div
                        key={p.id}
                        className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', p.out && 'opacity-50')}
                        style={{ borderColor: alpha(p.color || '#9aa0b5', 0.3) }}
                    >
                        <span
                            className="mono flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                            style={{ background: p.color }}
                        >
                            {tag(p)}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[14px]">
                                {p.name}
                                {p.id === room.hostId && <span className="label ml-2 opacity-60">host</span>}
                                {p.id === room.currentId && <span className="label ml-2 text-[#ffb648]">their turn</span>}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                {p.out ? 'out of the game' : p.connected ? 'connected' : 'disconnected'}
                            </span>
                        </span>
                        <span
                            className={cn('size-2 shrink-0 rounded-full', p.connected ? 'bg-[#3ddc97]' : 'bg-white/20')}
                            title={p.connected ? 'Connected' : 'Disconnected'}
                        />
                        {!p.out && (
                            <ConfirmButton
                                label="Kick"
                                confirmLabel={`Kick ${p.name}`}
                                icon={UserX}
                                onConfirm={() => run(() => kick(code, p.id), `${p.name} was removed from ${code}`)}
                            />
                        )}
                    </div>
                ))}
                {!room.players.length && <span className="px-2 py-1 text-[13px] text-muted-foreground">Nobody seated</span>}

                {/* Undoing a kick. Someone removed mid-game comes back to watch —
                    their estate already went back and is not returned. */}
                {!!room.banned.length && (
                    <div className="mt-1 flex flex-col gap-1 rounded-lg border border-dashed border-white/10 px-3 py-2">
                        <span className="label opacity-70">Banned from this room</span>
                        {room.banned.map((b) => (
                            <div key={b.id} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[13px]">{b.name || 'A removed player'}</span>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                        run(() => unban(code, b.id), `${b.name || 'They'} can come back into ${code}`)
                                    }
                                    title={live ? 'They can come back to watch — not to play this game again' : undefined}
                                >
                                    <UserCheck /> Unban
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {watching && <WatchPanel code={code} game={room.game} />}
        </div>
    );
}

/* ---------------------------------------------------------------------- log */

function LogList({ entries, now }) {
    if (!entries) return <p className="text-[13px] text-muted-foreground">Loading…</p>;
    if (!entries.length) return <p className="text-[13px] text-muted-foreground">Nothing since the server started.</p>;
    return (
        <div className="panel flex flex-col divide-y divide-white/5">
            {entries.map((e, i) => (
                <div key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-[13px]">
                    <span className="mono w-[86px] shrink-0 text-muted-foreground">{ago(e.at, now)}</span>
                    <span
                        className={cn(
                            'min-w-0 flex-1',
                            (e.action === 'wrong key' || e.action === 'locked out') && 'text-[#ff5c7c]',
                        )}
                    >
                        {e.action}
                        {e.detail ? <span className="text-muted-foreground"> — {e.detail}</span> : null}
                    </span>
                    <span className="mono text-[12px] text-muted-foreground">{e.ip}</span>
                </div>
            ))}
        </div>
    );
}

/* --------------------------------------------------------------------- page */

export function Admin() {
    const [signedIn, setSignedIn] = useState(() => !!loadAdminToken());
    const [tab, setTab] = useState('rooms');
    const [data, setData] = useState(null);
    const [serverHealth, setServerHealth] = useState(null);
    const [log, setLog] = useState(null);
    const [error, setError] = useState('');
    const [flash, setFlash] = useState('');

    const guard = useCallback(async (fn) => {
        try {
            await fn();
            setError('');
        } catch (err) {
            if (err instanceof SignedOut) setSignedIn(false);
            else setError(err.message);
        }
    }, []);

    const loadRooms = useCallback(() => guard(async () => setData(await listRooms())), [guard]);
    const loadHealth = useCallback(() => guard(async () => setServerHealth(await health())), [guard]);
    const loadLog = useCallback(() => guard(async () => setLog((await auditLog()).entries)), [guard]);

    usePoll(loadRooms, POLL_MS, signedIn);
    usePoll(loadHealth, HEALTH_MS, signedIn);
    usePoll(loadLog, POLL_MS, signedIn && tab === 'log');

    // What just happened, said once and then gone.
    useEffect(() => {
        if (!flash) return undefined;
        const t = setTimeout(() => setFlash(''), 3500);
        return () => clearTimeout(t);
    }, [flash]);

    const run = async (what, done) => {
        try {
            await what();
            setFlash(done);
        } catch (err) {
            if (err instanceof SignedOut) return setSignedIn(false);
            setFlash(err.message);
        }
        loadRooms();
        loadHealth();
    };

    if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;

    const rooms = data?.rooms || [];
    const now = data?.now ?? 0;

    return (
        <div className="flex min-h-svh flex-col items-center gap-4 p-6">
            <div className="flex w-full max-w-[960px] flex-col gap-4">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-2xl font-medium tracking-tight">
                        <ShieldCheck className="size-5 text-primary" /> Admin
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                loadRooms();
                                loadHealth();
                                if (tab === 'log') loadLog();
                            }}
                        >
                            <RefreshCw /> Refresh
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                clearAdminToken();
                                setSignedIn(false);
                            }}
                        >
                            <LogOut /> Sign out
                        </Button>
                    </div>
                </header>

                <HealthStrip data={serverHealth} />

                <NoticeComposer
                    active={serverHealth?.notice || null}
                    onSend={(text, minutes) => run(() => sendNotice(text, minutes), 'Notice sent to everyone online')}
                    onClear={() => run(() => sendNotice(''), 'Notice taken down')}
                />

                {flash && (
                    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="panel px-4 py-2.5 text-[14px]">
                        {flash}
                    </motion.div>
                )}
                {error && (
                    <div className="rounded-lg border border-[#ff5c7c]/40 px-4 py-2.5 text-[14px] text-[#ff5c7c]">{error}</div>
                )}

                <div className="flex gap-1">
                    {[
                        { id: 'rooms', label: `Rooms (${rooms.length})`, icon: Activity },
                        { id: 'log', label: 'Admin log', icon: ScrollText },
                    ].map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={cn(
                                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                                tab === t.id
                                    ? 'bg-white/10 text-foreground'
                                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                            )}
                        >
                            <t.icon className="size-3.5" /> {t.label}
                        </button>
                    ))}
                </div>

                {tab === 'rooms' && (
                    <div className="flex flex-col gap-4">
                        {data && !rooms.length && (
                            <div className="panel flex flex-col items-center gap-2 px-6 py-14 text-center">
                                <Users className="size-7 text-muted-foreground/60" />
                                <span className="text-[15px]">No rooms open</span>
                            </div>
                        )}
                        {rooms.map((room) => (
                            <RoomCard key={room.code} room={room} now={now} run={run} />
                        ))}
                    </div>
                )}

                {tab === 'log' && (
                    <div className="flex flex-col gap-2">
                        <span className="text-[12px] text-muted-foreground">
                            Every sign-in and everything done here since the server started, newest first. If you
                            see something you didn't do, change the key.
                        </span>
                        <LogList entries={log} now={now} />
                    </div>
                )}
            </div>
        </div>
    );
}
