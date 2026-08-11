import { useState } from 'react';
import { TrendingDown, WifiOff } from 'lucide-react';
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
import { PauseOverlay } from '@/components/modals/PauseOverlay';
import { Button } from '@/components/ui/button';

export function Game() {
    const { state, me, playerId, connected, send } = useGame();
    const [confirmBankrupt, setConfirmBankrupt] = useState(false);
    const { display, moving } = useTokenPositions(state.players);
    // Held by id so the popover always reflects the latest server state.
    const [tileId, setTileId] = useState(null);
    const [trade, setTrade] = useState(null); // { key, counterOf?, targetId? } | null
    const [viewTradeId, setViewTradeId] = useState(null);
    const tile = tileId === null ? null : state.tiles[tileId];

    const openTrade = (opts = {}) => setTrade({ key: Date.now(), ...opts });

    const buyOpen = state.pendingAction?.type === 'buy' && state.pendingAction.playerId === playerId && !moving;
    // Only the player who drew gets their screen covered — everyone else reads
    // the card in the history feed.
    const cardOpen = state.pendingCard?.playerId === playerId && !moving;

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
                    <span className="mono rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-muted-foreground">
                        turn {state.stats.turnCount + 1}
                    </span>
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

            {/* rails stay pinned to the edges; the slack lands in the middle
                column, as breathing room around the board */}
            <div className="grid min-h-0 flex-1 gap-4 p-2 xl:grid-cols-[288px_minmax(0,1fr)_288px]">
                <aside className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto">
                    <PlayerRail />
                    <ChatLog />
                </aside>

                <main className="flex min-h-0 items-center justify-center">
                    <Board display={display} moving={moving} onSelectTile={(t) => setTileId(t.id)} />
                </main>

                <aside className="scroll-thin flex min-h-0 flex-col gap-3 overflow-y-auto">
                    <YouRail onOpenTile={(t) => setTileId(t.id)} />
                    <TradeRail
                        onNew={() => openTrade()}
                        onOpen={(t) => setViewTradeId(t.id)}
                        onCounter={(t) => openTrade({ counterOf: t })}
                    />
                </aside>
            </div>

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
            <PauseOverlay />

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
