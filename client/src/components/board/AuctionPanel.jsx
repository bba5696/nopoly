import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gavel } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';
import { flagFor } from '@/lib/emblems';
import { lotGroup, lotGroupName, lotRent, lotStakes } from '@/lib/auction';
import { TileIcon } from './TileIcon';

/**
 * The auction, in the hole in the middle of the board.
 *
 * It used to be a modal over a blacked-out screen, which made the one question
 * everybody asks — is the person in front about to finish a country? — the one
 * thing you could not check. So it moved in here instead: it covers the dice and
 * the feed, which have nothing to say mid-auction, and leaves every tile on the
 * board visible and clickable. Board lights the country up to match.
 *
 * Losing the backdrop means losing what made an auction impossible to miss, so
 * the grabbing is done by this panel and the board together: it arrives hard,
 * its border pulses in the country's colour, the lot pulses in its slot, and the
 * last seconds of the clock go red.
 */

/** Ticks so the countdown and the bar stay live. */
function useCountdown(endsAt, length) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 200);
        return () => clearInterval(id);
    }, []);
    const remaining = Math.max(endsAt - now, 0);
    return { seconds: Math.ceil(remaining / 1000), fraction: Math.min(remaining / length, 1) };
}

/** Who the panel is talking about: whoever is winning, or you if nobody is. */
function subjectOf(state, auction, me) {
    if (auction.bidderId) return state.players.find((p) => p.id === auction.bidderId) || null;
    return me && !me.bankrupt ? me : null;
}

/**
 * The country as a row of slots, each in its owner's colour, the lot outlined.
 *
 * The short answer to "who owns what here", for the people who would otherwise
 * be counting tiles around the ring while the clock runs.
 */
function CountryStrip({ state, tile, color }) {
    const group = lotGroup(state, tile);
    if (group.length < 2) return null;
    return (
        <div className="flex flex-wrap items-center justify-center gap-1">
            {group.map((t) => {
                const owner = state.players.find((p) => p.id === t.ownerId);
                const lot = t.id === tile.id;
                return (
                    <span
                        key={t.id}
                        title={`${t.name}${owner ? ` — ${owner.name}` : ''}`}
                        className={cn(
                            'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none xl:text-[11px]',
                            lot && 'border-dashed',
                        )}
                        style={{
                            borderColor: alpha(owner?.color || (lot ? color : '#9aa0b5'), lot ? 0.9 : 0.45),
                            background: owner ? alpha(owner.color, 0.18) : 'transparent',
                        }}
                    >
                        <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{ background: owner?.color || 'rgba(255,255,255,.25)' }}
                        />
                        <span className="max-w-[72px] truncate">{lot ? 'this one' : owner?.name || t.name}</span>
                    </span>
                );
            })}
        </div>
    );
}

/**
 * What winning it would do for whoever is winning it. The line the table is
 * really bidding against.
 */
function Stakes({ state, board, tile, subject, leading }) {
    if (!subject) return null;
    const { total, after, completes } = lotStakes(state, tile, subject.id);
    const rent = lotRent(state, tile, subject.id);
    const who = leading ? subject.name : 'you';
    const name = lotGroupName(state, tile, board);
    if (total < 2) return null;

    return (
        <div className="flex flex-col items-center gap-0.5 text-center">
            <span className={cn('text-[12px] leading-tight xl:text-[15px]', completes && 'font-medium')}>
                {completes ? (
                    <>
                        <span style={{ color: subject.color }}>{who}</span> would complete{' '}
                        <span className="font-medium">{name}</span>
                    </>
                ) : (
                    <>
                        <span style={{ color: subject.color }}>{who}</span> would hold {after} of {total} in{' '}
                        {name}
                    </>
                )}
            </span>
            {rent && (
                <span className="mono text-[10.5px] text-muted-foreground xl:text-[12px]">
                    rent {rent.now} → <span className="text-[#ffb648]">{rent.then}</span> · {rent.why}
                </span>
            )}
        </div>
    );
}

/**
 * The bids. Separate from the panel because on a phone the ring's middle is a
 * couple of hundred pixels across — the same reason the turn's buttons live in
 * the bar under the board there, and these go with them.
 */
