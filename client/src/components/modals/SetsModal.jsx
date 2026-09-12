import { useMemo, useState } from 'react';
import { Building2, Hammer, Undo2 } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Houses } from '@/components/ui/houses';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { cn } from '@/lib/utils';
import { completedSets, currentRent } from '@/lib/rent';

/**
 * Every country you have completed, and what it would cost to build them up.
 *
 * Building was one house, on one tile, through that tile's own card — so a set
 * of three to hotels was fifteen trips through a modal, in the order even
 * building forces on you anyway. With one set that is merely tedious; with two
 * or three it is the whole turn.
 *
 * So a tap on a country you hold opens this instead, but only once you hold two
 * or more: with a single set there is nothing to switch between, and the tile
 * card — which is also where you sell a deed, mortgage nothing, and read the
 * rent ladder — stays the right screen for it.
 *
 * You pick a level for a country and press once. The server does the rest in a
 * single action, stopping when the money does, and the feed gets one line.
 */

const LEVELS = [1, 2, 3, 4, 5];
const levelName = (n) => (n === 5 ? 'hotel' : String(n));
const levelPhrase = (n) => (n === 5 ? 'a hotel each' : n === 1 ? 'a house each' : `${n} houses each`);

function Country({ groupId, blocked, onOpenTile }) {
    const { state, board, me, send } = useGame();
    const tiles = useMemo(
        () => state.tiles.filter((t) => t.groupId === groupId),
        [state.tiles, groupId],
    );
    const group = board?.groups?.[groupId];
    const color = group?.color || '#9aa0b5';

    const low = Math.min(...tiles.map((t) => t.houses));
    const high = Math.max(...tiles.map((t) => t.houses));
    // Opens on the next rung up, which is what somebody who came here to build
    // almost always wants — and the one level that is never a no-op.
    const [want, setWant] = useState(() => Math.min(low + 1, 5));
    const [armed, setArmed] = useState(false);

    const cost = tiles.reduce((sum, t) => sum + Math.max(0, want - t.houses) * t.houseCost, 0);
    // Only your own deeds sell: on a team, a set can be split across two people
    // and the buildings belong to whoever's name is on the deed.
    const refund = tiles
        .filter((t) => t.ownerId === me?.id)
        .reduce((sum, t) => sum + Math.max(0, t.houses - want) * Math.floor(t.houseCost / 2), 0);

    const selling = want < high;
    const nothing = low === want && high === want;
    const tooPoor = !selling && cost > (me?.cash ?? 0);
    const stop = selling ? null : blocked;

    const act = () => {
        if (selling) send('game:sellTo', { groupId, level: want });
        else send('game:buildTo', { groupId, level: want });
        setArmed(false);
    };

    return (
        <section
            className="flex flex-col gap-2.5 rounded-xl border p-3"
            style={{ borderColor: alpha(color, 0.4), background: alpha(color, 0.05) }}
        >
            <header className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: color }} />
                    <span className="text-[15px] font-medium">{group?.name || 'Country'}</span>
                </span>
                <span className="label opacity-70">
                    {high === 0 ? 'nothing built' : low === high ? levelPhrase(low) : `${low}–${levelName(high)} each`}
                </span>
            </header>

            {/* Every tile, with what it charges now and what it would charge at
                the level being considered. The second number is the reason
                anybody builds, so it is not hidden behind a confirm. */}
            <div className="flex flex-wrap gap-1.5">
                {tiles.map((t) => {
                    const now = currentRent(state, t)?.label || '—';
                    const then = want >= 1 ? `$${t.rent[want]}` : null;
                    const change = then && want !== t.houses;
                    return (
                        // A deed's own card is still where you read its rent
                        // ladder, sell it, or take a share back — and tapping
                        // the tile on the board now opens this panel instead,
                        // so this is the way back to it.
                        <button
                            key={t.id}
                            type="button"
                            title={`Open ${t.name}`}
                            onClick={() => onOpenTile(t.id)}
                            className="flex min-w-[104px] flex-1 flex-col gap-0.5 rounded-lg border border-white/8 bg-black/20 px-2 py-1.5 text-left transition-colors hover:border-white/20 hover:bg-black/40"
                        >
                            <span className="flex items-center justify-between gap-1">
                                <span className="truncate text-[12px]">{t.name}</span>
                                <span className="flex text-[13px]" style={{ color }}>
                                    <Houses houses={t.houses} />
                                </span>
                            </span>
                            <span className="mono text-[11px] text-muted-foreground">
                                {now}
                                {change && (
                                    <>
                                        {' → '}
                                        <span className={selling ? 'text-[#ff5c7c]' : 'text-[#ffb648]'}>{then}</span>
                                    </>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center gap-1.5">
                <span className="label shrink-0 opacity-70">to</span>
                {LEVELS.map((n) => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => {
                            setWant(n);
                            setArmed(false);
                        }}
                        className={cn(
                            'flex-1 rounded-lg border py-1 text-[12px] transition-colors',
                            want === n
                                ? 'border-transparent text-[#0b0b12]'
                                : 'border-white/10 text-muted-foreground hover:text-foreground',
                        )}
                        style={want === n ? { background: color } : undefined}
                    >
                        {levelName(n)}
                    </button>
                ))}
            </div>

            {/* Selling is asked twice. It is the one button here that turns
                buildings into half their money, and it sits where the build
                button was a moment ago. */}
            <Button
                size="sm"
                variant={selling ? 'outline' : 'default'}
                disabled={nothing || tooPoor || !!stop}
                className={cn('h-9', selling && armed && 'bg-[#ff5c7c] text-white hover:bg-[#ff7590]')}
                onClick={() => (selling && !armed ? setArmed(true) : act())}
            >
                {selling ? <Undo2 /> : <Hammer />}
                {nothing
                    ? `Already at ${levelPhrase(want)}`
                    : selling
                      ? armed
                          ? `Sell down — take ${money(refund)}`
                          : `Sell down to ${levelPhrase(want)} · +${money(refund)}`
                      : `Build to ${levelPhrase(want)} · ${money(cost)}`}
            </Button>

            {!nothing && !selling && (tooPoor || stop) && (
                <span className="label text-center text-[#ffb648]">
                    {stop || `you have ${money(me?.cash ?? 0)}`}
                </span>
            )}
        </section>
    );
}

export function SetsModal({ groupId, onClose, onOpenTile }) {
    const { state, me, isMyTurn } = useGame();
    const sets = useMemo(() => (me ? completedSets(state, me.id) : []), [state, me]);

    if (!groupId || !me) return null;

    // The one that was tapped goes first; the rest keep board order.
    const ordered = [groupId, ...sets.filter((g) => g !== groupId)];

    // Why the build buttons are off, in the words the server would use. Selling
    // is never blocked by any of these — rent lands on you during other
    // people's turns, and this is how it gets paid.
    const blocked = !isMyTurn
        ? 'you can only build on your own turn'
        : me.debt
          ? 'settle your debt first'
          : state.boughtBackBy === me.id
            ? 'you bought a share back this turn — build next turn'
            : null;

    return (
        <Modal
            open
            onClose={onClose}
            width={560}
            subtitle={`${sets.length} countries`}
            title="Your sets"
        >
            <div className="scroll-thin flex max-h-[62svh] flex-col gap-3 overflow-y-auto p-4">
                {ordered.map((g) => (
                    <Country key={g} groupId={g} blocked={blocked} onOpenTile={onOpenTile} />
                ))}
                <span className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <Building2 className="size-3.5" />
                    Tap a deed for its own card
                </span>
            </div>
        </Modal>
    );
}
