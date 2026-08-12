import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { money, shortMoney } from '@/lib/board-layout';
import { alpha, initials } from '@/lib/color';

function duration(stats) {
    if (!stats.startedAt) return '—';
    const ms = (stats.endedAt || Date.now()) - stats.startedAt;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins} min ${secs} sec`;
}

function topEntry(map) {
    const entries = Object.entries(map || {});
    if (!entries.length) return null;
    return entries.sort((a, b) => b[1] - a[1])[0];
}

function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div className="panel flex flex-col gap-1 px-3 py-2 text-[12px]">
            <span className="label">turn {label}</span>
            {payload
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((p) => (
                    <span key={p.dataKey} className="mono" style={{ color: p.color }}>
                        {p.dataKey} · {money(p.value)}
                    </span>
                ))}
        </div>
    );
}

export function GameOver() {
    const { state, isHost, send, leaveRoom } = useGame();
    const winner = state.players.find((p) => p.id === state.winnerId);
    // A team wins as a team — both names on the trophy, not just whoever the
    // server happened to list first.
    const winners = state.winnerTeam
        ? state.players.filter((p) => p.teamId === state.winnerTeam && !p.bankrupt)
        : [winner].filter(Boolean);

    const standings = useMemo(
        () =>
            state.players
                .slice()
                .sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth),
        [state.players],
    );

    const chart = useMemo(() => {
        return state.stats.netWorth.map((point) => {
            const row = { turn: point.turn };
            for (const p of state.players) row[p.name] = point.values[p.id] ?? 0;
            return row;
        });
    }, [state.stats.netWorth, state.players]);

    const mostVisited = topEntry(state.stats.visits);
    const mostJail = topEntry(state.stats.jailVisits);
    const jailPlayer = mostJail && state.players.find((p) => p.id === mostJail[0]);

    const facts = [
        { k: 'Duration', v: duration(state.stats) },
        { k: 'Turns', v: String(state.stats.turnCount) },
        { k: 'Doubles rolled', v: String(state.stats.doubles) },
        { k: 'Trades made', v: String(state.stats.trades) },
        { k: 'Chat messages', v: String(state.stats.chatMessages) },
    ];

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid w-full max-w-[1120px] gap-5 lg:grid-cols-[440px_minmax(0,1fr)]"
            >
                <div className="flex flex-col gap-5">
                    <section
                        className="panel flex items-center gap-5 p-6"
                        style={winner ? { boxShadow: `0 0 60px -20px ${alpha(winner.color, 0.8)}` } : undefined}
                    >
                        <div
                            className="flex size-14 items-center justify-center rounded-2xl"
                            style={{
                                background: winner ? alpha(winner.color, 0.16) : 'rgba(255,255,255,.06)',
                                color: winner?.color || 'var(--muted-foreground)',
                            }}
                        >
                            <Trophy className="size-7" />
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="label">{state.winnerTeam ? `Winning team · ${state.winnerTeam}` : 'Winner'}</span>
                            <div className="flex flex-wrap items-center gap-2.5">
                                {winners.map((w) => (
                                    <span key={w.id} className="flex items-center gap-2">
                                        <span
                                            className="mono flex size-7 items-center justify-center rounded-full text-[10px] text-white"
                                            style={{ background: w.color }}
                                        >
                                            {initials(w.name)}
                                        </span>
                                        <span className="text-3xl font-medium">{w.name}</span>
                                    </span>
                                ))}
                                {winners.length === 0 && <span className="text-3xl font-medium">Nobody</span>}
                            </div>
                        </div>
                    </section>

                    <section className="panel flex flex-col px-6 py-2">
                        {facts.map((f) => (
                            <div key={f.k} className="flex flex-col border-b border-dashed border-white/8 py-3 last:border-0">
                                <span className="label">{f.k}</span>
                                <span className="text-xl">{f.v}</span>
                            </div>
                        ))}
                    </section>

                    <div className="grid grid-cols-2 gap-4">
                        <section className="panel flex flex-col gap-1 p-4">
                            <span className="label">Most visited</span>
                            <span className="text-lg">{mostVisited ? state.tiles[mostVisited[0]].name : '—'}</span>
                            <span className="mono text-[11px] text-muted-foreground">
                                {mostVisited ? `${mostVisited[1]} landings` : ''}
                            </span>
                        </section>
                        <section className="panel flex flex-col gap-1 p-4">
                            <span className="label">Most time in jail</span>
                            <span className="text-lg">{jailPlayer?.name || '—'}</span>
                            <span className="mono text-[11px] text-muted-foreground">
                                {mostJail ? `${mostJail[1]} visits` : ''}
                            </span>
                        </section>
                    </div>
                </div>

                <div className="flex flex-col gap-5">
                    <section className="panel flex flex-col gap-4 p-6">
                        <span className="text-xl">Net worth over time</span>
                        <div className="h-[260px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                                    <XAxis
                                        dataKey="turn"
                                        tick={{ fill: '#8b88a0', fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={{ stroke: 'rgba(255,255,255,.1)' }}
                                    />
                                    <YAxis
                                        tick={{ fill: '#8b88a0', fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={false}
                                        width={54}
                                        tickFormatter={shortMoney}
                                    />
                                    <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(255,255,255,.15)' }} />
                                    {state.players.map((p) => (
                                        <Line
                                            key={p.id}
                                            type="monotone"
                                            dataKey={p.name}
                                            stroke={p.color}
                                            strokeWidth={2}
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
                            {state.players.map((p) => (
                                <span key={p.id} className="flex items-center gap-2 text-[14px]">
                                    <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                                    {p.name}
                                </span>
                            ))}
                        </div>
                    </section>

                    <section className="panel flex min-h-0 flex-col">
                        <header className="panel-divider px-5 py-3">
                            <span className="label">Final standings · {state.players.length} players</span>
                        </header>
                        <div className="scroll-thin max-h-[220px] overflow-y-auto">
                            {standings.map((p, i) => (
                                <div
                                    key={p.id}
                                    className="flex items-center gap-3 border-b border-dashed border-white/8 px-5 py-2.5 last:border-0"
                                >
                                    <span className="mono w-5 text-[12px] text-muted-foreground">{i + 1}</span>
                                    <span
                                        className="mono flex size-6 items-center justify-center rounded-full text-[9px] text-white"
                                        style={{ background: p.color, opacity: p.bankrupt ? 0.4 : 1 }}
                                    >
                                        {initials(p.name)}
                                    </span>
                                    <span className="flex-1 truncate text-[16px]">{p.name}</span>
                                    <span className="mono text-[12px] text-muted-foreground">
                                        {p.bankrupt ? 'bankrupt' : money(p.netWorth)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <div className="flex gap-3">
                        <Button className="h-13 flex-1 text-base" style={{ height: 52 }} disabled={!isHost} onClick={() => send('game:rematch')}>
                            Another game
                        </Button>
                        <Button variant="outline" className="flex-1 text-base" style={{ height: 52 }} onClick={leaveRoom}>
                            Back to home
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
