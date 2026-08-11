import { motion } from 'framer-motion';
import { Dices, SkipForward, KeyRound, Coins } from 'lucide-react';
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
    // Ahead of everything else: the table genuinely is waiting on them.
    if (current?.debt) return `${current.name} owes $${current.debt.amount}`;
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

export function BoardCenter({ moving, dim }) {
    const { state, me, current, isMyTurn, send } = useGame();
    // A debt freezes the turn until it's cleared, so none of the usual actions
    // are on offer — the server refuses them all anyway.
    const debt = me?.debt || null;
    const canRoll = isMyTurn && !debt && state.phase === 'rolling' && !moving;
    const canEnd =
        isMyTurn && !debt && !moving && (state.phase === 'resolving' || (state.phase === 'rolling' && state.hasRolled));
    const inJail = isMyTurn && me?.inJail && state.phase === 'rolling';
    // A double earns another roll, but the server only re-arms it when the turn
    // is handed back — so "End turn" is what you press to keep going, which
    // reads like the opposite of what it does. Both the button that hands the
    // turn back and the roll that follows say what's actually about to happen.
    const rollingAgain =
        isMyTurn && state.doublesCount > 0 && state.doublesCount < 3 && !me?.inJail && !me?.bankrupt;
    const status = statusLine({ state, current, moving });
    // Fill everything inside the ring — which is two tracks wider on the
    // 48-tile board than on the 40-tile one.
    const grid = gridFor(state.tiles.length);

    return (
        <div
            className={`relative flex min-h-0 flex-col items-center justify-center gap-5 rounded-2xl border border-white/[0.05] bg-[#101018]/60 p-6 transition-opacity duration-200 ${
                dim ? 'opacity-25' : ''
            }`}
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

            {/* What to do about it, not just that it happened — the selling
                lives in the You panel and there's nothing to click here. */}
            {debt && (
                <div className="flex max-w-[22em] flex-col items-center gap-1 rounded-xl border border-[#ff5c7c]/35 bg-[#ff5c7c]/10 px-5 py-3 text-center">
                    <span className="mono text-[15px] text-[#ff9db2]">
                        ${debt.amount} still owed{debt.toId ? ` to ${state.players.find((p) => p.id === debt.toId)?.name}` : ''}
                    </span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                        Sell buildings or property from the You panel to cover it. Your turn is on hold until you do.
                    </span>
                </div>
            )}

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
                        <Dices /> {rollingAgain ? 'Roll again' : 'Roll'}
                    </Button>
                )}
                {canEnd &&
                    (rollingAgain ? (
                        // Two events, one press. The server needs the resolve
                        // phase closed before it will re-arm the roll, but
                        // making the player click twice — through a button that
                        // says "Roll again" both times — is just a worse way of
                        // saying "roll". Ordering is safe: the socket delivers
                        // in order and the handler is synchronous.
                        <Button
                            className="h-11 px-6 text-base"
                            onClick={() => {
                                send('game:endTurn');
                                send('game:roll');
                            }}
                        >
                            <Dices /> Roll again
                        </Button>
                    ) : (
                        <Button className="h-11 px-5 text-base" variant="outline" onClick={() => send('game:endTurn')}>
                            <SkipForward /> End turn
                        </Button>
                    ))}
            </div>

            <GameFeed />
        </div>
    );
}
