import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Pencil, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Scoreboard } from '@/components/Scoreboard';
import { alpha, tag } from '@/lib/color';
import {
    durationOf,
    loadHistory,
    removeEntry,
    renameEntry,
    stampOf,
    titleOf,
    whenOf,
} from '@/lib/history';
import { cn } from '@/lib/utils';

/**
 * Games you have finished, and the end screen of any of them.
 *
 * Two views in one screen rather than two screens: the list, and a game opened
 * out of it. Everything here comes from this browser's own storage — see
 * lib/history.js for why there is no server behind it.
 */

/** Rename in place. A game's name is the thing you will look for it by. */
function NameField({ entry, onRenamed }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(entry.nickname || '');

    const commit = () => {
        renameEntry(entry.id, draft.trim());
        setEditing(false);
        onRenamed?.();
    };

    if (!editing) {
        return (
            <button
                type="button"
                onClick={() => {
                    setDraft(entry.nickname || '');
                    setEditing(true);
                }}
                className="panel flex items-center gap-2.5 px-5 py-3 text-left transition-colors hover:border-white/20"
            >
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col">
                    <span className="label">Name</span>
                    <span className="truncate text-[15px]">
                        {entry.nickname || <span className="text-muted-foreground">Give this game a name</span>}
                    </span>
                </span>
            </button>
        );
    }

    return (
        <div className="panel flex items-center gap-2 px-4 py-3">
            <input
                autoFocus
                value={draft}
                maxLength={60}
                placeholder="The one with the triple hotel"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') setEditing(false);
                }}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <Button size="sm" onClick={commit}>
                <Check /> Save
            </Button>
        </div>
    );
}

/** One row of the list: what it was called, who won, and when. */
function Row({ entry, onOpen, onRemoved }) {
    const winners = entry.players.filter((p) => entry.winnerIds.includes(p.id));
    const champion = winners[0];
    const [confirming, setConfirming] = useState(false);

    return (
        <div
            className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:border-white/25"
            style={{
                borderColor: champion ? alpha(champion.color, 0.3) : 'var(--border)',
                background: champion ? alpha(champion.color, 0.06) : 'rgba(255,255,255,.015)',
            }}
        >
            <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span
                    className="mono flex size-9 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                    style={{ background: champion?.color || 'rgba(255,255,255,.1)' }}
                >
                    {champion ? tag(champion) : '—'}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px]">{titleOf(entry)}</span>
                    <span className="truncate text-[12px] text-muted-foreground">
                        {entry.players.length} players · {entry.facts.turnCount} turns · {durationOf(entry)}
                        {entry.boardName ? ` · ${entry.boardName}` : ''}
                    </span>
                </span>
            </button>
            <span className="mono shrink-0 text-right text-[11px] text-muted-foreground" title={stampOf(entry.endedAt)}>
                {whenOf(entry.endedAt)}
            </span>
            {/* Two taps to delete: this is the only copy there is. */}
            <button
                type="button"
                title={confirming ? 'Tap again to forget this game' : 'Forget this game'}
                onClick={() => {
                    if (!confirming) {
                        setConfirming(true);
                        setTimeout(() => setConfirming(false), 3000);
                        return;
                    }
                    removeEntry(entry.id);
                    onRemoved?.();
                }}
                className={cn(
                    'shrink-0 rounded-md p-1.5 transition-colors',
                    confirming ? 'bg-[#ff5c7c]/15 text-[#ff5c7c]' : 'text-muted-foreground hover:text-[#ff5c7c]',
                )}
            >
                <Trash2 className="size-4" />
            </button>
        </div>
    );
}

export function PastGames({ onClose }) {
    // Read once per change rather than on every render: storage is the source
    // of truth and `tick` is how this screen says it has been written to.
    const [tick, setTick] = useState(0);
    const games = useMemo(() => loadHistory(), [tick]);
    const [openId, setOpenId] = useState(null);
    const open = games.find((g) => g.id === openId) || null;

    if (open) {
        return (
            <div className="flex min-h-svh flex-col items-center gap-5 p-6">
                <div className="flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3">
                    <Button variant="ghost" onClick={() => setOpenId(null)}>
                        <ArrowLeft /> All games
                    </Button>
                    <span className="mono text-[12px] text-muted-foreground">{stampOf(open.endedAt)}</span>
                </div>
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex w-full justify-center"
                >
                    <Scoreboard
                        entry={{ ...open, card: { ...open.card, title: open.nickname || undefined } }}
                        aside={<NameField entry={open} onRenamed={() => setTick((n) => n + 1)} />}
                    />
                </motion.div>
            </div>
        );
    }

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel flex max-h-[92svh] w-full max-w-[720px] flex-col overflow-hidden"
            >
                <header className="panel-divider flex shrink-0 items-center justify-between gap-3 px-6 py-4">
                    <div className="flex flex-col">
                        <span className="text-2xl font-medium tracking-tight">Past games</span>
                        <span className="text-[12px] text-muted-foreground">
                            Kept in this browser, on this device. Nothing is uploaded.
                        </span>
                    </div>
                    <Button variant="ghost" onClick={onClose}>
                        <ArrowLeft /> Back
                    </Button>
                </header>

                <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
                    {games.length === 0 && (
                        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                            <Trophy className="size-7 text-muted-foreground/60" />
                            <span className="text-[15px]">No games yet</span>
                            <span className="max-w-[38ch] text-[13px] leading-snug text-muted-foreground">
                                Finish one and it lands here — the end screen, the chart and the standings,
                                yours to name and to share.
                            </span>
                        </div>
                    )}
                    {games.map((g) => (
                        <Row
                            key={g.id}
                            entry={g}
                            onOpen={() => setOpenId(g.id)}
                            onRemoved={() => setTick((n) => n + 1)}
                        />
                    ))}
                </div>

                {games.length > 0 && (
                    <footer className="shrink-0 border-t border-white/8 px-6 py-3">
                        <span className="mono text-[11px] text-muted-foreground">
                            {games.length} game{games.length === 1 ? '' : 's'} · newest first · the oldest fall off
                            after 25
                        </span>
                    </footer>
                )}
            </motion.div>
        </div>
    );
}
