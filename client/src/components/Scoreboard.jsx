import { useCallback, useMemo, useState } from 'react';
import { Check, Copy, Download, Share2, Trophy } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { money, shortMoney } from '@/lib/board-layout';
import { alpha, tag } from '@/lib/color';
import { durationOf } from '@/lib/history';
import { shareCardBlob, shareFileName } from '@/lib/share-card';
import { createShareLink, timeLeft } from '@/lib/share-link';

/**
 * The end of a game, drawn from a plain record rather than from the live room.
 *
 * Split out of GameOver so a game saved to the history draws exactly the same
 * screen as the one that just finished — two renderings of the same numbers
 * would drift, and the whole point of keeping a game is looking at the screen
 * you remember.
 */

/**
 * Everyone's standing at the turn under the cursor, richest first — the point
 * of hovering a line this crowded is to find out who was ahead, which reading
 * eight overlapping strokes will not tell you.
 */
function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    const rows = payload.slice().sort((a, b) => b.value - a.value);
    return (
        <div className="panel flex min-w-[180px] flex-col gap-1.5 px-3 py-2.5 text-[12px]">
            <span className="label">turn {label}</span>
            {rows.map((p, i) => (
                <span key={p.dataKey} className="flex items-center gap-2">
                    <span className="mono w-3 text-[10px] text-muted-foreground">{i + 1}</span>
                    <span className="size-2 rounded-full" style={{ background: p.color }} />
                    <span className="flex-1 truncate">{p.dataKey}</span>
                    <span className="mono text-muted-foreground">{money(p.value)}</span>
                </span>
            ))}
        </div>
    );
}

/**
 * Save the chart as a picture, or hand it straight to whatever the device
 * shares with.
 *
 * Three buttons rather than one because no single route works everywhere:
 * phones have a share sheet and no filesystem worth speaking of, desktop
 * browsers have a clipboard that pastes into Discord, and a download is the one
 * that always works. Whichever is missing is simply not offered.
 */
export function ShareCard({ card, entry, flash }) {
    const [done, setDone] = useState(null);
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState(null);
    // Shown on the row itself rather than only through `flash`: this component
    // renders in three places and only one of them is inside the game context,
    // so a failure that went to `flash` alone was a button that did nothing.
    const [problem, setProblem] = useState(null);

    const report = useCallback(
        (message) => {
            setProblem(message);
            flash?.(message);
            setTimeout(() => setProblem(null), 6000);
        },
        [flash],
    );

    const build = useCallback(async () => {
        const blob = await shareCardBlob(card);
        if (!blob) throw new Error('The picture came out empty');
        return { card, blob };
    }, [card]);

    const run = useCallback(
        async (what, fn) => {
            if (busy) return;
            setBusy(true);
            try {
                await fn(await build());
                setDone(what);
                setTimeout(() => setDone(null), 2200);
            } catch (err) {
                // A cancelled share sheet throws the same as a failure, and
                // telling someone their own cancel went wrong is worse noise
                // than saying nothing.
                if (err?.name !== 'AbortError') report(`Could not ${what === 'saved' ? 'save' : 'copy'} the image`);
            } finally {
                setBusy(false);
            }
        },
        [build, busy, report],
    );

    /**
     * A link somebody else can open, for as long as the server holds it.
     *
     * The picture works everywhere and forever; a link is the thing you can
     * paste into a chat and have somebody scroll the chart themselves. It is
     * made on demand rather than for every game, because making one puts the
     * end screen on the server and that should be a decision.
     */
    const makeLink = useCallback(async () => {
        if (busy || !entry) return;
        setBusy(true);
        setProblem(null);
        try {
            const made = await createShareLink({ ...entry, nickname: card?.title || entry.nickname || '' });
            setLink(made);
            // The device's own share sheet where there is one, the clipboard
            // otherwise — and the link stays on screen either way, so a
            // refused permission or a cancelled sheet costs nothing.
            const copy = async () => {
                try {
                    await navigator.clipboard?.writeText(made.url);
                    return 'link copied';
                } catch {
                    // No clipboard permission. The link is on screen, which is
                    // the whole reason it is shown rather than only copied.
                    return 'link ready';
                }
            };
            if (navigator.share) {
                try {
                    await navigator.share({ url: made.url, title: card?.title || 'Nopoly' });
                    setDone('shared');
                } catch {
                    // Cancelled, or a browser that offers the sheet and then
                    // refuses it. Either way the clipboard still works.
                    setDone(await copy());
                }
            } else {
                setDone(await copy());
            }
            setTimeout(() => setDone(null), 2600);
        } catch (err) {
            report(err.message || 'Could not make a link');
        } finally {
            setBusy(false);
        }
    }, [busy, card, entry, report]);

    const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

    return (
        <div className="flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
            {done && (
                <span className="mono flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Check className="size-3" /> {done}
                </span>
            )}
            {!!entry && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={makeLink} title="A link anyone can open for the next hour">
                    <Share2 /> Share
                </Button>
            )}
            {canCopy && (
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                        run('copied', ({ blob }) =>
                            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
                        )
                    }
                >
                    <Copy /> Copy
                </Button>
            )}
            <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                    run('saved', ({ card: c, blob }) => {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = shareFileName(c);
                        a.click();
                        // Revoked a beat later: Safari has not finished with the
                        // URL when click() returns, and loses the file.
                        setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    })
                }
            >
                <Download /> Save image
            </Button>
        </div>
        {problem && (
            <span className="max-w-[42ch] text-right text-[11px] leading-snug text-[#ff9db2]">{problem}</span>
        )}
        {/* Shown rather than only copied: a clipboard write can be refused,
            and a link nobody can read is a link nobody can send. */}
        {link && (
            <span className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
                <span className="mono max-w-[42ch] truncate rounded-md border border-white/10 bg-black/25 px-2 py-1 text-foreground">
                    {link.url}
                </span>
                expires in {timeLeft(link.expiresAt)}
            </span>
        )}
        </div>
    );
}

