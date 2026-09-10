import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { alpha, tag } from '@/lib/color';
import { priceOf } from '@/lib/market';

function PropertyPicker({ player, tiles, selected, onToggle, groups }) {
    const owned = tiles.filter((t) => t.ownerId === player.id);
    if (owned.length === 0) {
        return <p className="text-[13px] text-muted-foreground">No tradable properties.</p>;
    }
    return (
        <div className="scroll-thin flex max-h-[210px] flex-col gap-1.5 overflow-y-auto pr-1">
            {owned.map((tile) => {
                const color = groups?.[tile.groupId]?.color || '#9aa0b5';
                const on = selected.includes(tile.id);
                const blocked = tile.houses > 0;
                return (
                    <button
                        key={tile.id}
                        type="button"
                        disabled={blocked}
                        onClick={() => onToggle(tile.id)}
                        title={blocked ? 'Sell its buildings first' : undefined}
                        className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-40"
                        style={{
                            borderColor: on ? alpha(color, 0.7) : 'var(--border)',
                            background: on ? alpha(color, 0.14) : 'rgba(255,255,255,.015)',
                        }}
                    >
                        <span className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{tile.name}</span>
                        <span className="mono shrink-0 text-[11px] text-muted-foreground">${priceOf(tile)}</span>
                        {on && <Check className="size-3.5 shrink-0" style={{ color }} />}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * The stakes this player holds, if any.
 *
 * A share moves the way a deed does, so it is picked the way a deed is — but
 * it is drawn as the country rather than a tile, because that is what it is a
 * quarter of. A country the other side already has a stake in is unpickable:
 * nobody holds two in one place, and finding that out when the offer is
 * refused would be finding it out too late.
 */
function SharePicker({ player, shares, selected, onToggle, groups, cutLabel, blockedIn }) {
    const held = shares.filter((sh) => sh.holderId === player.id);
    if (!held.length) return null;
    return (
        <div className="flex flex-col gap-1.5">
            <span className="label opacity-60">Shares</span>
            {held.map((sh) => {
                const group = groups?.[sh.groupId];
                const color = group?.color || '#7dd3fc';
                const on = selected.includes(sh.groupId);
                const blocked = blockedIn.includes(sh.groupId);
                return (
                    <button
                        key={sh.groupId}
                        type="button"
                        disabled={blocked}
                        onClick={() => onToggle(sh.groupId)}
                        title={blocked ? 'They already hold a share in that country' : undefined}
                        className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-40"
                        style={{
                            borderColor: on ? alpha(color, 0.7) : 'var(--border)',
                            background: on ? alpha(color, 0.14) : 'rgba(255,255,255,.015)',
                        }}
                    >
                        <span className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: color }} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{group?.name || sh.groupId}</span>
                        <span className="mono shrink-0 text-[11px] text-[#3ddc97]">{cutLabel}</span>
                        <span className="mono shrink-0 text-[11px] text-muted-foreground">{money(sh.paid)}</span>
                        {on && <Check className="size-3.5 shrink-0" style={{ color }} />}
                    </button>
                );
            })}
        </div>
    );
}

function CashSlider({ player, value, max, onChange }) {
    return (
        <div className="flex flex-col gap-2">
            <input
                type="range"
                min={0}
                max={Math.max(max, 0)}
                step={10}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[var(--primary)]"
                style={{ accentColor: player.color }}
            />
            <div className="mono flex items-center justify-between text-[10px] text-muted-foreground">
                <span>0</span>
                <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] text-white"
                    style={{ background: player.color }}
                >
                    {money(value)}
                </span>
                <span>{max}</span>
            </div>
        </div>
    );
}

/**
 * Mounted fresh each time the builder opens (Game passes a changing `key`), so
 * the initial form state can come straight from the props.
 *
 * A counter mirrors the original offer: what they wanted to give me is what I
 * would now be giving them.
 */
export function TradeBuilder({ onClose, initialTargetId, counterOf }) {
    const { state, me, board, send } = useGame();
    const others = useMemo(
        () => state.players.filter((p) => p.id !== me?.id && !p.bankrupt),
        [state.players, me?.id],
    );
    const [targetId, setTargetId] = useState(counterOf?.fromId || initialTargetId || others[0]?.id || null);
    const [giveCash, setGiveCash] = useState(counterOf?.get.cash ?? 0);
    const [getCash, setGetCash] = useState(counterOf?.give.cash ?? 0);
    const [giveTiles, setGiveTiles] = useState(counterOf?.get.tiles ?? []);
    const [getTiles, setGetTiles] = useState(counterOf?.give.tiles ?? []);
    const [giveShares, setGiveShares] = useState(counterOf?.get.shares ?? []);
    const [getShares, setGetShares] = useState(counterOf?.give.shares ?? []);

    // Let the table see "… is creating a trade" while this is open.
    useEffect(() => {
        send('game:activity', { kind: 'trading' });
        return () => send('game:activity', { kind: null });
    }, [send]);

    const target = state.players.find((p) => p.id === targetId) || null;
    if (!me || !target) return null;

    const toggle = (setter) => (id) =>
        setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const empty =
        !giveCash && !getCash && !giveTiles.length && !getTiles.length &&
        !giveShares.length && !getShares.length;

    const shares = state.shares || [];
    const cutLabel = `${Math.round((state.shareCut ?? 0.25) * 100)}%`;
    // Countries each side already has a stake in, and so cannot receive one in.
    const heldBy = (id) => shares.filter((sh) => sh.holderId === id).map((sh) => sh.groupId);

    const submit = () => {
        send('trade:create', {
            toId: target.id,
            give: { cash: giveCash, tiles: giveTiles, shares: giveShares },
            get: { cash: getCash, tiles: getTiles, shares: getShares },
            counterOf: counterOf?.id || null,
        });
        onClose();
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={counterOf ? 'Counter offer' : 'Create a trade'}
            subtitle="esc to cancel"
            width={720}
        >
            <div className="flex flex-col gap-4 p-5">
                {!counterOf && others.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                        {others.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => {
                                    setTargetId(p.id);
                                    setGetTiles([]);
                                    setGetCash(0);
                                }}
                                className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors"
                                style={{
                                    borderColor: p.id === targetId ? alpha(p.color, 0.7) : 'var(--border)',
                                    background: p.id === targetId ? alpha(p.color, 0.16) : 'transparent',
                                }}
                            >
                                <span
                                    className="mono flex size-5 items-center justify-center rounded-full text-[8px] text-white"
                                    style={{ background: p.color }}
                                >
                                    {tag(p)}
                                </span>
                                {p.name}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-stretch gap-3">
                    <div className="flex flex-1 flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <span
                                className="mono flex size-7 items-center justify-center rounded-full text-[10px] text-white"
                                style={{ background: me.color }}
                            >
                                {tag(me)}
                            </span>
                            <span className="text-lg">You give</span>
                        </div>
                        <CashSlider player={me} value={giveCash} max={me.cash} onChange={setGiveCash} />
                        <PropertyPicker
                            player={me}
                            tiles={state.tiles}
                            selected={giveTiles}
                            onToggle={toggle(setGiveTiles)}
                            groups={board?.groups}
                        />
                        <SharePicker
                            player={me}
                            shares={shares}
                            selected={giveShares}
                            onToggle={toggle(setGiveShares)}
                            groups={board?.groups}
                            cutLabel={cutLabel}
                            blockedIn={heldBy(target.id)}
                        />
                    </div>

                    <div className="flex w-10 items-center justify-center">
                        <div className="flex h-24 w-8 items-center justify-center rounded-full border border-white/10 text-muted-foreground">
                            <ArrowLeftRight className="size-4" />
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <span
                                className="mono flex size-7 items-center justify-center rounded-full text-[10px] text-white"
                                style={{ background: target.color }}
                            >
                                {tag(target)}
                            </span>
                            <span className="text-lg">{target.name} gives</span>
                        </div>
                        <CashSlider player={target} value={getCash} max={target.cash} onChange={setGetCash} />
                        <PropertyPicker
                            player={target}
                            tiles={state.tiles}
                            selected={getTiles}
                            onToggle={toggle(setGetTiles)}
                            groups={board?.groups}
                        />
                        <SharePicker
                            player={target}
                            shares={shares}
                            selected={getShares}
                            onToggle={toggle(setGetShares)}
                            groups={board?.groups}
                            cutLabel={cutLabel}
                            blockedIn={heldBy(me.id)}
                        />
                    </div>
                </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-4">
                <span className="label">
                    {giveTiles.length + getTiles.length} propert{giveTiles.length + getTiles.length === 1 ? 'y' : 'ies'}
                    {giveShares.length + getShares.length
                        ? ` · ${giveShares.length + getShares.length} share${giveShares.length + getShares.length === 1 ? '' : 's'}`
                        : ''}{' '}
                    · {money(giveCash)} ⇄ {money(getCash)}
                </span>
                <div className="flex gap-2">
                    <Button variant="ghost" className="h-10 px-4" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button className="h-10 px-6 text-base" disabled={empty} onClick={submit}>
                        Send trade
                    </Button>
                </div>
            </footer>
        </Modal>
    );
}
