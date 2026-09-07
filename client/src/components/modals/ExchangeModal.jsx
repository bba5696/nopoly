import { TrendingUp } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { FLAG_SRC } from '@/lib/emblems';
import { cn } from '@/lib/utils';

/**
 * The exchange, opened by landing on one.
 *
 * Every country on one screen, because the tile is a market rather than a
 * stock: a tile tied to one country would be dead the four times out of five
 * you land on it holding the wrong hand. Sorted by what a country is currently
 * earning, so the ones worth buying into are at the top rather than the ones
 * that merely cost the most.
 */
export function ExchangeModal() {
    const { state, me, board, send } = useGame();
    const action = state.pendingAction;
    const open = action?.type === 'exchange' && action.playerId === me?.id;
    if (!open) return null;

    const groups = board?.groups || {};
    const shares = state.shares || [];
    const prices = state.sharePrices || {};
    const cut = Math.round((state.shareCut ?? 0.25) * 100);
    const perGroup = state.sharesPerGroup ?? 2;
    const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));

    const rows = Object.entries(groups)
        .map(([id, group]) => {
            const tiles = state.tiles.filter((t) => t.groupId === id);
            const owners = [...new Set(tiles.map((t) => t.ownerId).filter(Boolean))].map((o) => byId[o]);
            const taken = shares.filter((sh) => sh.groupId === id);
            const price = prices[id] ?? 0;
            return {
                id,
                group,
                owners,
                taken,
                price,
                // What the country is worth to be in on: its book rent, doubled
                // by houses where they stand. A rough number on purpose — the
                // point is to rank them, not to price them.
                pull: tiles.reduce((sum, t) => sum + (t.rent?.[t.houses] ?? 0), 0),
                mine: taken.some((sh) => sh.holderId === me.id),
                full: taken.length >= perGroup,
            };
        })
        .sort((a, b) => b.pull - a.pull);

    return (
        <Modal open dismissable={false} width={720}>
            <div className="flex max-h-[80svh] flex-col gap-4 p-6">
                <div className="flex shrink-0 items-baseline justify-between gap-4">
                    <span className="label flex items-center gap-1.5">
                        <TrendingUp className="size-3" /> Exchange
                    </span>
                    <span className="mono text-[13px] text-muted-foreground">
                        your cash {money(me.cash)}
                    </span>
                </div>
                <p className="shrink-0 text-[13px] leading-snug text-muted-foreground">
                    A share pays you {cut}% of every rent the country collects, out of the owner's
                    end — they still hold the deeds, and can buy your share back later at half again
                    what you paid. {perGroup} to a country.
                </p>

                <div className="scroll-thin -mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
                    {rows.map((row) => {
                        const afford = me.cash >= row.price;
                        const blocked = row.full || row.mine || !afford;
                        return (
                            <div
                                key={row.id}
                                className={cn(
                                    'flex items-center gap-3 rounded-xl border border-white/[0.06] px-3 py-2.5',
                                    blocked && 'opacity-45',
                                )}
                                style={{ background: alpha(row.group.color, 0.06) }}
                            >
                                <span
                                    className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#12121a]"
                                    style={{ boxShadow: `0 0 0 2px ${alpha(row.group.color, 0.6)}` }}
                                >
                                    {FLAG_SRC[row.id] && (
                                        <img src={FLAG_SRC[row.id]} alt="" className="size-full object-cover" />
                                    )}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] leading-tight">{row.group.name}</span>
                                    <span className="truncate text-[12px] leading-snug text-muted-foreground">
                                        {row.owners.length
                                            ? row.owners.map((o) => o?.name).filter(Boolean).join(', ')
                                            : 'nobody owns any of it yet'}
                                    </span>
                                </span>
                                {/* Filled for a share taken, hollow for one still going. */}
                                <span className="mono shrink-0 text-[13px] tracking-[0.2em] text-muted-foreground">
                                    {'●'.repeat(row.taken.length)}
                                    {'○'.repeat(Math.max(perGroup - row.taken.length, 0))}
                                </span>
                                <span className="mono w-16 shrink-0 text-right text-[13px]">
                                    {money(row.price)}
                                </span>
                                <Button
                                    variant={blocked ? 'outline' : 'default'}
                                    className="h-8 w-20 shrink-0 text-[13px]"
                                    disabled={blocked}
                                    onClick={() => send('exchange:buy', { groupId: row.id })}
                                >
                                    {row.mine ? 'yours' : row.full ? 'sold out' : 'Buy'}
                                </Button>
                            </div>
                        );
                    })}
                </div>

                <Button
                    variant="outline"
                    className="h-11 shrink-0"
                    onClick={() => send('exchange:leave')}
                >
                    Not today
                </Button>
            </div>
        </Modal>
    );
}
