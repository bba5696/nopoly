import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';
import { currentRent, ownsFullGroup } from '@/lib/rent';
import { FLAG_SRC } from '@/lib/emblems';

function PropertyRow({ tile, groups, onOpen }) {
    const { state, me } = useGame();
    const color = groups?.[tile.groupId]?.color || (tile.type === 'airport' ? '#9aa0b5' : '#7dd3fc');
    const rent = currentRent(state, tile);
    const full = ownsFullGroup(state, me?.id, tile.groupId);

    return (
        <button
            type="button"
            onClick={() => onOpen(tile)}
            className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:brightness-125"
            style={{
                borderColor: full ? alpha(color, 0.45) : 'var(--border)',
                background: full ? alpha(color, 0.08) : 'rgba(255,255,255,.015)',
            }}
        >
            <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
            <span className="min-w-0 flex-1 truncate text-[14px]">{tile.name}</span>
            {tile.houses > 0 && (
                <span className="mono shrink-0 text-[10px] text-[#3ddc97]">
                    {tile.houses === 5 ? 'hotel' : `${tile.houses}h`}
                </span>
            )}
            <span className="mono shrink-0 text-[11px] text-muted-foreground">{rent?.label ?? '—'}</span>
        </button>
    );
}

/**
 * Hand cash to your teammate. Free on your own turn, so the fee only appears
 * when it's actually being charged — a permanent "10% fee" label would read as
 * though every transfer cost something.
 */
function SendCash({ mate }) {
    const { state, me, isMyTurn, send } = useGame();
    const [amount, setAmount] = useState('');

    const value = Math.floor(Number(amount)) || 0;
    const rate = state.offTurnFee ?? 0.1;
    const fee = isMyTurn ? 0 : Math.ceil(value * rate);
    const blocked = !!me.debt || value <= 0 || value + fee > me.cash || mate.bankrupt;

    const submit = () => {
        if (blocked) return;
        send('game:sendCash', { toId: mate.id, amount: value });
        setAmount('');
    };

    return (
        <div className="flex flex-col gap-1.5 border-t border-white/8 pt-3">
            <span className="label">Send to {mate.name}</span>
            <div className="flex gap-2">
                <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={me.cash}
                    value={amount}
                    placeholder="0"
                    disabled={!!me.debt}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    className="mono min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[14px] outline-none focus:border-white/25 disabled:opacity-40"
                />
                <Button className="h-auto shrink-0 px-3" disabled={blocked} onClick={submit}>
                    <Send className="size-4" />
                </Button>
            </div>
            {me.debt ? (
                <span className="label !text-[9.5px] opacity-70">settle your debt first</span>
            ) : (
                fee > 0 && (
                    <span className="mono text-[11px] text-[#ffb648]">
                        +{money(fee)} fee — free on your own turn
                    </span>
                )
            )}
        </div>
    );
}

