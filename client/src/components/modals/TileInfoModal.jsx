import { Home, Hotel, ArrowDownRight, ArrowUpRight, Banknote } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money, taxLabel } from '@/lib/board-layout';
import { rentTable, ownsFullGroup, canBuild, canSell, sameSide } from '@/lib/rent';
import { alpha } from '@/lib/color';
import { priceOf, trendColor, trendOf } from '@/lib/market';

const HOUSE_ROW = ['with rent', 'with one house', 'with two houses', 'with three houses', 'with four houses', 'with a hotel'];

/** The rent ladder, with the row matching the tile's current state lit up. */
function RentRows({ state, tile, color }) {
    if (tile.type === 'property') {
        const full = state.settings.doubleRent && ownsFullGroup(state, tile.ownerId, tile.groupId);
        return tile.rent.map((value, i) => {
            const active = tile.ownerId && tile.houses === i;
            const shown = i === 0 && full ? value * 2 : value;
            return (
                <div
                    key={i}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]"
                    style={active ? { background: alpha(color, 0.16), color: '#fff' } : undefined}
                >
                    <span className={active ? '' : 'text-muted-foreground'}>
                        {HOUSE_ROW[i]}
                        {i === 0 && full ? ' (full set)' : ''}
                    </span>
                    <span className="mono">{money(shown)}</span>
                </div>
            );
        });
    }
    return rentTable(state, tile).map((r) => (
        <div key={r.k} className="flex items-center justify-between rounded-md px-2 py-1.5 text-[14px]">
            <span className="text-muted-foreground">{r.k}</span>
            <span className="mono">{r.v}</span>
        </div>
    ));
}

/** What a tax tile charges, in words. */
function taxRule(tile) {
    const rule = tile.tax;
    if (!rule) return 'Pay the bank when you land here.';
    if (!rule.percent) return `Pay the bank ${money(rule.amount || 0)} when you land here.`;
    return rule.max
        ? `Pay the bank ${rule.percent}% of everything you own when you land here — cash, property and buildings — up to ${money(rule.max)}.`
        : `Pay the bank ${rule.percent}% of everything you own when you land here — cash, property and buildings.`;
}

