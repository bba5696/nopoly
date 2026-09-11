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
    // The exchange, from the deed's side: every stake out on this country, whose
    // each is, and what taking it back costs today. The price comes from the
    // server with the share — it moves with the country's rent and with how
    // many laps the stake has been held, and working that out twice is how a
    // button comes to show a number the server then refuses.
    const countryShares = (state.shares || []).filter((sh) => sh.groupId === tile.groupId);
    const shareCut = Math.round((state.shareCut ?? 0.25) * 100);
    const ladder = state.buybackLadder || [1.5, 2, 3];
    // Anyone holding a deed in the country can buy one back, since most of them
    // are split on the big board — but not off your own share.
    const holdsDeedHere = state.tiles.some((t) => t.groupId === tile.groupId && t.ownerId === me?.id);
    const spentTurn = state.boughtBackBy === me?.id;
    const group = board?.groups?.[tile.groupId];
    const color = group?.color || (tile.type === 'airport' ? '#9aa0b5' : tile.type === 'utility' ? '#7dd3fc' : '#5a5a70');
    // Building goes by side, selling by deed: a teammate can develop your set
    // out of their own pocket, but only you can sell any of it off.
    const mine = !!me && tile.ownerId === me.id;
    const ours = !!me && sameSide(state, tile.ownerId, me.id);
    const buildable = tile.type === 'property';
    // Turn-gated, matching the server — an Upgrade button that only ever
    // returns an error is worse than no button.
    // A buy-back is that turn's building, so the button goes with it.
    const upgradeOk = ours && isMyTurn && !spentTurn && canBuild(state, me, tile);
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
                        {countryShares.map((share) => {
                            const holder = state.players.find((p) => p.id === share.holderId);
                            const yours = share.holderId === me?.id;
                            const locked = share.buyback === null || share.buyback === undefined;
                            const lapsLeft = Math.max(0, ladder.length - (share.laps || 0));
                            // Why the button is not there, said rather than left
                            // for the player to guess.
                            const blocked = !isMyTurn
                                ? 'On your turn'
                                : spentTurn
                                  ? 'One a turn'
                                  : me?.debt
                                    ? 'Clear your debt first'
                                    : me && me.cash < share.buyback
                                      ? `Needs ${money(share.buyback)}`
                                      : null;
                            return (
                                <div
                                    key={share.holderId}
                                    className="flex items-center gap-3 rounded-xl border border-[#3ddc97]/25 bg-[#3ddc97]/[0.06] px-3 py-2.5"
                                >
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] leading-snug text-muted-foreground">
                                        <span>
                                            {yours ? (
                                                <>
                                                    You hold a {shareCut}% share in {group?.name || 'this country'}
                                                    {' '}— your own pays you nothing, but nobody else can have it.
                                                </>
                                            ) : (
                                                <>
                                                    {holder?.name || 'Someone'} holds a {shareCut}% share in{' '}
                                                    {group?.name || 'this country'}.
                                                </>
                                            )}
                                        </span>
                                        {/* The window, which is the decision. */}
                                        <span className={locked ? 'text-[#ff5c7c]' : 'text-[#ffb648]'}>
                                            {locked
                                                ? 'Held for good — it can no longer be bought back'
                                                : `Buy-back ${ladder[share.laps || 0]}× · closes in ${lapsLeft} lap${lapsLeft === 1 ? '' : 's'} of theirs`}
                                        </span>
                                    </span>
                                    {!yours && holdsDeedHere && !locked && (
                                        <Button
                                            variant="outline"
                                            className="h-9 shrink-0"
                                            disabled={!!blocked}
                                            onClick={() =>
                                                send('share:buyback', { groupId: tile.groupId, holderId: share.holderId })
                                            }
                                            title={
                                                blocked ||
                                                `Take ${holder?.name || 'their'} share back for ${money(share.buyback)} — uses this turn's building`
                                            }
                                        >
                                            {blocked && blocked !== `Needs ${money(share.buyback)}`
                                                ? blocked
                                                : `Buy back ${money(share.buyback)}`}
                                        </Button>
                                    )}
                                </div>
                            );
                        })}
                        {spentTurn && ours && tile.type === 'property' && (
                            <p className="text-[12px] text-muted-foreground">
                                You bought a share back this turn — building opens again next turn.
                            </p>
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
                        {tile.type === 'exchange' &&
                            'Land here to buy a share in any country — a quarter of every rent it collects, with the deeds left where they are.'}
                        {tile.type === 'landmark' && (
                            <>
                                {tile.boon?.startBonus
                                    ? `Stand here once and collect an extra $${tile.boon.startBonus} every time you pass Start, for the rest of the game.`
                                    : `Stand here once and pay ${tile.boon?.rentOff}% less rent for the rest of the game.`}{' '}
                                {/* Free, permanent, and not exclusive — worth
                                    saying, because every other tile on the
                                    board is one of those three things only. */}
                                Costs nothing, and everyone who reaches it keeps it.
                                {me?.landmarks?.includes(tile.id) && ' You have this one.'}
                            </>
                        )}
                        {tile.type === 'chest' && 'Draw a Treasure card.'}
                        {tile.type === 'corner' && 'Nothing happens here — unless it does.'}
                    </p>
                )}
            </div>
        </Modal>
    );
}