export function AuctionBids({ wide = false }) {
    const { state, me, send } = useGame();
    const auction = state.auction;
    if (!auction || !me) return null;
    if (me.bankrupt) return <span className="label">you're out of the game</span>;

    return (
        <div className={cn('flex w-full flex-col gap-1', wide && 'px-1')}>
            <div className="flex gap-1.5">
                {(state.bidSteps || [2, 10, 100]).map((step, i) => {
                    // Before anyone has bid the cheapest option is the reserve
                    // itself, not the reserve plus a raise.
                    const opening = !auction.bidderId;
                    const amount = opening ? auction.nextBid + (i === 0 ? 0 : step) : auction.bid + step;
                    const affordable = amount <= me.cash && amount >= auction.nextBid;
                    return (
                        <Button
                            key={step}
                            className={cn('h-auto flex-1 flex-col gap-0.5 py-1.5', wide && 'py-2.5')}
                            disabled={!affordable}
                            onClick={() => send('auction:bid', { amount })}
                        >
                            <span className="mono text-[13px] font-semibold xl:text-base">{money(amount)}</span>
                            <span className="mono text-[9px] opacity-75 xl:text-[10px]">
                                {opening && i === 0 ? 'reserve' : `+${money(step)}`}
                            </span>
                        </Button>
                    );
                })}
            </div>
            <span className="label text-center opacity-70">your cash {money(me.cash)}</span>
        </div>
    );
}

export function AuctionPanel() {
    const { state, me, board } = useGame();
    const auction = state.auction;
    const { seconds, fraction } = useCountdown(auction?.endsAt ?? 0, state.auctionMs || 10000);
    if (!auction) return null;

    const tile = state.tiles[auction.tileId];
    const group = tile.groupId ? board?.groups?.[tile.groupId] : null;
    const color = group?.color || (tile.type === 'airport' ? '#9aa0b5' : '#7dd3fc');
    const flag = flagFor(tile);
    const leader = auction.bidderId ? state.players.find((p) => p.id === auction.bidderId) : null;
    const subject = subjectOf(state, auction, me);
    // The last breath of the clock, where a raise is still worth trying.
    const urgent = seconds <= 3;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 26 }}
            className="auction-panel flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border px-2 py-1.5 xl:gap-3 xl:px-5 xl:py-4"
            style={{
                borderColor: alpha(color, 0.55),
                background: `radial-gradient(70% 70% at 50% 0%, ${alpha(color, 0.16)}, transparent 75%), rgba(10,10,16,.72)`,
                '--auction-color': alpha(color, 0.5),
            }}
        >
            <span className="label flex items-center gap-1.5" style={{ color }}>
                <Gavel className="size-3" /> Auction
            </span>

            <div className="flex min-w-0 items-center gap-2">
                <span
                    className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#12121a] xl:size-8"
                    style={{ boxShadow: `0 0 0 2px ${alpha(color, 0.6)}` }}
                >
                    {flag ? (
                        <img src={flag} alt="" className="size-full object-cover" />
                    ) : (
                        <TileIcon tile={tile} className="text-[1rem]" />
                    )}
                </span>
                <span className="truncate text-base leading-tight font-medium xl:text-2xl">{tile.name}</span>
            </div>

            <div className="flex items-baseline gap-2">
                <motion.span
                    key={auction.bid}
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    className="mono text-xl leading-none xl:text-4xl"
                >
                    {money(auction.bid)}
                </motion.span>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground xl:text-[13px]">
                    {leader ? (
                        <>
                            leading:{' '}
                            <span style={{ color: leader.color }}>{leader.id === me?.id ? 'you' : leader.name}</span>
                        </>
                    ) : (
                        `reserve ${money(auction.nextBid)}`
                    )}
                </span>
            </div>

            <div className="flex w-full max-w-[280px] flex-col gap-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <motion.div
                        className="h-full rounded-full"
                        animate={{
                            width: `${fraction * 100}%`,
                            backgroundColor: urgent ? '#ff5c7c' : 'var(--primary)',
                        }}
                        transition={{ duration: 0.2, ease: 'linear' }}
                    />
                </div>
                <span
                    className={cn(
                        'label text-center',
                        urgent && 'animate-pulse font-semibold text-[#ff5c7c] opacity-100',
                    )}
                >
                    {seconds}s
                </span>
            </div>

            <CountryStrip state={state} tile={tile} color={color} />
            <Stakes state={state} board={board} tile={tile} subject={subject} leading={!!leader} />

            {/* Below xl these are in the bar under the board, where a thumb can
                reach them — the same trade the turn's buttons make. */}
            <div className="hidden w-full max-w-[300px] xl:block">
                <AuctionBids />
            </div>
        </motion.div>
    );
}
