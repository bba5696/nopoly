import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, Hand as HandIcon, MessageSquare, Users } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { PresencePill } from '@/components/ui/presence';
import { ChatLog } from '@/components/rails/ChatLog';
import { GameFeed } from '@/components/board/GameFeed';
import { VoteKickModal, VoteKickPicker, VoteStatusChip } from '@/components/modals/VoteKickModal';
import { Hand } from '@/components/cards/Hand';
import { Pile, Stock, TurnArrow } from '@/components/cards/Table';
import { Seats } from '@/components/cards/Seats';
import { CardFace } from '@/components/cards/Card';
import { playableIds } from '@/lib/nouno';
import { alpha, tag } from '@/lib/color';
import { cn } from '@/lib/utils';

const TABS = [
    { id: 'table', label: 'Table', icon: HandIcon },
    { id: 'players', label: 'Players', icon: Users },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
];

/** Name the suit. Shown only to whoever played the wild. */
function SuitChooser({ suits, onPick }) {
    return (
        <Modal open dismissable={false} width={420}>
            <div className="flex flex-col gap-4 p-6">
                <div className="flex flex-col gap-1">
                    <span className="label">Your wild</span>
                    <span className="text-xl">Name the suit that carries on</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    {Object.entries(suits || {}).map(([id, suit]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => onPick(id)}
                            className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:brightness-125"
                            style={{ borderColor: alpha(suit.color, 0.5), background: alpha(suit.color, 0.12) }}
                        >
                            <span className="size-5 rounded-full" style={{ background: suit.color }} />
                            <span className="text-[15px]">{suit.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

export function Nouno() {
    const { state, me, hand, playerId, isMyTurn, spectating, send, leaveRoom } = useGame();
    const [tab, setTab] = useState('table');

    const suits = state.suits;
    const seated = state.players.find((p) => p.id === playerId) || null;
    const current = state.players[state.turnIndex] || null;
    const others = state.players.filter((p) => p.id !== playerId);
    const playable = useMemo(
        () => (isMyTurn && !state.choosing ? playableIds(hand, state.top, state.active) : new Set()),
        [hand, state.top, state.active, isMyTurn, state.choosing],
    );
    const mustName = state.choosing?.playerId === playerId;
    // Drawn and holding something unplayable: the way out is to pass.
    const canPass = isMyTurn && state.drawnThisTurn && !state.choosing;
    const said = new Set(state.saidLast || []);

    return (
        <div className="flex h-svh flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 px-4 py-1.5">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-medium tracking-tight">nouno</span>
                    <PresencePill />
                    <VoteStatusChip />
                </div>
                <div className="flex items-center gap-3">
                    <TurnArrow direction={state.direction} />
                    <span className="mono rounded-lg border border-dashed border-white/15 px-3 py-1 text-[13px] tracking-[0.2em]">
                        {state.roomCode}
                    </span>
                    {spectating && (
                        <span className="label flex items-center gap-1.5">
                            <Eye className="size-3.5" /> watching
                        </span>
                    )}
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={leaveRoom}>
                        Leave
                    </Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 xl:grid xl:grid-cols-[288px_minmax(0,1fr)] xl:gap-4">
                {/* The table itself. Its own column so the fan at the bottom is
                    never inside anything that clips it — a lifted card leaves
                    its row, which an `overflow-hidden` ancestor would cut off. */}
                <main
                    className={cn(
                        'relative min-h-0 flex-1 xl:col-start-2 xl:row-start-1',
                        tab === 'table' ? 'block' : 'hidden xl:block',
                    )}
                >
                    {/* The table. An ellipse rather than the whole rectangle,
                        so the seats sit round something instead of floating in
                        a column. */}
                    <div
                        className="pointer-events-none absolute top-[44%] left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/[0.06]"
                        // Sized off the same numbers the seats are placed
                        // with (Seats.jsx: 34% across, 27% down), so people sit
                        // at the table rather than near it.
                        style={{
                            width: '66%',
                            height: '52%',
                            background:
                                'radial-gradient(ellipse at 50% 42%, rgba(124,92,255,.10), rgba(20,20,30,.55) 60%, rgba(12,12,18,.7) 100%)',
                            boxShadow: 'inset 0 0 6em rgba(0,0,0,.55), 0 2em 5em -3em rgba(0,0,0,.9)',
                        }}
                    />

                    {/* Everyone else, round the far side of it. */}
                    <Seats players={others} currentId={current?.id} said={said} />

                    {/* The middle: what is left to draw, and what is in play. */}
                    <div className="absolute top-[44%] left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-10">
                        <Stock
                            count={state.stockCount}
                            canDraw={isMyTurn && !state.drawnThisTurn && !state.choosing}
                            onDraw={() => send('nouno:draw')}
                            size={19}
                        />
                        <Pile top={state.top} active={state.active} suits={suits} count={state.pileCount} size={19} />
                    </div>

                    {/* Whose turn, and what you can do about it, on one line
                        between the table and your own cards. The buttons are
                        here rather than under the fan, where a lifted card
                        would cover them. */}
                    <div className="absolute inset-x-0 bottom-[15rem] flex items-center justify-center gap-3 text-[14px]">
                        {current && (
                            <span className="flex items-center gap-2">
                                <span
                                    className="mono flex size-6 items-center justify-center rounded-full text-[9px] text-white"
                                    style={{ background: current.color }}
                                >
                                    {tag(current)}
                                </span>
                                <span className={isMyTurn ? 'font-medium' : 'text-muted-foreground'}>
                                    {isMyTurn ? 'Your turn' : `${current.name} to play`}
                                </span>
                            </span>
                        )}
                        {canPass && (
                            <Button variant="outline" size="sm" onClick={() => send('nouno:pass')}>
                                Pass
                            </Button>
                        )}
                        {seated && hand.length <= 2 && !said.has(playerId) && (
                            <Button size="sm" onClick={() => send('nouno:last')}>
                                Last card!
                            </Button>
                        )}
                    </div>

                    {/* Your hand: your side of the table, and the only cards
                        drawn face up. Bigger than everyone else's on purpose —
                        these are the ones you have to read and choose between. */}
                    {seated && (
                        <div className="absolute inset-x-0 bottom-7">
                            <Hand
                                cards={hand}
                                suits={suits}
                                playableIds={playable}
                                disabled={!isMyTurn || !!state.choosing}
                                onPlay={(card) => send('nouno:play', { cardId: card.id })}
                                size={21}
                            />
                        </div>
                    )}

                </main>

                <aside
                    className={cn(
                        'scroll-thin min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:col-start-1 xl:row-start-1 xl:flex',
                        tab === 'players' || tab === 'chat' ? 'flex' : 'hidden',
                    )}
                >
                    <div className={cn('min-h-0 flex-col xl:contents', tab === 'players' ? 'flex' : 'hidden')}>
                        <section className="panel flex shrink-0 flex-col">
                            <header className="panel-divider flex items-center justify-between px-4 py-3">
                                <span className="label">Players ({state.players.length})</span>
                                <VoteKickPicker />
                            </header>
                            <div className="flex flex-col gap-1.5 p-3">
                                {state.players.map((p) => (
                                    <div
                                        key={p.id}
                                        className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2"
                                        style={{
                                            borderColor:
                                                current?.id === p.id ? alpha(p.color, 0.5) : 'var(--border)',
                                            background:
                                                current?.id === p.id ? alpha(p.color, 0.08) : 'transparent',
                                        }}
                                    >
                                        <span
                                            className="mono flex size-6 items-center justify-center rounded-full text-[9px] text-white"
                                            style={{ background: p.color, opacity: p.out ? 0.4 : 1 }}
                                        >
                                            {tag(p)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
                                        {said.has(p.id) && (
                                            <span className="label !text-[9px] text-[#ffb648]">last card</span>
                                        )}
                                        <span className="mono text-[12px] text-muted-foreground">
                                            {p.out ? 'out' : `${p.handCount} cards`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                    {/* The feed comes off the table and into the rail: the
                        middle of a table is for cards. */}
                    <section className="panel hidden shrink-0 flex-col py-3 xl:flex">
                        <span className="label px-4 pb-1">What happened</span>
                        <div className="flex justify-center">
                            <GameFeed />
                        </div>
                    </section>
                    <div className={cn('min-h-0 flex-1 flex-col xl:contents', tab === 'chat' ? 'flex' : 'hidden')}>
                        <ChatLog />
                    </div>
                </aside>
            </div>

            <nav className="flex shrink-0 gap-1 border-t border-white/8 px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] xl:hidden">
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={cn(
                            'relative flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] transition-colors',
                            tab === id ? 'text-foreground' : 'text-muted-foreground',
                        )}
                    >
                        {tab === id && (
                            <motion.span layoutId="nouno-tab" className="absolute inset-0 rounded-lg bg-white/[0.07]" />
                        )}
                        <Icon className="relative size-4" />
                        <span className="relative">{label}</span>
                    </button>
                ))}
            </nav>

            {mustName && <SuitChooser suits={suits} onPick={(suit) => send('nouno:suit', { suit })} />}
            <VoteKickModal />
        </div>
    );
}

export { CardFace };
