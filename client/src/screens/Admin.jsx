import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { LogOut, RefreshCw, ShieldCheck, UserX, Users, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { alpha, tag } from '@/lib/color';
import { gameName } from '@/lib/games';
import { cn } from '@/lib/utils';
import {
    SignedOut,
    clearAdminToken,
    endRoom,
    kick,
    listRooms,
    loadAdminToken,
    signIn,
} from '@/lib/admin';

/**
 * The site admin's view of every room on the server, at /admin.
 *
 * Outside the room password on purpose, and outside the game's socket: it has
 * its own key, checked by the server on every request, and nothing on this page
 * joins, watches or counts as present in a room. It polls rather than
 * listening, because it is one tab someone opens now and then — not worth a
 * second kind of connection the server has to reason about.
 */

const POLL_MS = 3000;

function ago(at, now) {
    if (!at) return '—';
    const s = Math.max(0, Math.round((now - at) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    return `${Math.round(s / 3600)} h ago`;
}

const PHASE = { waiting: 'In the lobby', ended: 'Finished' };
const phaseLabel = (phase) => PHASE[phase] || 'Playing';

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

/**
 * A button that has to be pressed twice. Both things this page does throw
 * people out of a game they are in the middle of, and neither can be undone.
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

function RoomCard({ room, now, onKick, onEnd }) {
    return (
        <div className="panel flex flex-col">
            <header className="panel-divider flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                        <span className="mono text-lg tracking-widest">{room.code}</span>
                        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[11px]">{gameName(room.game)}</span>
                        <span
                            className={cn(
                                'rounded-full px-2 py-0.5 text-[11px]',
                                room.phase === 'waiting' ? 'bg-white/5 text-muted-foreground' : 'bg-[#3ddc97]/15 text-[#3ddc97]',
                                room.phase === 'ended' && 'bg-white/5 text-muted-foreground',
                            )}
                        >
                            {phaseLabel(room.phase)}
                            {room.paused ? ' · paused' : ''}
                        </span>
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                        {room.board ? `${room.board} · ` : ''}
                        {room.phase !== 'waiting' ? `${room.turnCount} turns · ` : ''}
                        last move {ago(room.lastActionAt, now)}
                        {room.spectators ? ` · ${room.spectators} watching` : ''}
                        {room.banned ? ` · ${room.banned} banned` : ''}
                    </span>
                </div>
                <ConfirmButton
                    label="End game"
                    confirmLabel={`End ${room.code} for everyone`}
                    icon={XCircle}
                    onConfirm={() => onEnd(room.code)}
                />
            </header>

            <div className="flex flex-col gap-1.5 p-3">
                {room.players.map((p) => (
                    <div
                        key={p.id}
                        className={cn(
                            'flex items-center gap-3 rounded-lg border px-3 py-2',
                            p.out && 'opacity-50',
                        )}
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
                                onConfirm={() => onKick(room.code, p.id, p.name)}
                            />
                        )}
                    </div>
                ))}
                {!room.players.length && <span className="px-2 py-1 text-[13px] text-muted-foreground">Nobody seated</span>}
            </div>
        </div>
    );
}

export function Admin() {
    const [signedIn, setSignedIn] = useState(() => !!loadAdminToken());
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [flash, setFlash] = useState('');

    const refresh = useCallback(async () => {
        try {
            setData(await listRooms());
            setError('');
        } catch (err) {
            if (err instanceof SignedOut) setSignedIn(false);
            else setError(err.message);
        }
    }, []);

    useEffect(() => {
        if (!signedIn) return undefined;
        // First load on the next tick rather than inside the effect itself.
        const first = setTimeout(refresh, 0);
        const t = setInterval(refresh, POLL_MS);
        return () => {
            clearTimeout(first);
            clearInterval(t);
        };
    }, [signedIn, refresh]);

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
        refresh();
    };

    if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;

    const rooms = data?.rooms || [];
    // The server's clock, not this one: "last move" is measured against the
    // same clock that stamped it. Rooms only render once data has arrived.
    const now = data?.now ?? 0;
    const seated = rooms.reduce((n, r) => n + r.players.filter((p) => p.connected).length, 0);

    return (
        <div className="flex min-h-svh flex-col items-center gap-5 p-6">
            <header className="flex w-full max-w-[860px] flex-wrap items-center justify-between gap-3">
                <div className="flex flex-col">
                    <span className="flex items-center gap-2 text-2xl font-medium tracking-tight">
                        <ShieldCheck className="size-5 text-primary" /> Admin
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                        {rooms.length} room{rooms.length === 1 ? '' : 's'} · {seated} connected · refreshes every{' '}
                        {POLL_MS / 1000}s
                    </span>
                </div>
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={refresh}>
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

            {flash && (
                <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="panel w-full max-w-[860px] px-4 py-2.5 text-[14px]"
                >
                    {flash}
                </motion.div>
            )}
            {error && (
                <div className="w-full max-w-[860px] rounded-lg border border-[#ff5c7c]/40 px-4 py-2.5 text-[14px] text-[#ff5c7c]">
                    {error}
                </div>
            )}

            <div className="flex w-full max-w-[860px] flex-col gap-4">
                {data && !rooms.length && (
                    <div className="panel flex flex-col items-center gap-2 px-6 py-14 text-center">
                        <Users className="size-7 text-muted-foreground/60" />
                        <span className="text-[15px]">No rooms open</span>
                    </div>
                )}
                {rooms.map((room) => (
                    <RoomCard
                        key={room.code}
                        room={room}
                        now={now}
                        onKick={(code, id, name) => run(() => kick(code, id), `${name} was removed from ${code}`)}
                        onEnd={(code) => run(() => endRoom(code), `${code} was ended`)}
                    />
                ))}
            </div>
        </div>
    );
}