export function Scoreboard({ entry, flash, aside }) {
    const players = entry.players;
    const winnerIds = useMemo(() => new Set(entry.winnerIds), [entry.winnerIds]);
    const winners = players.filter((p) => winnerIds.has(p.id));

    const standings = useMemo(
        () =>
            players
                .slice()
                .sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth),
        [players],
    );

    // Recharts wants a row per turn keyed by name; the record keeps it keyed by
    // player id, which is what survives a rename.
    const chart = useMemo(
        () =>
            (entry.series || []).map((point) => {
                const row = { turn: point.turn };
                for (const p of players) row[p.name] = point.values[p.id] ?? 0;
                return row;
            }),
        [entry.series, players],
    );

    // Painted in declaration order, so the order is the z-order — losers first,
    // the winner last and on top.
    const drawOrder = players
        .slice()
        .sort((a, b) => Number(winnerIds.has(a.id)) - Number(winnerIds.has(b.id)));

    const facts = [
        { k: 'Duration', v: durationOf(entry) },
        { k: 'Turns', v: String(entry.facts.turnCount) },
        { k: 'Doubles rolled', v: String(entry.facts.doubles) },
        { k: 'Trades made', v: String(entry.facts.trades) },
        { k: 'Chat messages', v: String(entry.facts.chatMessages) },
    ];
    const champion = winners[0];

    return (
        <div className="grid w-full max-w-[1120px] gap-5 lg:grid-cols-[440px_minmax(0,1fr)]">
            <div className="flex flex-col gap-5">
                <section
                    className="panel flex items-center gap-5 p-6"
                    style={champion ? { boxShadow: `0 0 60px -20px ${alpha(champion.color, 0.8)}` } : undefined}
                >
                    <div
                        className="flex size-14 items-center justify-center rounded-2xl"
                        style={{
                            background: champion ? alpha(champion.color, 0.16) : 'rgba(255,255,255,.06)',
                            color: champion?.color || 'var(--muted-foreground)',
                        }}
                    >
                        <Trophy className="size-7" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="label">
                            {entry.winnerTeam ? `Winning team · ${entry.winnerTeam}` : 'Winner'}
                        </span>
                        <div className="flex flex-wrap items-center gap-2.5">
                            {winners.map((w) => (
                                <span key={w.id} className="flex items-center gap-2">
                                    <span
                                        className="mono flex size-7 items-center justify-center rounded-full text-[10px] text-white"
                                        style={{ background: w.color }}
                                    >
                                        {tag(w)}
                                    </span>
                                    <span className="text-3xl font-medium">{w.name}</span>
                                </span>
                            ))}
                            {winners.length === 0 && <span className="text-3xl font-medium">Nobody</span>}
                        </div>
                    </div>
                </section>

                {/* Whatever the caller wants under the trophy: the nickname
                    field for a saved game, nothing for a live one. */}
                {aside}

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
                        <span className="text-lg">{entry.mostVisited?.name || '—'}</span>
                        <span className="mono text-[11px] text-muted-foreground">
                            {entry.mostVisited ? `${entry.mostVisited.count} landings` : ''}
                        </span>
                    </section>
                    <section className="panel flex flex-col gap-1 p-4">
                        <span className="label">Most time in jail</span>
                        <span className="text-lg">{entry.mostJail?.name || '—'}</span>
                        <span className="mono text-[11px] text-muted-foreground">
                            {entry.mostJail ? `${entry.mostJail.count} visits` : ''}
                        </span>
                    </section>
                </div>
            </div>

            <div className="flex flex-col gap-5">
                <section className="panel flex flex-col gap-4 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xl">Net worth over time</span>
                        <ShareCard card={entry.card} entry={entry} flash={flash} />
                    </div>
                    <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chart} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                                <defs>
                                    {players.map((p) => (
                                        <linearGradient key={p.id} id={`nw-${p.id}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={p.color} stopOpacity={0.34} />
                                            <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                                        </linearGradient>
                                    ))}
                                    {/* The winner's line is lit rather than just thicker, so the
                                        eye lands on it first in a chart with eight strokes in it. */}
                                    <filter id="nw-glow" x="-50%" y="-50%" width="200%" height="200%">
                                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                                        <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                        </feMerge>
                                    </filter>
                                </defs>
                                <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                                <XAxis
                                    dataKey="turn"
                                    tick={{ fill: '#8b88a0', fontSize: 11 }}
                                    tickLine={false}
                                    minTickGap={24}
                                    axisLine={{ stroke: 'rgba(255,255,255,.1)' }}
                                />
                                <YAxis
                                    tick={{ fill: '#8b88a0', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                    width={54}
                                    tickFormatter={shortMoney}
                                />
                                <Tooltip
                                    content={<ChartTooltip />}
                                    cursor={{ stroke: 'rgba(255,255,255,.22)', strokeDasharray: '3 3' }}
                                />
                                {drawOrder.map((p) => {
                                    const won = winnerIds.has(p.id);
                                    return (
                                        <Area
                                            key={p.id}
                                            type="monotone"
                                            dataKey={p.name}
                                            stroke={p.color}
                                            strokeWidth={won ? 3 : 1.9}
                                            strokeOpacity={won ? 1 : 0.85}
                                            fill={won ? `url(#nw-${p.id})` : 'transparent'}
                                            style={won ? { filter: 'url(#nw-glow)' } : undefined}
                                            dot={false}
                                            activeDot={{ r: 4, strokeWidth: 2, stroke: '#0b0a12' }}
                                            isAnimationActive={false}
                                        />
                                    );
                                })}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    {/* The legend doubles as the scoreboard: eight lines are only
                        identifiable if the colours are named, and the names may as
                        well carry what they ended on. */}
                    <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
                        {standings.map((p) => (
                            <span key={p.id} className="flex items-center gap-2 text-[14px]">
                                <span
                                    className="size-2.5 rounded-full"
                                    style={{ background: p.color, opacity: p.bankrupt ? 0.45 : 1 }}
                                />
                                <span className={p.bankrupt ? 'text-muted-foreground' : undefined}>{p.name}</span>
                                <span className="mono text-[11px] text-muted-foreground">
                                    {p.bankrupt ? 'bankrupt' : money(p.netWorth)}
                                </span>
                            </span>
                        ))}
                    </div>
                </section>

                <section className="panel flex min-h-0 flex-col">
                    <header className="panel-divider px-5 py-3">
                        <span className="label">
                            Final standings · {players.length} players
                            {entry.boardName ? ` · ${entry.boardName}` : ''}
                        </span>
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
                                    {tag(p)}
                                </span>
                                <span className="flex-1 truncate text-[16px]">{p.name}</span>
                                <span className="mono text-[12px] text-muted-foreground">
                                    {p.bankrupt ? 'bankrupt' : money(p.netWorth)}
                                </span>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
}
