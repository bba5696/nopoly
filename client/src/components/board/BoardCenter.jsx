import { motion } from 'framer-motion';
import { Dices, SkipForward, Pause, Play, KeyRound, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGame } from '@/lib/game-context';
import { gridFor } from '@/lib/board-layout';
import { Dice } from './Dice';
import { GameFeed } from './GameFeed';

const JAIL_FINE = 50;

/**
 * A single line describing what the table is waiting on, most urgent first.
 *
 * It only ever reports on the player whose turn it is — what everyone else is
 * doing in the background isn't what the table is waiting for. Pausing and
 * auctions are the exceptions, since those hold up the whole game.
 *
 * Always names the player rather than saying "you", so everyone reads the same
 * sentence.
 */
function statusLine({ state, current, moving }) {
    if (state.paused) return 'Game paused';
    if (state.auction) return `${state.tiles[state.auction.tileId].name} is up for auction`;
    if (!current) return 'Waiting for players';

    if (moving) return `${current.name} is moving`;
    if (state.pendingCard) {
        return `${current.name} drew a ${state.pendingCard.deck === 'chance' ? 'Surprise' : 'Treasure'}`;
    }
    if (state.pendingAction?.type === 'buy') {
        return `${current.name} landed on ${state.tiles[state.pendingAction.tileId].name}`;
    }

    if (current.activity?.kind === 'trading') return `${current.name} is creating a trade`;
    const decidingOn =
        current.activity?.kind === 'viewing' || state.trades.some((t) => t.toId === current.id);
    if (decidingOn) return `${current.name} is negotiating a trade`;

    if (current.inJail && state.phase === 'rolling') return `${current.name} is in prison`;
    if (state.phase === 'rolling') return `${current.name} is rolling`;
    return `${current.name} is playing`;
}

export function BoardCenter({ moving }) {
    const { state, me, current, isMyTurn, send } = useGame();
    const canRoll = isMyTurn && state.phase === 'rolling' && !moving;
    const canEnd = isMyTurn && !moving && (state.phase === 'resolving' || (state.phase === 'rolling' && state.hasRolled));
    const inJail = isMyTurn && me?.inJail && state.phase === 'rolling';
    const status = statusLine({ state, current, moving });
    // Fill everything inside the ring — which is two tracks wider on the
    // 48-tile board than on the 40-tile one.
    const grid = gridFor(state.tiles.length);

    return (
        <div
            className="relative flex min-h-0 flex-col items-center justify-center gap-5 rounded-2xl border border-white/[0.05] bg-[#101018]/60 p-6"
            style={{ gridArea: `2 / 2 / ${grid} / ${grid}` }}
        >
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(60%_60%_at_50%_40%,rgba(124,92,255,.10),transparent_70%)]" />

            <Dice dice={state.diceRoll} rolling={moving} />

            {/* Remounted on every change so the new line fades in; no exit
                animation, which keeps the slot from ever going blank. */}
            <motion.span
                key={status}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="min-h-8 text-center text-2xl font-medium"
            >
                {status}
            </motion.span>

            {/* only actions you can actually take are rendered — a row of dead
                buttons tells you nothing */}
            <div className="flex flex-wrap items-center justify-center gap-3 empty:hidden">
                {inJail && me.cash >= JAIL_FINE && (
                    <Button className="h-11 px-5 text-base" variant="secondary" onClick={() => send('game:payJail')}>
                        <Coins /> Pay ${JAIL_FINE}
                    </Button>
                )}
                {inJail && me.jailCards > 0 && (
                    <Button className="h-11 px-5 text-base" variant="secondary" onClick={() => send('game:useJailCard')}>
                        <KeyRound /> Use card
                    </Button>
                )}
                {canRoll && (
                    <Button className="h-11 px-6 text-base" onClick={() => send('game:roll')}>
                        <Dices /> Roll
                    </Button>
                )}
                {canEnd && (
                    <Button className="h-11 px-5 text-base" variant="outline" onClick={() => send('game:endTurn')}>
                        <SkipForward /> End turn
                    </Button>
                )}
            </div>

            <GameFeed />

            <Button
                size="sm"
                variant="ghost"
                className="absolute bottom-3 right-3 text-muted-foreground"
                onClick={() => send('game:pause')}
            >
                {state.paused ? <Play /> : <Pause />}
                {state.paused ? 'Resume' : 'Pause'}
            </Button>
        </div>
    );
}
