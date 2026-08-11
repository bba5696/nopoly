import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Gavel } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { rentTable } from '@/lib/rent';
import { alpha } from '@/lib/color';
import { flagFor } from '@/lib/emblems';
import { TileIcon } from '@/components/board/TileIcon';

const AUCTION_MS = 12000;

/** Ticks once a second so the countdown and the bar stay live. */
function useCountdown(endsAt) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, []);
    const remaining = Math.max(endsAt - now, 0);
    return { seconds: Math.ceil(remaining / 1000), fraction: Math.min(remaining / AUCTION_MS, 1) };
}

export function AuctionModal() {
    const { state, me, board, send } = useGame();
    const auction = state.auction;
    const { seconds, fraction } = useCountdown(auction?.endsAt ?? 0);
    if (!auction || !me) return null;

    const tile = state.tiles[auction.tileId];
    const group = tile.groupId ? board?.groups?.[tile.groupId] : null;
    const color = group?.color || (tile.type === 'airport' ? '#9aa0b5' : '#7dd3fc');
    const flag = flagFor(tile);
    const leader = auction.bidderId ? state.players.find((p) => p.id === auction.bidderId) : null;
    const out = me.bankrupt;

    return (
        <Modal open dismissable={false} width={640}>
            <div className="flex flex-col gap-5 p-6">
                <div className="flex flex-col items-center gap-2">
                    <span className="label flex items-center gap-1.5">
                        <Gavel className="size-3" /> Auction
                    </span>
                    <div className="flex items-center gap-3">
                        <span
                            className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-[#12121a]"
                            style={{ boxShadow: `0 0 0 2px ${alpha(color, 0.6)}` }}
                        >
                            {flag ? (
                                <img src={flag} alt="" className="size-full object-cover" />
                            ) : (
                                <TileIcon tile={tile} className="text-[1.3rem]" />
                            )}
                        </span>
                        <h2 className="text-3xl font-medium">{tile.name}</h2>
                    </div>
                </div>

                <div className="flex flex-col gap-5 sm:flex-row">
                    <div className="flex flex-1 flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <span className="label">Current bid</span>
                            <motion.span key={auction.bid} initial={{ scale: 0.92 }} animate={{ scale: 1 }} className="mono text-3xl">
                                {money(auction.bid)}
                            </motion.span>
                            <span className="text-[13px] text-muted-foreground">
                                {leader ? (
                                    <>
                                        leading:{' '}
                                        <span style={{ color: leader.color }}>
                                            {leader.id === me.id ? 'you' : leader.name}
                                        </span>
                                    </>
                                ) : (
                                    `no bids yet — reserve ${money(auction.nextBid)}`
                                )}
                            </span>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="label">Ends in {seconds}s</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                <motion.div
                                    className="h-full rounded-full bg-primary"
                                    animate={{ width: `${fraction * 100}%` }}
                                    transition={{ duration: 0.25, ease: 'linear' }}
                                />
                            </div>
                        </div>

                        {out ? (
                            <span className="label">you're out of the game</span>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <span className="label">I'm bidding…</span>
                                <div className="flex gap-2">
                                    {(state.bidSteps || [2, 10, 100]).map((step, i) => {
                                        // Before anyone has bid the cheapest option is the
                                        // reserve itself, not the reserve plus a raise.
                                        const opening = !auction.bidderId;
                                        const amount = opening
                                            ? auction.nextBid + (i === 0 ? 0 : step)
                                            : auction.bid + step;
                                        const affordable = amount <= me.cash && amount >= auction.nextBid;
                                        return (
                                            <Button
                                                key={step}
                                                className="h-auto flex-1 flex-col gap-0.5 py-2"
                                                disabled={!affordable}
                                                onClick={() => send('auction:bid', { amount })}
                                            >
                                                <span className="mono text-base font-semibold">{money(amount)}</span>
                                                <span className="mono text-[10px] opacity-75">
                                                    {opening && i === 0 ? 'reserve' : `+${money(step)}`}
                                                </span>
                                            </Button>
                                        );
                                    })}
                                </div>
                                <span className="label text-center opacity-70">your cash {money(me.cash)}</span>
                            </div>
                        )}
                    </div>

                    <div
                        className="flex w-full flex-col gap-2 rounded-xl border p-4 sm:w-[250px]"
                        style={{ borderColor: alpha(color, 0.35), background: alpha(color, 0.06) }}
                    >
                        <span className="mb-1 text-center text-lg" style={{ color }}>
                            {tile.name}
                        </span>
                        <div className="flex justify-between border-b border-white/10 pb-1.5">
                            <span className="label">when</span>
                            <span className="label">get</span>
                        </div>
                        {rentTable(state, tile).map((r) => (
                            <div key={r.k} className="mono flex justify-between text-[12px]">
                                <span className="text-muted-foreground">{r.k}</span>
                                <span>{r.v}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
