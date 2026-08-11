import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeftRight,
    MessageSquare,
    TrendingDown,
    Users,
    Volume2,
    VolumeX,
    Wallet,
    WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMuted, playStart, playTrade, playTurn, setMuted, unlock } from '@/lib/sound';
import { Modal } from '@/components/ui/modal';
import { useGame } from '@/lib/game-context';
import { useTokenPositions } from '@/lib/use-token-positions';
import { Board } from '@/components/board/Board';
import { PlayerRail } from '@/components/rails/PlayerRail';
import { ChatLog } from '@/components/rails/ChatLog';
import { YouRail } from '@/components/rails/YouRail';
import { TradeRail } from '@/components/rails/TradeRail';
import { BuyModal } from '@/components/modals/BuyModal';
import { CardModal } from '@/components/modals/CardModal';
import { TradeBuilder } from '@/components/modals/TradeBuilder';
import { TradeViewModal } from '@/components/modals/TradeViewModal';
import { TileInfoModal } from '@/components/modals/TileInfoModal';
import { AuctionModal } from '@/components/modals/AuctionModal';
import { Button } from '@/components/ui/button';

// Narrow screens can't fit the three-column layout, so the rails collapse into
// one panel under the board and this picks which rail is in it. Ignored from xl
// up, where all four are on screen at once.
const TABS = [
    { id: 'players', label: 'Players', Icon: Users },
    { id: 'you', label: 'You', Icon: Wallet },
    { id: 'trades', label: 'Trades', Icon: ArrowLeftRight },
    { id: 'chat', label: 'Chat', Icon: MessageSquare },
];

