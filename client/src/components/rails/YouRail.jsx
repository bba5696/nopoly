import { motion } from 'framer-motion';
import { useGame } from '@/lib/game-context';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { currentRent, ownsFullGroup } from '@/lib/rent';

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

export function YouRail({ onOpenTile }) {
    const { state, me, board } = useGame();
    if (!me) return null;

    const owned = me.properties.map((id) => state.tiles[id]).sort((a, b) => a.id - b.id);

    return (
        <>
            <section className="panel flex flex-col gap-2 p-4">
                <span className="label">You · {me.name}</span>
                <div className="flex items-end justify-between">
                    <motion.span
                        key={me.cash}
                        initial={{ opacity: 0.4, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mono text-3xl font-medium"
                        style={{ color: me.color }}
                    >
                        {money(me.cash)}
                    </motion.span>
                    <span className="label">net {money(me.netWorth)}</span>
                </div>
                {me.jailCards > 0 && <span className="label">{me.jailCards} get-out-of-jail card(s)</span>}
            </section>

            <section className="panel flex min-h-0 flex-col">
                <header className="panel-divider flex items-center justify-between px-4 py-3">
                    <span className="label">My properties ({owned.length})</span>
                    <span className="label opacity-60">tap to manage</span>
                </header>
                <div className="scroll-thin flex max-h-[300px] flex-col gap-1.5 overflow-y-auto p-3">
                    {owned.length === 0 && <p className="px-1 py-2 text-[13px] text-muted-foreground">Nothing owned yet.</p>}
                    {owned.map((tile) => (
                        <PropertyRow key={tile.id} tile={tile} groups={board?.groups} onOpen={onOpenTile} />
                    ))}
                </div>
            </section>
        </>
    );
}
