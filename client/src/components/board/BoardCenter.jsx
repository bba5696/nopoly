import { motion } from 'framer-motion';
import { useGame } from '@/lib/game-context';
import { gridFor } from '@/lib/board-layout';
import { pausedLine } from '@/lib/pause';
import { AuctionPanel } from './AuctionPanel';
import { Dice } from './Dice';
import { GameFeed } from './GameFeed';
import { TurnActions, DebtNotice } from './TurnActions';

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
    if (state.paused) return pausedLine(state);
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

/**
 * The hole in the middle of the ring.
 *
 * On a phone that hole is a couple of hundred pixels across, and it used to be
 * asked to hold dice, a status line, a debt notice, the turn's buttons and the
 * game feed. It couldn't: the column overflowed in both directions, so the dice
 * sat on the top row of tiles and End turn sat on the bottom one, half off the
 * board and barely pressable.
 *
 * So below xl it keeps what a glance needs — the dice, the line saying whose
 * turn it is, and the feed — while everything you press moved to the bar under
 * the board, where a thumb can reach it. Losing the buttons and the debt notice
 * is what buys the rest of it room.
 */
export function BoardCenter({ moving, dim }) {
    const { state, current } = useGame();
    const status = statusLine({ state, current, moving });
    // An auction takes the whole middle. Nothing it displaces has anything to
    // say while one runs — the dice are not being rolled, the status line would
    // only repeat the panel's own first two lines, and the feed is the last
    // thing anyone needs while a clock is running. What it buys is the board
    // staying visible, which is the only place you can see whether the person
    // in front is about to finish a country.
    const auction = !!state.auction;
    // Fill everything inside the ring — which is two tracks wider on the
    // 48-tile board than on the 40-tile one.
    const grid = gridFor(state.tiles.length);

    return (
        <div
            className={`relative flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-white/[0.05] bg-[#101018]/60 p-3 transition-opacity duration-200 xl:gap-5 xl:p-6 ${
                dim ? 'opacity-25' : ''
            }`}
            style={{ gridArea: `2 / 2 / ${grid} / ${grid}` }}
        >
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(60%_60%_at_50%_40%,rgba(124,92,255,.10),transparent_70%)]" />

            {auction ? (
                <AuctionPanel />
            ) : (
                <>
                    <Dice dice={state.diceRoll} rolling={moving} />

                    {/* Remounted on every change so the new line fades in; no
                        exit animation, which keeps the slot from ever going
                        blank. */}
                    <motion.span
                        key={status}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="min-h-0 text-center text-[13px] leading-tight font-medium text-balance sm:text-base xl:min-h-8 xl:text-2xl"
                    >
                        {status}
                    </motion.span>

                    {/* Below xl these two are in the bar under the board. */}
                    <div className="hidden flex-col items-center gap-5 xl:flex">
                        <DebtNotice />
                        <TurnActions moving={moving} />
                    </div>

                    <GameFeed />
                </>
            )}
        </div>
    );
}
