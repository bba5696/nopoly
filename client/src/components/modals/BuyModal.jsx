import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { rentTable } from '@/lib/rent';
import { alpha } from '@/lib/color';
import { priceOf, trendColor, trendOf } from '@/lib/market';

/** Shown to the player who just landed on an unowned property. */
export function BuyModal({ open }) {
    const { state, me, board, send } = useGame();
    const action = state.pendingAction;
    const tile = action ? state.tiles[action.tileId] : null;
    if (!tile || !me) return null;

    const group = board?.groups?.[tile.groupId];
    const color = group?.color || (tile.type === 'airport' ? '#9aa0b5' : '#7dd3fc');
    const price = priceOf(tile);
    const trend = trendOf(tile);

    return (
        <Modal open={open} subtitle="Unowned property" title={tile.name} width={440} dismissable={false}>
            <div className="flex flex-col gap-5 p-5">
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: alpha(color, 0.4) }}>
                    <div
                        className="mono flex h-9 items-center justify-center text-[11px] tracking-[0.1em] text-black/85"
                        style={{ background: color }}
                    >
                        {(group?.name || tile.type).toUpperCase()}
                    </div>
                    <div className="flex flex-col gap-1.5 p-4" style={{ background: alpha(color, 0.05) }}>
                        {rentTable(state, tile).map((r) => (
                            <div
                                key={r.k}
                                className="mono flex justify-between border-b border-dashed border-white/8 pb-1.5 text-[12px] last:border-0"
                            >
                                <span className="text-muted-foreground">{r.k}</span>
                                <span>{r.v}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col gap-2.5">
                    <Button
                        className="h-12 text-lg"
                        disabled={me.cash < price}
                        onClick={() => send('game:buy')}
                    >
                        Buy for {money(price)}
                    </Button>
                    <Button variant="outline" className="h-11 text-base" onClick={() => send('game:decline')}>
                        {state.settings.auction ? 'Send to auction' : 'Pass'}
                    </Button>
                </div>

                <div className="mono flex justify-between text-[11px] text-muted-foreground">
                    {trend ? (
                        <span style={{ color: trendColor(trend) }}>
                            {trend.up ? '▲' : '▼'} {trend.pct}% vs book {money(tile.price)}
                        </span>
                    ) : (
                        <span>after purchase {money(me.cash - price)}</span>
                    )}
                    <span>balance {money(me.cash)}</span>
                </div>
            </div>
        </Modal>
    );
}
