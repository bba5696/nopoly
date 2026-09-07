import { Dices, SkipForward, KeyRound, Coins } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useGame } from '@/lib/game-context';
import { useTurn, JAIL_FINE } from '@/lib/use-turn';
import { playEndTurn, playRoll } from '@/lib/sound';
import { cn } from '@/lib/utils';

/**
 * Wraps an action a debt has taken away. The title sits on a span rather than
 * on the button, because a disabled button gets `pointer-events: none` and a
 * tooltip attached to it would never fire.
 */
function Blocked({ when, children }) {
    if (!when) return children;
    return (
        <span title="You are in debt" className="inline-flex flex-1 cursor-not-allowed">
            {children}
        </span>
    );
}

/**
 * The turn's controls. Only the moves you can actually take are rendered — a
 * row of dead buttons tells you nothing.
 *
 * `wide` fills the width and grows the hit targets, for the bar under the board
 * on a phone; the default is the compact row that sits inside the ring.
 */
export function TurnActions({ moving, wide = false, className }) {
    const { send } = useGame();
    const { debt, canRoll, canEnd, rollingAgain, payJail, useCard } = useTurn(moving);
    const button = wide ? 'h-12 flex-1 text-base' : 'h-11 px-6 text-base';

    return (
        <div className={cn('flex items-center justify-center gap-2 empty:hidden', wide && 'w-full', className)}>
            {payJail && (
                <Button className={button} variant="secondary" onClick={() => send('game:payJail')}>
                    <Coins /> Pay ${JAIL_FINE}
                </Button>
            )}
            {useCard && (
                <Button className={button} variant="secondary" onClick={() => send('game:useJailCard')}>
                    <KeyRound /> Use card
                </Button>
            )}
            {canRoll && (
                <Blocked when={!!debt}>
                    <Button
                        className={cn(button, wide && 'w-full')}
                        disabled={!!debt}
                        onClick={() => {
                            playRoll();
                            send('game:roll');
                        }}
                    >
                        <Dices /> {rollingAgain ? 'Roll again' : 'Roll'}
                    </Button>
                </Blocked>
            )}
            {canEnd && (
                <Blocked when={!!debt}>
                    {rollingAgain ? (
                        // Two events, one press. The server needs the resolve
                        // phase closed before it will re-arm the roll, but making
                        // the player click twice — through a button that says
                        // "Roll again" both times — is just a worse way of saying
                        // "roll". Ordering is safe: the socket delivers in order
                        // and the handler is synchronous.
                        <Button
                            className={cn(button, wide && 'w-full')}
                            disabled={!!debt}
                            onClick={() => {
                                playRoll();
                                send('game:endTurn');
                                send('game:roll');
                            }}
                        >
                            <Dices /> Roll again
                        </Button>
                    ) : (
                        <Button
                            className={cn(button, wide && 'w-full')}
                            variant="outline"
                            disabled={!!debt}
                            onClick={() => {
                                playEndTurn();
                                send('game:endTurn');
                            }}
                        >
                            <SkipForward /> End turn
                        </Button>
                    )}
                </Blocked>
            )}
        </div>
    );
}

/**
 * What to do about a debt, not just that you have one — the selling lives in
 * the You panel and there's nothing to press here.
 */
export function DebtNotice({ compact = false }) {
    const { state, me } = useGame();
    const debt = me?.debt || null;
    if (!debt) return null;
    const owedTo = debt.toId ? state.players.find((p) => p.id === debt.toId)?.name : null;
    // Net worth already has the debt taken off it, so it is the wrong number to
    // read here — what matters is what a sale would raise, which is what the
    // engine checks before anyone goes bankrupt.
    const liquid = me.worth?.liquid ?? 0;
    const canCover = liquid >= debt.amount;

    return (
        <div
            className={cn(
                'flex flex-col items-center gap-1 rounded-xl border border-[#ff5c7c]/35 bg-[#ff5c7c]/10 text-center',
                compact ? 'w-full px-3 py-2' : 'max-w-[22em] px-5 py-3',
            )}
        >
            <span className={cn('mono text-[#ff9db2]', compact ? 'text-[13px]' : 'text-[15px]')}>
                ${debt.amount} still owed{owedTo ? ` to ${owedTo}` : ''}
            </span>
            <span className={cn('leading-snug text-muted-foreground', compact ? 'text-[11.5px]' : 'text-[13px]')}>
                Selling everything you hold raises ${liquid}
                {canCover ? ' — enough to cover it.' : ", which isn't enough."} Sell buildings or
                property from the You panel. Your turn is on hold until you do.
            </span>
        </div>
    );
}
