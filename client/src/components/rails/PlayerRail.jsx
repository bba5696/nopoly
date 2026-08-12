import { motion } from 'framer-motion';
import { Crown, WifiOff } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { alpha, initials } from '@/lib/color';
import { money, shortMoney } from '@/lib/board-layout';

function note(player, state, isCurrent) {
    if (player.bankrupt) return 'bankrupt';
    if (!player.connected) return 'away';
    if (player.inJail) return `in jail · ${Math.max(3 - player.jailTurns, 1)} turn${3 - player.jailTurns === 1 ? '' : 's'}`;
    if (isCurrent) return 'now playing';
    const n = player.properties.length;
    return n === 0 ? 'no properties' : `${n} propert${n === 1 ? 'y' : 'ies'}`;
}

function Avatar({ player, size = 30, glow }) {
    return (
        <div
            className="mono relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
            style={{
                width: size,
                height: size,
                fontSize: size * 0.36,
                background: `linear-gradient(160deg, ${player.color}, ${alpha(player.color, 0.65)})`,
                boxShadow: glow ? `0 0 0 2px ${alpha(player.color, 0.5)}, 0 0 16px ${alpha(player.color, 0.7)}` : 'none',
                opacity: player.bankrupt ? 0.4 : 1,
            }}
        >
            {initials(player.name)}
        </div>
    );
}

function Row({ player, state, order, compact, isCurrent, isMe, isHost, onSpotlight, pinned, onPin }) {
    const lit = isCurrent || pinned;
    return (
        <motion.div
            layout
            role="button"
            tabIndex={0}
            // Mouse events rather than pointer ones: on a touchscreen a pointer
            // enter fires on tap and would flash the board on every scroll.
            onMouseEnter={() => onSpotlight?.(player.id)}
            onMouseLeave={() => onSpotlight?.(null)}
            // Tapping pins the spotlight, which is the only way to reach it on
            // a touchscreen — and on a phone the board sits above this list, so
            // a pinned player stays lit while you scroll the roster.
            onClick={() => onPin?.(player.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPin?.(player.id);
                }
            }}
            className={`flex cursor-pointer items-center gap-3 px-3 ${compact ? 'py-1.5' : 'py-2.5'} ${
                lit ? '' : 'border-b border-white/5 last:border-b-0'
            }`}
            // Every property is always present, with an explicit 'none' rather
            // than dropping to `undefined` when unlit: framer-motion keeps the
            // inline styles it has already written, so a row that stopped being
            // pinned would otherwise keep its outline for the rest of the game.
            // A pinned row is outlined harder than the current player's, so the
            // two aren't mistaken for each other.
            style={{
                background: lit
                    ? `linear-gradient(90deg, ${alpha(player.color, isCurrent ? 0.17 : 0.1)}, transparent 78%)`
                    : 'none',
                borderRadius: 'var(--radius-md)',
                boxShadow: lit
                    ? `inset 0 0 0 ${pinned ? 1.5 : 1}px ${alpha(player.color, pinned ? 0.75 : 0.35)}`
                    : 'none',
            }}
        >
            {!compact && <span className="mono w-4 text-[10px] text-muted-foreground">{order}</span>}
            <Avatar player={player} size={compact ? 24 : 30} glow={isCurrent} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className={`flex items-center gap-1.5 truncate ${compact ? 'text-[13px]' : 'text-[15px]'} leading-tight`}>
                    <span className="truncate" style={{ color: player.bankrupt ? 'var(--muted-foreground)' : undefined }}>
                        {player.name}
                    </span>
                    {isMe && <span className="label !text-[9px] opacity-70">you</span>}
                    {isHost && <Crown className="size-3 shrink-0 text-[#ffb648]" />}
                    {!player.connected && <WifiOff className="size-3 shrink-0 text-[#ff5c7c]" />}
                </span>
                {!compact && <span className="label !text-[9.5px]">{note(player, state, isCurrent)}</span>}
            </div>
            <div className="flex shrink-0 flex-col items-end leading-tight">
                {/* Owing money shows as a negative balance rather than $0 — see
                    YouRail. Everyone can see it, same as everyone sees cash. */}
                <span
                    className={`mono ${compact ? 'text-[11px]' : 'text-[13px]'}`}
                    style={player.debt ? { color: '#ff5c7c' } : undefined}
                >
                    {money(player.cash - (player.debt?.amount ?? 0))}
                </span>
                {/* Cash on its own is a poor read on who's winning: someone
                    with $50 and three full sets is well ahead of someone
                    sitting on $900 and nothing. Abbreviated because it's the
                    secondary number and the rail is 288px wide. */}
                {!compact && !player.bankrupt && (
                    <span className="label !text-[9.5px] opacity-70">net {shortMoney(player.netWorth)}</span>
                )}
            </div>
        </motion.div>
    );
}

/**
 * Team header. Carries the combined net worth, which is the number that
 * actually says who's winning — two separate balances don't compare against a
 * solo player's, and the team is the thing that wins.
 */
function TeamHeader({ team, out }) {
    return (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
            <span className="size-2 shrink-0 rounded-full" style={{ background: team.color, opacity: out ? 0.3 : 1 }} />
            <span className="label flex-1" style={{ opacity: out ? 0.45 : 1 }}>
                Team {team.id}
                {out && ' · out'}
            </span>
            {!out && <span className="label !text-[9.5px] opacity-70">net {shortMoney(team.netWorth)}</span>}
        </div>
    );
}

export function PlayerRail({ onSpotlight, pinned, onPin }) {
    const { state, playerId, current } = useGame();
    const compact = state.players.length > 8;

    // With teams on, players are already seated in interleaved order — which is
    // exactly what you don't want in a roster. Group them back up by team here;
    // the turn number on each row still shows the real order.
    const order = new Map(state.players.map((p, i) => [p.id, i + 1]));
    const groups = state.teams
        ? Object.values(state.teams).map((team) => ({
              key: team.id,
              team,
              players: team.playerIds.map((id) => state.players.find((p) => p.id === id)).filter(Boolean),
          }))
        : [{ key: 'all', team: null, players: state.players }];

    const row = (p) => (
        <Row
            key={p.id}
            player={p}
            state={state}
            order={order.get(p.id)}
            compact={compact && p.id !== current?.id}
            isCurrent={p.id === current?.id}
            isMe={p.id === playerId}
            isHost={p.id === state.hostId}
            onSpotlight={onSpotlight}
            pinned={pinned === p.id}
            onPin={onPin}
        />
    );

    return (
        // Leaving the list at all clears the spotlight — sliding off a row onto
        // the panel padding shouldn't leave the board stuck dark.
        <section className="panel flex flex-col" onMouseLeave={() => onSpotlight?.(null)}>
            <header className="panel-divider flex items-center justify-between px-4 py-3">
                <span className="label">
                    {state.teams ? `Teams (${groups.length})` : `Players (${state.players.length})`}
                </span>
                <span className="label opacity-60">turn {state.stats.turnCount + 1}</span>
            </header>
            <div className={`scroll-thin flex flex-col gap-0.5 overflow-y-auto p-2 ${compact ? 'max-h-[340px]' : ''}`}>
                {groups.map((group) => (
                    <div key={group.key} className="flex flex-col gap-0.5">
                        {group.team && <TeamHeader team={group.team} out={group.team.out} />}
                        {group.players.map(row)}
                    </div>
                ))}
            </div>
        </section>
    );
}
