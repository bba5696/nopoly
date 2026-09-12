import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeftRight,
    Eye,
    LogOut,
    MessageSquare,
    TrendingDown,
    Users,
    Music,
    Volume2,
    VolumeX,
    Wallet,
    WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMuted, isMusicOn, playStart, playTrade, playTurn, setMuted, setMusicOn, stopMusic, unlock } from '@/lib/sound';
import { Modal } from '@/components/ui/modal';
import { useGame } from '@/lib/game-context';
import { loadIdentity } from '@/lib/socket';
import { useTokenPositions } from '@/lib/use-token-positions';
import { useTableSounds } from '@/lib/use-table-sounds';
import { useIdlePing } from '@/lib/use-idle-ping';
import { BoardViewport } from '@/components/board/BoardViewport';
import { AuctionBids } from '@/components/board/AuctionPanel';
import { TurnActions, DebtNotice } from '@/components/board/TurnActions';
import { useTurn } from '@/lib/use-turn';
import { PlayerRail } from '@/components/rails/PlayerRail';
import { ChatLog } from '@/components/rails/ChatLog';
import { YouRail } from '@/components/rails/YouRail';
import { TradeRail } from '@/components/rails/TradeRail';
import { BuyModal } from '@/components/modals/BuyModal';
import { CardModal } from '@/components/modals/CardModal';
import { TradeBuilder } from '@/components/modals/TradeBuilder';
import { TradeViewModal } from '@/components/modals/TradeViewModal';
import { TileInfoModal } from '@/components/modals/TileInfoModal';
import { ShareInfoModal } from '@/components/modals/ShareInfoModal';
import { ExchangeModal } from '@/components/modals/ExchangeModal';
import { BailoutModal } from '@/components/modals/BailoutModal';
import { VoteKickModal, VoteKickPicker, VoteStatusChip } from '@/components/modals/VoteKickModal';
import { Button } from '@/components/ui/button';

// Narrow screens can't fit the three-column layout, so the rails collapse into
// one panel under the board and this picks which rail is in it. Ignored from xl
// up, where all four are on screen at once.
const TABS = [
    { id: 'players', label: 'Players', Icon: Users },
    // Nothing of your own and nothing to offer when you're only watching.
    { id: 'you', label: 'You', Icon: Wallet, seated: true },
    { id: 'trades', label: 'Trades', Icon: ArrowLeftRight, seated: true },
    { id: 'chat', label: 'Chat', Icon: MessageSquare },
];

