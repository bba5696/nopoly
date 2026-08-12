import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, Eye, Plus } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha, tag } from '@/lib/color';

function sideSummary(state, side) {
    const parts = side.tiles.map((id) => state.tiles[id]?.name).filter(Boolean);
    if (side.cash > 0) parts.push(money(side.cash));
    return parts.length ? parts.join(' + ') : 'nothing';
}

function TradeCard({ trade, onOpen, onCounter }) {
    const { state, playerId, send } = useGame();
    const from = state.players.find((p) => p.id === trade.fromId);
    const to = state.players.find((p) => p.id === trade.toId);
    if (!from || !to) return null;

    const forMe = trade.toId === playerId;
    const mine = trade.fromId === playerId;
    const who = mine ? `you → ${to.name}` : forMe ? `${from.name} → you` : `${from.name} ⇄ ${to.name}`;
    // Someone else has this offer open in front of them right now.
    const watchers = state.players.filter(
        (p) => p.id !== playerId && p.activity?.kind === 'viewing' && p.activity.tradeId === trade.id,
    );

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="flex flex-col gap-2 rounded-lg border p-2.5"
            style={{
                borderColor: forMe ? alpha('#7c5cff', 0.55) : 'var(--border)',
                background: forMe ? 'rgba(124,92,255,.08)' : 'rgba(255,255,255,.015)',
            }}
        >
            <button type="button" onClick={() => onOpen(trade)} className="flex flex-col gap-2 text-left">
                <div className="flex items-center gap-2">
                    <span
                        className="mono flex size-5 items-center justify-center rounded-full text-[8px] text-white"
                        style={{ background: from.color }}
                    >
                        {tag(from)}
                    </span>
                    <span className="flex-1 truncate text-[13px]">{who}</span>
                    {watchers.map((w) => (
                        <span key={w.id} title={`${w.name} is looking at this`} className="shrink-0">
                            <Eye className="size-3.5" style={{ color: w.color }} />
                        </span>
                    ))}
                    <span className="label !text-[9px]">waiting</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate">{sideSummary(state, trade.give)}</span>
                    <ArrowLeftRight className="size-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-right">{sideSummary(state, trade.get)}</span>
                </div>
            </button>

            {(forMe || mine) && (
                <div className="flex gap-1.5">
                    {forMe && (
                        <>
                            <Button
                                size="sm"
                                className="flex-1"
                                onClick={() => send('trade:respond', { tradeId: trade.id, response: 'accept' })}
                            >
                                Accept
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => onCounter(trade)}>
                                Counter
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="flex-1"
                                onClick={() => send('trade:respond', { tradeId: trade.id, response: 'decline' })}
                            >
                                Decline
                            </Button>
                        </>
                    )}
                    {mine && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1"
                            onClick={() => send('trade:respond', { tradeId: trade.id, response: 'cancel' })}
                        >
                            Cancel offer
                        </Button>
                    )}
                </div>
            )}
        </motion.div>
    );
}

export function TradeRail({ onNew, onOpen, onCounter }) {
    const { state, playerId } = useGame();
    const [tab, setTab] = useState('forMe');

    // Resolved trades are dropped server-side, so everything here is live.
    const groups = useMemo(
        () => ({
            forMe: state.trades.filter((t) => t.toId === playerId),
            sent: state.trades.filter((t) => t.fromId === playerId),
            all: state.trades,
        }),
        [state.trades, playerId],
    );
    const list = groups[tab];

    return (
        <section className="panel flex min-h-0 flex-1 flex-col">
            <header className="panel-divider flex items-center justify-between px-4 py-3">
                <span className="label">Trades</span>
                <Button size="xs" variant="outline" onClick={() => onNew()}>
                    <Plus /> new
                </Button>
            </header>
            <div className="flex gap-1.5 px-3 pt-3">
                {[
                    ['forMe', 'for me'],
                    ['sent', 'sent'],
                    ['all', 'all'],
                ].map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`mono rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
                            tab === key
                                ? 'border-primary/60 bg-primary/20 text-foreground'
                                : 'border-white/10 text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {label} {groups[key].length}
                    </button>
                ))}
            </div>
            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                <AnimatePresence initial={false}>
                    {list.map((t) => (
                        <TradeCard key={t.id} trade={t} onOpen={onOpen} onCounter={onCounter} />
                    ))}
                </AnimatePresence>
                {list.length === 0 && <p className="px-1 py-2 text-[13px] text-muted-foreground">No open trades.</p>}
            </div>
        </section>
    );
}