export function Game() {
    const { state, me, playerId, connected, send } = useGame();
    const [confirmBankrupt, setConfirmBankrupt] = useState(false);
    // Mirrors the stored setting so the icon re-renders when it's toggled.
    const [quiet, setQuiet] = useState(isMuted);
    const { display, moving } = useTokenPositions(state.players, state.tiles.length);
    // Held by id so the popover always reflects the latest server state.
    const [tileId, setTileId] = useState(null);
    const [trade, setTrade] = useState(null); // { key, counterOf?, targetId? } | null
    const [viewTradeId, setViewTradeId] = useState(null);
    const [tab, setTab] = useState('players');
    // Whose holdings are lit on the board. Hovering a row previews; tapping one
    // pins it, which is the only route on a touchscreen — and the board sits
    // above the roster there, so a pinned player stays visible while you read
    // the list.
    const [hovered, setHovered] = useState(null);
    const [pinned, setPinned] = useState(null);
    const spotlight = pinned ?? hovered;
    const tile = tileId === null ? null : state.tiles[tileId];

    // A phone player can't see the trade rail while another tab is up, so an
    // offer would otherwise arrive silently.
    const incoming = state.trades.filter((t) => t.toId === playerId).length;

    const openTrade = (opts = {}) => setTrade({ key: Date.now(), ...opts });

    const buyOpen = state.pendingAction?.type === 'buy' && state.pendingAction.playerId === playerId && !moving;
    // Only the player who drew gets their screen covered — everyone else reads
    // the card in the history feed.
    const cardOpen = state.pendingCard?.playerId === playerId && !moving;

    // An offer in the side rail goes unnoticed, especially on a phone where the
    // rail is behind a tab, so a new one addressed to you opens itself. It
    // waits rather than covering a prompt that's already asking you something —
    // once that clears, the effect re-runs and it opens then.
    const announced = useRef(new Set());
    useEffect(() => {
        const mine = state.trades.filter((t) => t.toId === playerId);
        const live = new Set(mine.map((t) => t.id));
        // Forget withdrawn offers, so re-sending one pops it up again.
        for (const id of [...announced.current]) if (!live.has(id)) announced.current.delete(id);

        const fresh = mine.find((t) => !announced.current.has(t.id));
        if (!fresh) return;
        if (buyOpen || cardOpen || moving || state.auction || trade || viewTradeId) return;
        announced.current.add(fresh.id);
        playTrade();
        setViewTradeId(fresh.id);
    }, [state.trades, state.auction, playerId, buyOpen, cardOpen, moving, trade, viewTradeId]);

    // Waiting on six other people means nobody is watching the screen. Ping on
    // the transition only, never on a re-render that happens to land mid-turn.
    const isMyTurn = !!me && state.players[state.turnIndex]?.id === playerId && !me.bankrupt;
    const wasMyTurn = useRef(isMyTurn);
    useEffect(() => {
        if (isMyTurn && !wasMyTurn.current) playTurn();
        wasMyTurn.current = isMyTurn;
    }, [isMyTurn]);

    // Kick-off fanfare, on mount only. Guarded on the turn counter so that
    // refreshing or reconnecting mid-game doesn't replay it — this screen
    // mounts on every reload, not just when the game begins.
    useEffect(() => {
        if (state.stats.turnCount === 0 && !state.winnerId) playStart();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Browsers won't let audio start until the page has been clicked, and the
    // turn ping fires from a state change rather than a gesture — so the very
    // first interaction, whatever it is, opens the audio context.
    useEffect(() => {
        const once = () => unlock();
        window.addEventListener('pointerdown', once, { once: true });
        return () => window.removeEventListener('pointerdown', once);
    }, []);

    return (
        <div className="flex h-svh flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 px-4 py-1.5">
                <span className="text-xl font-medium tracking-tight">nopoly</span>
                <div className="flex items-center gap-2.5">
                    {!connected && (
                        <span className="label flex items-center gap-1.5 text-[#ff5c7c]">
                            <WifiOff className="size-3" /> reconnecting
                        </span>
                    )}
                    <span className="mono rounded-md border border-dashed border-white/15 px-3 py-1.5 text-[12px] tracking-[0.2em]">
                        {state.roomCode}
                    </span>
                    {/* The player rail's header carries the turn count too, so
                        on a phone this is just crowding the room code out. */}
                    <span className="mono hidden rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-muted-foreground sm:inline-block">
                        turn {state.stats.turnCount + 1}
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-muted-foreground"
                        title={quiet ? 'Sounds off' : 'Sounds on'}
                        onClick={() => {
                            const next = !quiet;
                            setQuiet(next);
                            setMuted(next);
                            // Confirm audibly that it's back on — and unmuting
                            // is a gesture, so the context opens here too.
                            if (!next) playTurn();
                        }}
                    >
                        {quiet ? <VolumeX /> : <Volume2 />}
                    </Button>
                    {/* No leave button in-game: walking out mid-game strands
                        everyone else, and Bankrupt is the way out. */}
                    {me && !me.bankrupt && (
                        <Button
                            size="sm"
                            variant="destructive"
                            className="h-8"
                            onClick={() => setConfirmBankrupt(true)}
                        >
                            <TrendingDown /> Bankrupt
                        </Button>
                    )}
                </div>
            </header>

            {/* From xl: rails stay pinned to the edges; the slack lands in the
                middle column, as breathing room around the board. Below that
                the same rails stack under the board, one at a time.

                The board comes first in the DOM so it lands on top when
                stacked; the explicit column placement keeps the desktop order.
                Each rail is wrapped so it can be hidden per tab, and the
                wrappers go `display: contents` at xl — the rails then lay out
                as direct children of the aside exactly as they did before. */}
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 xl:grid xl:grid-cols-[288px_minmax(0,1fr)_288px] xl:gap-4">
                <main className="flex min-h-0 shrink-0 items-center justify-center xl:col-start-2 xl:row-start-1 xl:shrink">
                    {/* Stacked, the board is capped against the viewport height
                        rather than its width, or on a tall narrow screen it
                        would push the panel below it off the bottom. */}
                    <div className="w-full max-w-[min(100%,52svh)] xl:max-w-none">
                        <Board
                            display={display}
                            moving={moving}
                            spotlight={spotlight}
                            onSelectTile={(t) => setTileId(t.id)}
                        />
                    </div>
                </main>

                <aside
                    className={cn(
                        'scroll-thin min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:col-start-1 xl:row-start-1 xl:flex',
                        tab === 'players' || tab === 'chat' ? 'flex' : 'hidden',
                    )}
                >
                    <div className={cn('min-h-0 flex-col xl:contents', tab === 'players' ? 'flex' : 'hidden')}>
                        <PlayerRail
                            onSpotlight={setHovered}
                            pinned={pinned}
                            onPin={(id) => setPinned((cur) => (cur === id ? null : id))}
                        />
                    </div>
                    <div className={cn('min-h-0 flex-1 flex-col xl:contents', tab === 'chat' ? 'flex' : 'hidden')}>
                        <ChatLog />
                    </div>
                </aside>

                <aside
                    className={cn(
                        'scroll-thin min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:col-start-3 xl:row-start-1 xl:flex',
                        tab === 'you' || tab === 'trades' ? 'flex' : 'hidden',
                    )}
                >
                    <div className={cn('min-h-0 flex-col gap-3 xl:contents', tab === 'you' ? 'flex' : 'hidden')}>
                        <YouRail onOpenTile={(t) => setTileId(t.id)} />
                    </div>
                    <div className={cn('min-h-0 flex-1 flex-col xl:contents', tab === 'trades' ? 'flex' : 'hidden')}>
                        <TradeRail
                            onNew={() => openTrade()}
                            onOpen={(t) => setViewTradeId(t.id)}
                            onCounter={(t) => openTrade({ counterOf: t })}
                        />
                    </div>
                </aside>
            </div>

            {/* Bottom-anchored so it's in thumb reach, and padded past the home
                indicator on iPhones. */}
            <nav className="flex shrink-0 gap-1 border-t border-white/8 px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] xl:hidden">
                {TABS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={cn(
                            'relative flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                            tab === id ? 'bg-white/[0.09] text-foreground' : 'text-muted-foreground',
                        )}
                    >
                        <Icon className="size-[18px]" />
                        {label}
                        {id === 'trades' && incoming > 0 && (
                            <span className="mono absolute top-0.5 right-[calc(50%-22px)] rounded-full bg-[#7c5cff] px-1.5 text-[10px] leading-4 text-white">
                                {incoming}
                            </span>
                        )}
                    </button>
                ))}
            </nav>

            <BuyModal open={buyOpen} />
            <CardModal open={cardOpen} />
            <AuctionModal />
            <TileInfoModal tile={tile} onClose={() => setTileId(null)} />
            {viewTradeId && (
                <TradeViewModal
                    tradeId={viewTradeId}
                    onClose={() => setViewTradeId(null)}
                    onCounter={(t) => openTrade({ counterOf: t })}
                />
            )}
            {trade && (
                <TradeBuilder
                    key={trade.key}
                    onClose={() => setTrade(null)}
                    counterOf={trade.counterOf}
                    initialTargetId={trade.targetId}
                />
            )}

            {/* Bankruptcy can't be taken back, so it asks first */}
            <Modal
                open={confirmBankrupt}
                onClose={() => setConfirmBankrupt(false)}
                title="Declare bankruptcy?"
                subtitle="this cannot be undone"
                width={400}
            >
                <div className="flex flex-col gap-5 p-5">
                    <p className="text-[14px] leading-relaxed text-muted-foreground">
                        Your {me?.properties.length ?? 0} propert
                        {me?.properties.length === 1 ? 'y' : 'ies'} and any buildings go back to the bank, and you're out
                        of the game for good — you won't be able to rejoin. If you're the last player standing, the game
                        ends here.
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirmBankrupt(false)}>
                            Keep playing
                        </Button>
                        <Button
                            variant="destructive"
                            className="h-11 flex-1"
                            onClick={() => {
                                send('game:bankrupt');
                                setConfirmBankrupt(false);
                            }}
                        >
                            <TrendingDown /> Go bankrupt
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