export function TileInfoModal({ tile, onClose }) {
    const { state, me, board, isMyTurn, send } = useGame();
    if (!tile) return null;

    const owner = state.players.find((p) => p.id === tile.ownerId);
    // The exchange, from the deed's side: a share out on this country, whose it
    // is, and what taking it back would cost.
    const share = (state.shares || []).find((sh) => sh.groupId === tile.groupId);
    const shareHolder = share && state.players.find((p) => p.id === share.holderId);
    const shareCut = Math.round((state.shareCut ?? 0.25) * 100);
    const buyback = share ? Math.round(share.paid * (state.buybackMult ?? 1.5)) : 0;
    // Anyone holding a deed in the country can buy it back, since most of them
    // are split on the big board — but not off your own share.
    const canBuyBack =
        !!share &&
        share.holderId !== me?.id &&
        state.tiles.some((t) => t.groupId === tile.groupId && t.ownerId === me?.id);
    const group = board?.groups?.[tile.groupId];
    const color = group?.color || (tile.type === 'airport' ? '#9aa0b5' : tile.type === 'utility' ? '#7dd3fc' : '#5a5a70');
    // Building goes by side, selling by deed: a teammate can develop your set
    // out of their own pocket, but only you can sell any of it off.
    const mine = !!me && tile.ownerId === me.id;
    const ours = !!me && sameSide(state, tile.ownerId, me.id);
    const buildable = tile.type === 'property';
    // Turn-gated, matching the server — an Upgrade button that only ever
    // returns an error is worse than no button.
    const upgradeOk = ours && isMyTurn && canBuild(state, me, tile);
    const downgradeOk = mine && canSell(state, me, tile);
    const sellOk = mine && tile.houses === 0;
    const priced = tile.price > 0;
    const trend = trendOf(tile);

    return (
        <Modal open={!!tile} onClose={onClose} width={380}>
            <div className="flex flex-col">
                <header
                    className="flex flex-col items-center gap-1 px-6 py-5"
                    style={{ background: `linear-gradient(180deg, ${alpha(color, 0.35)}, ${alpha(color, 0.08)})` }}
                >
                    <span className="label" style={{ color }}>
                        {/* The rate belongs in the header, where a property
                            names its set — "tax" on its own says nothing now
                            that the number varies by tile. */}
                        {owner
                            ? `owned by ${owner.name}`
                            : tile.type === 'tax'
                              ? `tax · ${taxLabel(tile)}`
                              : group?.name || tile.type}
                    </span>
                    <h2 className="text-2xl font-medium">{tile.name}</h2>
                </header>

                {priced ? (
                    <div className="flex flex-col gap-3 p-5">
                        <div className="flex items-center justify-between border-b border-white/8 px-2 pb-2">
                            <span className="label">when</span>
                            <span className="label">get</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <RentRows state={state} tile={tile} color={color} />
                        </div>

                        <div className="mt-1 flex items-stretch justify-between gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-3">
                            <div className="flex flex-1 flex-col items-center gap-1">
                                <span className="label">price</span>
                                <span className="mono flex items-center gap-1 text-[15px]">
                                    {money(priceOf(tile))}
                                    {trend && (
                                        <span
                                            className="text-[11px]"
                                            style={{ color: trendColor(trend) }}
                                            title={`${trend.up ? 'Up' : 'Down'} ${trend.pct}% on its book value of ${money(tile.price)}`}
                                        >
                                            {trend.up ? '▲' : '▼'}
                                            {trend.pct}%
                                        </span>
                                    )}
                                </span>
                            </div>
                            {buildable && (
                                <>
                                    <div className="flex flex-1 flex-col items-center gap-1 border-l border-white/8">
                                        <Home className="size-4 text-muted-foreground" />
                                        <span className="mono text-[15px]">{money(tile.houseCost)}</span>
                                    </div>
                                    <div className="flex flex-1 flex-col items-center gap-1 border-l border-white/8">
                                        <Hotel className="size-4 text-muted-foreground" />
                                        <span className="mono text-[15px]">{money(tile.houseCost)}</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Only the moves actually available right now show up.
                            Not gated on owning the deed: each flag already
                            carries its own rule, and wrapping them in one that
                            demands the deed is what hid Upgrade on a
                            teammate's property — the case teams exist for. */}
                        {/* Somebody holds a piece of this country's rent.
                            Shown on the deed rather than anywhere else, because
                            here is where you find out about it — and the way
                            out is a button in the same place. */}
                        {share && (
                            <div className="flex items-center gap-3 rounded-xl border border-[#3ddc97]/25 bg-[#3ddc97]/[0.06] px-3 py-2.5">
                                <span className="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground">
                                    {share.holderId === me?.id ? (
                                        <>
                                            You hold a {shareCut}% share in {group?.name || 'this country'} —
                                            your own pays you nothing, but nobody else can have it.
                                        </>
                                    ) : (
                                        <>
                                            {shareHolder?.name || 'Someone'} holds a {shareCut}% share in{' '}
                                            {group?.name || 'this country'} — its owner keeps {100 - shareCut}% of
                                            the rent.
                                        </>
                                    )}
                                </span>
                                {canBuyBack && (
                                    <Button
                                        variant="outline"
                                        className="h-9 shrink-0"
                                        onClick={() => send('share:buyback', { groupId: tile.groupId })}
                                        title={`Take the share back for ${money(buyback)}`}
                                    >
                                        Buy back {money(buyback)}
                                    </Button>
                                )}
                            </div>
                        )}

                        {(upgradeOk || downgradeOk || sellOk) && (
                            <div className="flex gap-2">
                                {upgradeOk && (
                                    <Button
                                        className="h-10 flex-1"
                                        onClick={() => send('game:build', { tileId: tile.id })}
                                        title={`Build for ${money(tile.houseCost)}`}
                                    >
                                        <ArrowUpRight /> Upgrade
                                    </Button>
                                )}
                                {downgradeOk && (
                                    <Button
                                        variant="outline"
                                        className="h-10 flex-1"
                                        onClick={() => send('game:sell', { tileId: tile.id })}
                                        title={`Sell a building for ${money(tile.houseCost / 2)}`}
                                    >
                                        <ArrowDownRight /> Downgrade
                                    </Button>
                                )}
                                {sellOk && (
                                    <Button
                                        variant="outline"
                                        className="h-10 flex-1"
                                        onClick={() => {
                                            send('game:sellProperty', { tileId: tile.id });
                                            onClose();
                                        }}
                                        title={`Sell back for ${money(priceOf(tile))}`}
                                    >
                                        <Banknote /> Sell
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="p-6 text-[14px] text-muted-foreground">
                        {/* What it will actually cost you, not just that it
                            will. A share of your worth is worth spelling out —
                            it's the difference between a bill you can ignore
                            and one that grows with the game. */}
                        {tile.type === 'tax' && taxRule(tile)}
                        {tile.type === 'chance' && 'Draw a Surprise card.'}
                        {tile.type === 'chest' && 'Draw a Treasure card.'}
                        {tile.type === 'corner' && 'Nothing happens here — unless it does.'}
                    </p>
                )}
            </div>
        </Modal>
    );
}
