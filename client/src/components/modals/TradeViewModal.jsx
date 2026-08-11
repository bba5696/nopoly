import { useEffect } from 'react';
import { ArrowLeftRight, Check, Repeat, Trash2, X } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha, initials } from '@/lib/color';
import { priceOf } from '@/lib/market';

/** One side of the offer: who, how much cash, and which properties. */
function Side({ player, side, tiles, groups }) {
    const max = Math.max(player.cash, side.cash, 1);
    return (
        <div className="flex flex-1 flex-col gap-3.5">
            <div className="flex items-center gap-2.5">
                <span
                    className="mono flex size-7 items-center justify-center rounded-full text-[10px] text-white"
                    style={{ background: player.color }}
                >
                    {initials(player.name)}
                </span>
                <span className="truncate text-lg">{player.name}</span>
            </div>

            <div className="flex flex-col gap-2">
                <div className="relative h-1.5 rounded-full bg-white/10">
                    <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${(side.cash / max) * 100}%`, background: player.color }}
                    />
                </div>
                <span
                    className="mono self-start rounded-full px-2.5 py-0.5 text-[12px] text-white"
                    style={{ background: side.cash > 0 ? player.color : 'rgba(255,255,255,.12)' }}
                >
                    {money(side.cash)}
                </span>
            </div>

            <div className="flex flex-col gap-1.5">
                {side.tiles.length === 0 && <span className="text-[13px] text-muted-foreground">No properties</span>}
                {side.tiles.map((id) => {
                    const tile = tiles[id];
                    const color = groups?.[tile.groupId]?.color || '#9aa0b5';
                    return (
                        <div
                            key={id}
                            className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
                            style={{ borderColor: alpha(color, 0.5), background: alpha(color, 0.12) }}
                        >
                            <span className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                            <span className="min-w-0 flex-1 truncate text-[14px]">{tile.name}</span>
                            <span className="mono shrink-0 text-[11px] text-muted-foreground">${priceOf(tile)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Read-only look at a live offer. What you can do with it depends on which end
 * of it you're on — the sender can pull it, the recipient can answer it, and
 * anyone else is just watching.
 */
export function TradeViewModal({ tradeId, onClose, onCounter }) {
    const { state, playerId, board, send } = useGame();
    const trade = state.trades.find((t) => t.id === tradeId) || null;

    // Tell the others someone's reading this offer.
    useEffect(() => {
        if (!tradeId) return;
        send('game:activity', { kind: 'viewing', tradeId });
        return () => send('game:activity', { kind: null });
    }, [tradeId, send]);

    // The offer can vanish underneath us — accepted, cancelled, or voided.
    useEffect(() => {
        if (tradeId && !trade) onClose();
    }, [tradeId, trade, onClose]);

    if (!trade) return null;
    const from = state.players.find((p) => p.id === trade.fromId);
    const to = state.players.find((p) => p.id === trade.toId);
    if (!from || !to) return null;

    const mine = trade.fromId === playerId;
    const forMe = trade.toId === playerId;
    const respond = (response) => {
        send('trade:respond', { tradeId: trade.id, response });
        onClose();
    };

    return (
        <Modal open onClose={onClose} title="View trade" width={620}>
            <div className="flex flex-col gap-6 p-6">
                <div className="flex items-stretch gap-4">
                    <Side player={from} side={trade.give} tiles={state.tiles} groups={board?.groups} />
                    <div className="flex w-10 items-center justify-center">
                        <div className="flex h-24 w-8 items-center justify-center rounded-full border border-white/10 text-muted-foreground">
                            <ArrowLeftRight className="size-4" />
                        </div>
                    </div>
                    <Side player={to} side={trade.get} tiles={state.tiles} groups={board?.groups} />
                </div>

                {(mine || forMe) && (
                    <div className="flex gap-2">
                        {forMe && (
                            <>
                                <Button className="h-11 flex-1" onClick={() => respond('accept')}>
                                    <Check /> Accept
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-11 flex-1"
                                    onClick={() => {
                                        onCounter(trade);
                                        onClose();
                                    }}
                                >
                                    <Repeat /> Counter
                                </Button>
                                <Button variant="ghost" className="h-11 flex-1" onClick={() => respond('decline')}>
                                    <X /> Decline
                                </Button>
                            </>
                        )}
                        {mine && (
                            <Button variant="destructive" className="h-11 flex-1" onClick={() => respond('cancel')}>
                                <Trash2 /> Delete trade
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}