export function YouRail({ onOpenTile, onOpenShare }) {
    const { state, me, board } = useGame();
    // The net figure comes apart on a tap; closed by default, because most of
    // the time the total is all anybody wants.
    const [worthOpen, setWorthOpen] = useState(false);
    if (!me) return null;

    const owned = me.properties.map((id) => state.tiles[id]).sort((a, b) => a.id - b.id);
    // A side can be any size, so this is a list — with a pair it renders
    // exactly as it always did, and with four it just carries on down.
    const mates = state.settings.teams && me.teamId
        ? state.players.filter((p) => p.id !== me.id && p.teamId === me.teamId)
        : [];
    // Their deeds, which you can develop but not sell — worth listing, because
    // otherwise the only way to reach them is tapping a tile on the board, and
    // on a phone those are 30px wide.
    const mateOwned = mates
        .map((mate) => ({
            mate,
            tiles: mate.properties.map((id) => state.tiles[id]).sort((a, b) => a.id - b.id),
        }))
        .filter((m) => m.tiles.length > 0);

    const balance = me.cash - (me.debt?.amount ?? 0);
    // Shares you hold, and the size of one — the percentage is the server's
    // number, not a constant repeated here.
    const mine = (state.shares || []).filter((sh) => sh.holderId === me.id);
    const cutLabel = `${Math.round((state.shareCut ?? 0.25) * 100)}%`;
    // Landmarks are permanent and unsellable, so this is a record rather than a
    // control — what they give, in the words the board used.
    const landmarks = (me.landmarks || []).map((id) => state.tiles[id]).filter(Boolean);
    // What the net figure is made of, in the server's own numbers rather than
    // added up again here — two sums of the same thing is how they come to
    // disagree. Landmarks are missing on purpose: nothing will buy one.
    const worth = me.worth || {};
    const worthRows = [
        ['cash', worth.cash],
        ['property', worth.deeds],
        ['houses & hotels', worth.buildings],
        ['shares', worth.shares],
        ['jail cards', worth.jailCards],
        ['owed', worth.debt ? -worth.debt : 0],
    ].filter(([, value]) => !!value);
    // What selling would actually raise. Below the estate, because buildings
    // come back at half — and it is the number that decides whether a debt
    // ends you, so it belongs next to one.
    const canCover = (worth.liquid ?? 0) >= (me.debt?.amount ?? 0);

    return (
        <>
            <section className="panel flex flex-col gap-2 p-4">
                <span className="label">You · {me.name}</span>
                <div className="flex items-end justify-between">
                    {/* Cash itself never goes below zero — the shortfall lives
                        in `debt` — but showing $0 while you owe money reads as
                        though nothing is wrong.

                        Green when solvent, red when not: the same pairing as
                        the connection indicator, and it reads faster than a
                        minus sign. The player's own colour used to go here,
                        which looked tidy but said nothing about the number. */}
                    <motion.span
                        key={balance}
                        initial={{ opacity: 0.4, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mono text-3xl font-medium"
                        style={{ color: balance < 0 ? '#ff5c7c' : '#3ddc97' }}
                    >
                        {money(balance)}
                    </motion.span>
                    <button
                        type="button"
                        onClick={() => setWorthOpen((v) => !v)}
                        className="label transition-colors hover:text-foreground"
                        title="What this is made of"
                    >
                        net {money(me.netWorth)}
                    </button>
                </div>
                {/* The total was being doubted, so it comes apart on a tap.
                    Only the lines that apply: a row of zeroes explains
                    nothing. */}
                {worthOpen && (
                    <div className="flex flex-col gap-0.5 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                        {worthRows.map(([label, value]) => (
                            <span key={label} className="flex items-baseline justify-between gap-3 text-[12px]">
                                <span className="text-muted-foreground">{label}</span>
                                <span className="mono" style={value < 0 ? { color: '#ff9db2' } : undefined}>
                                    {value < 0 ? `-${money(-value)}` : money(value)}
                                </span>
                            </span>
                        ))}
                        <span className="mt-1 flex items-baseline justify-between gap-3 border-t border-white/8 pt-1 text-[12px]">
                            <span className="text-muted-foreground">net worth</span>
                            <span className="mono">{money(me.netWorth)}</span>
                        </span>
                        {/* The one that answers "can I pay this?", which the
                            net figure does not: it is what a sale raises, with
                            buildings at half. */}
                        <span className="flex items-baseline justify-between gap-3 text-[12px]">
                            <span className="text-muted-foreground">sell-back value</span>
                            <span className="mono text-muted-foreground">{money(worth.liquid ?? 0)}</span>
                        </span>
                    </div>
                )}
                {me.jailCards > 0 && <span className="label">{me.jailCards} get-out-of-jail card(s)</span>}
                {/* This panel is where the selling happens, so the amount owed
                    belongs next to it rather than only out on the board. */}
                {me.debt && (
                    <span className="mono rounded-lg border border-[#ff5c7c]/35 bg-[#ff5c7c]/10 px-3 py-2 text-[13px] text-[#ff9db2]">
                        You owe {money(me.debt.amount)} — selling everything raises{' '}
                        {money(worth.liquid ?? 0)}
                        {canCover ? ', which covers it' : ", which isn't enough"}
                    </span>
                )}
                {mates.filter((mate) => !mate.bankrupt).map((mate) => (
                    <SendCash key={mate.id} mate={mate} />
                ))}
            </section>

            {/* Only on a board that has an exchange, and only once you hold
                something — an empty panel explaining a mechanic you haven't met
                is a panel in the way. */}
            {!!landmarks.length && (
                <section className="panel flex flex-col gap-1.5 p-4">
                    <span className="label">Landmarks ({landmarks.length})</span>
                    {landmarks.map((t) => (
                        <span key={t.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                            <span className="truncate text-[#ffd166]">{t.name}</span>
                            <span className="mono shrink-0 text-[11px] text-muted-foreground">
                                {t.boon?.startBonus ? `+$${t.boon.startBonus} at Start` : `-${t.boon?.rentOff}% rent`}
                            </span>
                        </span>
                    ))}
                </section>
            )}

            {!!mine.length && (
                <section className="panel flex flex-col">
                    <header className="panel-divider flex items-center justify-between px-4 py-3">
                        <span className="label">My shares ({mine.length})</span>
                        <span className="label opacity-60">tap to manage</span>
                    </header>
                    <div className="scroll-thin flex max-h-[148px] flex-col gap-1.5 overflow-y-auto p-3">
                        {mine.map((sh) => {
                            const group = board?.groups?.[sh.groupId];
                            return (
                                <button
                                    key={sh.groupId}
                                    type="button"
                                    title={`What your share in ${group?.name} is worth, and what you can do with it`}
                                    onClick={() => onOpenShare?.(sh.groupId)}
                                    className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:brightness-125"
                                    style={{
                                        borderColor: alpha(group?.color || '#7dd3fc', 0.45),
                                        background: alpha(group?.color || '#7dd3fc', 0.08),
                                    }}
                                >
                                    <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#12121a]">
                                        {FLAG_SRC[sh.groupId] && (
                                            <img src={FLAG_SRC[sh.groupId]} alt="" className="size-full object-cover" />
                                        )}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[14px]">{group?.name || sh.groupId}</span>
                                    <span className="mono shrink-0 text-[11px] text-[#3ddc97]">{cutLabel}</span>
                                    <span className="mono shrink-0 text-[11px] text-muted-foreground">{money(sh.paid)}</span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}

            <section className="panel flex min-h-0 flex-col">
                <header className="panel-divider flex items-center justify-between px-4 py-3">
                    <span className="label">My properties ({owned.length})</span>
                    <span className="label opacity-60">tap to manage</span>
                </header>
                {/* Capped tighter when a teammate list is also on screen: four
                    stacked panels in a 288px column otherwise push the trades
                    below the fold, and trades are the thing you need to notice. */}
                <div
                    className={cn(
                        'scroll-thin flex flex-col gap-1.5 overflow-y-auto p-3',
                        mates.length ? 'max-h-[208px]' : 'max-h-[300px]',
                    )}
                >
                    {owned.length === 0 && <p className="px-1 py-2 text-[13px] text-muted-foreground">Nothing owned yet.</p>}
                    {owned.map((tile) => (
                        <PropertyRow key={tile.id} tile={tile} groups={board?.groups} onOpen={onOpenTile} />
                    ))}
                </div>
            </section>

            {mateOwned.map(({ mate, tiles }) => (
                <section key={mate.id} className="panel flex min-h-0 flex-col">
                    <header className="panel-divider flex items-center justify-between px-4 py-3">
                        <span className="label">{mate.name}'s ({tiles.length})</span>
                        <span className="label opacity-60">build only</span>
                    </header>
                    <div className="scroll-thin flex max-h-[148px] flex-col gap-1.5 overflow-y-auto p-3">
                        {tiles.map((tile) => (
                            <PropertyRow key={tile.id} tile={tile} groups={board?.groups} onOpen={onOpenTile} />
                        ))}
                    </div>
                </section>
            ))}
        </>
    );
}
