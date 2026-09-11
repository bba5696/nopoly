import { useState } from 'react';
import { Banknote, TriangleAlert } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { FLAG_SRC } from '@/lib/emblems';

/**
 * A stake you hold, and what can be done with it.
 *
 * This exists because tapping a share used to sell it. One click, no price, no
 * confirmation, nothing said about what was being given up — and selling is
 * the one thing here you cannot undo, since the country's other stake may be
 * gone by the time you want back in. A deed has had a panel like this all
 * along; a quarter of a country is not a smaller decision than a deed.
 */
export function ShareInfoModal({ groupId, onClose }) {
    const { state, playerId, board, send } = useGame();
    const [confirming, setConfirming] = useState(false);
    if (!groupId) return null;

    const share = (state.shares || []).find((sh) => sh.groupId === groupId && sh.holderId === playerId);
    if (!share) return null;

    const group = board?.groups?.[groupId];
    const color = group?.color || '#7dd3fc';
    const cut = Math.round((state.shareCut ?? 0.25) * 100);
    // From the server: it follows the country's rent and the laps held, and
    // is null once the stake is held for good.
    const buyback = share.buyback ?? null;
    const ladder = state.buybackLadder || [1.5, 2, 3];
    const laps = share.laps || 0;
    const lapsLeft = Math.max(0, ladder.length - laps);
    const worth = state.sharePrices?.[groupId] ?? share.paid;

    // Who could take it off you, and who is paying you when rent lands.
    const tiles = (state.tiles || []).filter((t) => t.groupId === groupId);
    const owners = [...new Set(tiles.map((t) => t.ownerId).filter(Boolean))]
        .map((id) => state.players.find((p) => p.id === id))
        .filter(Boolean);
    const built = tiles.reduce((n, t) => n + (t.houses || 0), 0);

    const sell = () => {
        send('share:sell', { groupId });
        onClose();
    };

    return (
        <Modal open onClose={onClose} title={group?.name || groupId} subtitle={`${cut}% share`} width={420}>
            <div className="flex flex-col gap-4 px-5 py-4">
                <div
                    className="flex items-center gap-3 rounded-xl border px-4 py-3"
                    style={{ borderColor: alpha(color, 0.45), background: alpha(color, 0.1) }}
                >
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#12121a]">
                        {FLAG_SRC[groupId] && <img src={FLAG_SRC[groupId]} alt="" className="size-full object-cover" />}
                    </span>
                    <span className="flex min-w-0 flex-col">
                        <span className="text-[15px]">You hold {cut}% of {group?.name || groupId}</span>
                        <span className="text-[12px] text-muted-foreground">
                            {cut}% of every rent collected there comes to you, out of the owner's share — not the bank's.
                        </span>
                    </span>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">You paid</span>
                        <span className="mono">{money(share.paid)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">The bank buys it back at</span>
                        <span className="mono">{money(share.paid)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">A new share here costs</span>
                        <span className="mono">{money(worth)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">A deed holder can take it for</span>
                        {buyback === null ? (
                            <span className="text-[#3ddc97]">nobody can — it's yours</span>
                        ) : (
                            <span className="mono text-[#ffb648]">{money(buyback)}</span>
                        )}
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">Safe from buy-back</span>
                        <span>
                            {buyback === null
                                ? 'locked in'
                                : `after ${lapsLeft} more lap${lapsLeft === 1 ? '' : 's'}`}
                        </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
                        <span className="text-muted-foreground">Paying you</span>
                        <span className="truncate text-right">
                            {owners.length ? owners.map((o) => o.name).join(', ') : 'nobody yet — unowned'}
                            {built ? ` · ${built} built` : ''}
                        </span>
                    </div>
                </div>

                {/* The thing you would want to have been told before selling. */}
                <p className="flex items-start gap-2 rounded-lg border border-white/8 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#ffb648]" />
                    <span>
                        Selling is final, and the bank only gives back what you paid — {money(share.paid)}, even if a
                        share here now costs {money(worth)}. A trade can get you what it's actually worth.
                    </span>
                </p>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-4">
                <span className="label">
                    {confirming ? 'This cannot be undone' : `Sell back for ${money(share.paid)}`}
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" className="h-10 px-4" onClick={onClose}>
                        Keep it
                    </Button>
                    <Button
                        className="h-10 px-5"
                        variant={confirming ? 'default' : 'outline'}
                        onClick={() => (confirming ? sell() : setConfirming(true))}
                    >
                        <Banknote /> {confirming ? `Yes — sell for ${money(share.paid)}` : 'Sell back'}
                    </Button>
                </div>
            </footer>
        </Modal>
    );
}