export function Game() {
    const { state, me, playerId, connected, spectating, leaveRoom, joinRoom, send } = useGame();
    const [confirmBankrupt, setConfirmBankrupt] = useState(false);
    // Mirrors the stored setting so the icon re-renders when it's toggled.
    const [quiet, setQuiet] = useState(isMuted);
    const [music, setMusic] = useState(isMusicOn);
    const { display, moving } = useTokenPositions(state.players, state.tiles.length, state.lastMove);
    const turn = useTurn(moving);
    // What everyone else is doing, made audible — see use-table-sounds.
    useTableSounds(state, playerId);
    // Held by id so the popover always reflects the latest server state.
    const [tileId, setTileId] = useState(null);
    const [shareGroup, setShareGroup] = useState(null);
    const [trade, setTrade] = useState(null); // { key, counterOf?, targetId? } | null
    const [viewTradeId, setViewTradeId] = useState(null);
    const [tab, setTab] = useState('players');
    // Whose holdings are lit on the board. Hovering a row previews; tapping one
    // pins it, which is the only route on a touchscreen — and the board sits
    // above the roster there, so a pinned player stays visible while you read
    // the list.
    const [hovered, setHovered] = useState(null);
    const [pinned, setPinned] = useState(null);
    const [kickOpen, setKickOpen] = useState(false);
    const spotlight = pinned ?? hovered;
    // An auction runs in the middle of the board rather than over the top of
    // everything, which is what lets people read the board while it runs — and
    // also means anything already open would sit on top of it. So for as long as
    // one runs, whatever you had open is held rather than closed: a trade you
    // were reading can wait ten seconds, and it comes back where you left it.
    const auctionOn = !!state.auction;
    const tile = tileId === null || auctionOn ? null : state.tiles[tileId];

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
    // Only while the clock is on you: any movement resets it, and if you don't
    // move, the turn plays itself rather than stalling everyone.
    useIdlePing(isMyTurn && !!state.idle, send);
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
        const once = () => {
            unlock();
            // The bed can only start behind a gesture too, so it waits for the
            // same one rather than trying and failing on mount.
            if (isMusicOn() && !isMuted()) setMusicOn(true);
        };
        window.addEventListener('pointerdown', once, { once: true });
        return () => window.removeEventListener('pointerdown', once);
    }, []);

    // Silence on the way out, without forgetting they wanted it — `setMusicOn`
    // would write the preference off and they'd have to find the button again
    // next game.
    useEffect(() => () => stopMusic(), []);

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
                    {/* Where a running vote goes once you've had your say —
                        visible without standing on top of the board. */}
                    <VoteStatusChip />
                    <span className="mono rounded-md border border-dashed border-white/15 px-3 py-1.5 text-[12px] tracking-[0.2em]">
                        {state.roomCode}
                    </span>
                    {/* The player rail's header carries the turn count too, so
                        on a phone this is just crowding the room code out. */}
                    <span className="mono hidden rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-muted-foreground sm:inline-block">
                        turn {state.stats.turnCount + 1}
                    </span>
                    {/* Separate from mute on purpose: wanting the table to
                        make noise and wanting a soundtrack are different
                        wants, and the second one is the one people switch off
                        after ten minutes. */}
                    <Button
                        size="sm"
                        variant="ghost"
                        className={cn('h-8 px-2', music && !quiet ? 'text-[#a68cff]' : 'text-muted-foreground')}
                        title={music ? 'Background music on' : 'Background music off'}
                        disabled={quiet}
                        onClick={() => {
                            const next = !music;
                            setMusic(next);
                            setMusicOn(next);
                        }}
                    >
                        <Music />
                    </Button>
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
                    {/* A watcher has no stake to walk out on, so unlike a
                        player they get a plain way out — and a way in, if the
                        table lands back in the lobby after a rematch. */}
                    {spectating && (
                        <>
                            <span className="label flex items-center gap-1.5 text-[#a68cff]">
                                <Eye className="size-3.5" /> <span className="hidden sm:inline">watching</span>
                            </span>
                            {state.phase === 'waiting' && (
                                <Button
                                    size="sm"
                                    className="h-8"
                                    onClick={() => joinRoom(state.roomCode, loadIdentity().name || 'player')}
                                >
                                    Take a seat
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={leaveRoom}>
                                <LogOut /> Leave
                            </Button>
                        </>
                    )}
                    {/* No leave button in-game for a player: walking out
                        mid-game strands everyone else, and Bankrupt is the way
                        out. */}
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
                    {/* Stacked, the board gets a fixed slice of the viewport
                        height rather than growing with its width, or on a tall
                        narrow screen it would push the panel below it off the
                        bottom. The board inside that slice is drawn at whatever
                        size its tiles need and pans — see BoardViewport. */}
                    <div className="h-[52svh] w-full xl:h-auto">
                        <BoardViewport
                            className="size-full xl:mx-auto xl:aspect-square xl:h-auto xl:max-w-[min(100%,calc(100svh-58px))]"
                            display={display}
                            moving={moving}
                            spotlight={spotlight}
                            onSelectTile={(t) => setTileId(t.id)}
                        />
                    </div>
                </main>

                {/* The turn's controls, on every screen too narrow for the
                    board's middle to hold them. Outside the tabbed panel on
                    purpose: rolling is the one thing you must be able to do
                    without first remembering which tab you left open. */}
                {(turn.any || turn.debt) && !auctionOn && (
                    <div className="flex shrink-0 flex-col items-center gap-2 xl:hidden">
                        <DebtNotice compact />
                        <TurnActions moving={moving} wide />
                    </div>
                )}

                {/* Bidding, on every screen whose board middle is too small to
                    hold the buttons — the same call, and the same bar, as the
                    turn's own controls. */}
                {auctionOn && (
                    <div className="flex shrink-0 flex-col items-center gap-2 xl:hidden">
                        <AuctionBids wide />
                    </div>
                )}

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
                            onVoteKick={() => setKickOpen(true)}
                        />
                    </div>
                    <div className={cn('min-h-0 flex-1 flex-col xl:contents', tab === 'chat' ? 'flex' : 'hidden')}>
                        <ChatLog />
                    </div>
                </aside>

                {/* Nothing of your own and nobody to trade with when you're
                    only watching — on a phone the tabs are gone, and this is
                    the same call for the column they'd have opened. */}
                <aside
                    className={cn(
                        'scroll-thin min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:col-start-3 xl:row-start-1',
                        spectating ? 'hidden' : 'xl:flex',
                        !spectating && (tab === 'you' || tab === 'trades') ? 'flex' : 'hidden',
                    )}
                >
                    <div className={cn('min-h-0 flex-col gap-3 xl:contents', tab === 'you' ? 'flex' : 'hidden')}>
                        <YouRail onOpenTile={(t) => setTileId(t.id)} onOpenShare={setShareGroup} />
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
                {TABS.filter((t) => !t.seated || !spectating).map(({ id, label, Icon }) => (
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
            <ExchangeModal />
            <VoteKickPicker open={kickOpen} onClose={() => setKickOpen(false)} />
            {/* Last, so they sit over anything else already open — both freeze
                someone's turn until they're answered. */}
            <BailoutModal />
            <VoteKickModal />
            <TileInfoModal tile={tile} onClose={() => setTileId(null)} />
            <ShareInfoModal groupId={auctionOn ? null : shareGroup} onClose={() => setShareGroup(null)} />
            {viewTradeId && !auctionOn && (
                <TradeViewModal
                    tradeId={viewTradeId}
                    onClose={() => setViewTradeId(null)}
                    onCounter={(t) => openTrade({ counterOf: t })}
                />
            )}
            {trade && !auctionOn && (
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
