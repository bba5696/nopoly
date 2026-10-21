import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, Eye, Lightbulb, Map as MapIcon, MessageSquare, Minus, Plus, Users } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { PresencePill } from '@/components/ui/presence';
import { ChatLog } from '@/components/rails/ChatLog';
import { GameFeed } from '@/components/board/GameFeed';
import { VoteKickModal, VoteKickPicker, VoteStatusChip } from '@/components/modals/VoteKickModal';
import { IslandBoard } from '@/components/notan/IslandBoard';
import { ResourceIcon } from '@/components/notan/ResourceIcon';
import { Tip } from '@/components/notan/Tip';
import { BUILDS, DEV_BLURB, EMPTY_HAND, LOOK, RESOURCES, canAfford, count, describe, hintFor, shortOf } from '@/lib/notan';
import { alpha, tag } from '@/lib/color';
import { playRoll, playTurn } from '@/lib/sound';
import { cn } from '@/lib/utils';

const TABS = [
    { id: 'board', label: 'Island', icon: MapIcon },
    { id: 'players', label: 'Players', icon: Users },
    { id: 'chat', label: 'Chat', icon: MessageSquare },
];

const HINTS_KEY = 'nopoly.notan.hints';
const readHints = () => {
    try {
        return localStorage.getItem(HINTS_KEY) !== 'off';
    } catch {
        return true;
    }
};

/* ------------------------------------------------------------ small parts */

function Cost({ cost, have }) {
    return (
        <span className="flex flex-wrap items-center gap-0.5">
            {RESOURCES.filter((r) => cost?.[r]).map((r) =>
                Array.from({ length: cost[r] }, (_, i) => (
                    <span
                        key={`${r}-${i}`}
                        title={LOOK[r].name}
                        className={cn('flex', have && (have[r] || 0) <= i && 'opacity-30 grayscale')}
                    >
                        <ResourceIcon kind={r} size={14} />
                    </span>
                )),
            )}
        </span>
    );
}

/** Keyed by the roll, so every new one tumbles in. */
function Die({ value }) {
    const dots = {
        1: [[50, 50]],
        2: [[28, 28], [72, 72]],
        3: [[28, 28], [50, 50], [72, 72]],
        4: [[28, 28], [72, 28], [28, 72], [72, 72]],
        5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
        6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
    }[value] || [];
    return (
        <motion.svg
            viewBox="0 0 100 100"
            className="size-9"
            initial={{ rotate: -120, scale: 1.3 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 16 }}
        >
            <rect x="4" y="4" width="92" height="92" rx="18" fill="#f6efe0" stroke="#0b0a12" strokeWidth="4" />
            {dots.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="9" fill="#1c1a24" />
            ))}
        </motion.svg>
    );
}

/** A row of + / − pickers, one per resource. */
function Picker({ value, onChange, max }) {
    return (
        <div className="grid grid-cols-5 gap-1.5">
            {RESOURCES.map((r) => {
                const n = value[r] || 0;
                const top = max ? max[r] ?? 99 : 99;
                return (
                    <div key={r} className="flex flex-col items-center gap-1 rounded-lg border border-white/8 bg-white/[0.03] py-2">
                        <ResourceIcon kind={r} size={22} />
                        <span className="mono text-[15px]">{n}</span>
                        <div className="flex gap-1">
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.06] p-1 disabled:opacity-30"
                                disabled={n <= 0}
                                onClick={() => onChange({ ...value, [r]: n - 1 })}
                                aria-label={`One less ${r}`}
                            >
                                <Minus className="size-3" />
                            </button>
                            <button
                                type="button"
                                className="rounded-md bg-white/[0.06] p-1 disabled:opacity-30"
                                disabled={n >= top}
                                onClick={() => onChange({ ...value, [r]: n + 1 })}
                                aria-label={`One more ${r}`}
                            >
                                <Plus className="size-3" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function ResourcePick({ value, onPick, disabled }) {
    return (
        <div className="grid grid-cols-5 gap-1.5">
            {RESOURCES.map((r) => (
                <button
                    key={r}
                    type="button"
                    disabled={disabled?.(r)}
                    onClick={() => onPick(r)}
                    className={cn(
                        'flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] transition-colors disabled:opacity-30',
                        value === r ? 'border-primary/70 bg-primary/15' : 'border-white/8 hover:border-white/25',
                    )}
                >
                    <ResourceIcon kind={r} size={22} />
                    {LOOK[r].name}
                </button>
            ))}
        </div>
    );
}

/* ---------------------------------------------------------------- modals */

function TradeModal({ open, onClose, hand, state, send }) {
    const [tab, setTab] = useState('bank');
    const [give, setGive] = useState(null);
    const [get, setGet] = useState(null);
    const [offerGive, setOfferGive] = useState({});
    const [offerGet, setOfferGet] = useState({});
    const res = hand.resources;
    const rate = give ? hand.rates[give] : null;
    const mine = state.offer && state.offer.fromId === state.players[state.turnIndex]?.id;

    return (
        <Modal open={open} onClose={onClose} subtitle="Your turn" title="Trade" width={480}>
            <div className="flex flex-col gap-4 p-5">
                <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
                    {[
                        ['bank', 'With the bank'],
                        ['players', 'With players'],
                    ].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setTab(id)}
                            className={cn('flex-1 rounded-lg px-3 py-2 text-[13px]', tab === id ? 'bg-white/[0.09]' : 'text-muted-foreground')}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'bank' ? (
                    <>
                        <p className="text-[12px] text-muted-foreground">
                            Give 4 of one kind for 1 of any other. A town on a harbour makes it 3:1, or 2:1 for that
                            harbour’s resource.
                        </p>
                        <span className="label">You give</span>
                        <ResourcePick value={give} onPick={setGive} disabled={(r) => (res[r] || 0) < hand.rates[r]} />
                        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                            {RESOURCES.map((r) => (
                                <span key={r} className="flex items-center gap-1">
                                    <ResourceIcon kind={r} size={12} /> {hand.rates[r]}:1
                                </span>
                            ))}
                        </div>
                        <span className="label">You get</span>
                        <ResourcePick value={get} onPick={setGet} disabled={(r) => r === give || !state.bank?.[r]} />
                        <Button
                            className="h-11"
                            disabled={!give || !get || give === get}
                            onClick={() => {
                                send('notan:bank', { give, get });
                                setGet(null);
                                if ((res[give] || 0) - rate < rate) setGive(null);
                            }}
                        >
                            {give && get ? `Trade ${rate} ${LOOK[give].name.toLowerCase()} for 1 ${LOOK[get].name.toLowerCase()}` : 'Pick both sides'}
                        </Button>
                    </>
                ) : (
                    <>
                        {mine ? (
                            <div className="flex flex-col gap-3 rounded-xl border border-white/10 p-4">
                                <span className="text-[14px]">
                                    Offering {describe(state.offer.give)} for {describe(state.offer.get)}
                                </span>
                                <span className="text-[12px] text-muted-foreground">
                                    {state.offer.declined.length
                                        ? `Turned down by ${state.offer.declined.map((id) => state.players.find((p) => p.id === id)?.name).join(', ')}`
                                        : 'Waiting for someone to accept…'}
                                </span>
                                <Button variant="outline" onClick={() => send('notan:decline', { offerId: state.offer.id })}>
                                    Withdraw offer
                                </Button>
                            </div>
                        ) : (
                            <>
                                <span className="label">You give</span>
                                <Picker value={offerGive} onChange={setOfferGive} max={res} />
                                <span className="label">You want</span>
                                <Picker value={offerGet} onChange={setOfferGet} />
                                <Button
                                    className="h-11"
                                    disabled={!count(offerGive) || !count(offerGet)}
                                    onClick={() => {
                                        send('notan:offer', { give: offerGive, get: offerGet });
                                        setOfferGive({});
                                        setOfferGet({});
                                    }}
                                >
                                    Offer to everyone
                                </Button>
                                <p className="text-[12px] text-muted-foreground">
                                    The first player to accept gets the trade.
                                </p>
                            </>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

function DiscardModal({ need, hand, send }) {
    const [pick, setPick] = useState({});
    const picked = count(pick);
    return (
        <Modal open dismissable={false} subtitle="A seven was rolled" title={`Give back ${need} cards`} width={460}>
            <div className="flex flex-col gap-4 p-5">
                <p className="text-[13px] text-muted-foreground">
                    Anyone holding more than 7 cards returns half to the bank. Keep what you need most.
                </p>
                <Picker value={pick} onChange={setPick} max={hand.resources} />
                <Button className="h-11" disabled={picked !== need} onClick={() => send('notan:discard', { cards: pick })}>
                    {picked === need ? 'Discard these' : `Pick ${need - picked} more`}
                </Button>
            </div>
        </Modal>
    );
}

function StealModal({ state, send }) {
    return (
        <Modal open dismissable={false} subtitle="The robber" title="Steal a card from…" width={400}>
            <div className="flex flex-col gap-2 p-5">
                {(state.stealFrom || []).map((id) => {
                    const p = state.players.find((x) => x.id === id);
                    if (!p) return null;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => send('notan:steal', { victimId: id })}
                            className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left hover:brightness-125"
                            style={{ borderColor: alpha(p.color, 0.5), background: alpha(p.color, 0.1) }}
                        >
                            <span className="size-4 rounded-full" style={{ background: p.color }} />
                            <span className="flex-1 text-[15px]">{p.name}</span>
                            <span className="mono text-[12px] text-muted-foreground">{p.cardCount} cards</span>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}

function DevPlayModal({ card, onClose, send }) {
    const [picks, setPicks] = useState([]);
    const [one, setOne] = useState(null);
    if (!card) return null;
    const plenty = card.kind === 'plenty';
    return (
        <Modal open onClose={onClose} subtitle="Development card" title={plenty ? 'Year of Plenty' : 'Monopoly'} width={440}>
            <div className="flex flex-col gap-4 p-5">
                <p className="text-[13px] text-muted-foreground">{DEV_BLURB[card.kind]}</p>
                {plenty ? (
                    <>
                        <ResourcePick onPick={(r) => setPicks((p) => (p.length >= 2 ? [p[1], r] : [...p, r]))} />
                        <span className="flex items-center gap-1.5 text-[13px]">
                            Taking:{' '}
                            {picks.length
                                ? picks.map((r, i) => <ResourceIcon key={i} kind={r} size={16} />)
                                : 'pick two (can be the same)'}
                        </span>
                        <Button
                            className="h-11"
                            disabled={picks.length !== 2}
                            onClick={() => {
                                send('notan:dev', { cardId: card.id, resources: picks });
                                onClose();
                            }}
                        >
                            Take them
                        </Button>
                    </>
                ) : (
                    <>
                        <ResourcePick value={one} onPick={setOne} />
                        <Button
                            className="h-11"
                            disabled={!one}
                            onClick={() => {
                                send('notan:dev', { cardId: card.id, resource: one });
                                onClose();
                            }}
                        >
                            {one ? `Take everyone’s ${LOOK[one].name.toLowerCase()}` : 'Pick a resource'}
                        </Button>
                    </>
                )}
            </div>
        </Modal>
    );
}

/** "1 × brick", a line per resource, for a trade you have to read at a glance. */
function Bundle({ res, have }) {
    return (
        <div className="flex flex-col gap-1">
            {RESOURCES.filter((r) => res?.[r]).map((r) => {
                const short = have && (have[r] || 0) < res[r];
                return (
                    <span key={r} className={cn('flex items-center gap-2 text-[14px]', short && 'text-[#ff5c7c]')}>
                        <ResourceIcon kind={r} size={20} />
                        <span className="mono">{res[r]}</span>
                        <span>{LOOK[r].name.toLowerCase()}</span>
                    </span>
                );
            })}
        </div>
    );
}

/** Somebody else's offer, over the board where it cannot be missed. */
function OfferCard({ state, hand, playerId, send }) {
    const o = state.offer;
    if (!o || o.fromId === playerId || o.declined?.includes(playerId)) return null;
    const from = state.players.find((p) => p.id === o.fromId);
    const able = canAfford(hand.resources, o.get);
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel absolute top-14 left-1/2 z-10 flex w-[min(92%,380px)] -translate-x-1/2 flex-col gap-3 p-4"
            style={{ borderColor: alpha(from?.color || '#7c5cff', 0.6) }}
        >
            <span className="text-[14px]">
                <b>{from?.name}</b> offers a trade
            </span>
            <div className="grid grid-cols-2 gap-2 text-[13px]">
                <div className="flex flex-col gap-1.5 rounded-lg bg-white/[0.04] p-2.5">
                    <span className="label">You get</span>
                    <Bundle res={o.give} />
                </div>
                <div className="flex flex-col gap-1.5 rounded-lg bg-white/[0.04] p-2.5">
                    <span className="label">You give</span>
                    <Bundle res={o.get} have={hand.resources} />
                </div>
            </div>
            <div className="flex gap-2">
                <Button className="flex-1" disabled={!able} onClick={() => send('notan:accept', { offerId: o.id })}>
                    {able ? 'Accept' : 'You don’t have it'}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => send('notan:decline', { offerId: o.id })}>
                    No thanks
                </Button>
            </div>
        </motion.div>
    );
}

/* ---------------------------------------------------------------- screen */

export function Notan() {
    const { state, hand: raw, playerId, isMyTurn, spectating, send, leaveRoom } = useGame();
    const hand = raw && raw.resources ? raw : EMPTY_HAND;
    const [tab, setTab] = useState('board');
    const [picked, setMode] = useState(null); // what the next click on the board builds
    const [tradeOpen, setTradeOpen] = useState(false);
    const [devCard, setDevCard] = useState(null);
    const [hints, setHints] = useState(readHints);

    const me = state.players.find((p) => p.id === playerId) || null;
    const current = state.players[state.turnIndex] || null;
    const colorOf = useMemo(() => {
        const by = Object.fromEntries(state.players.map((p) => [p.id, p.color]));
        return (id) => by[id] || '#888';
    }, [state.players]);
    const nameOf = (id) => state.players.find((p) => p.id === id)?.name;
    const costs = state.costs || {};
    const res = hand.resources;
    const step = state.step;

    // Only ever your own turn's choice: a pick left over from last turn is no pick.
    const mode = isMyTurn && step === 'main' ? picked : null;

    // In setup and with the robber, the board knows what the click is for.
    const boardMode = !isMyTurn
        ? null
        : step === 'setup'
          ? state.setup?.need
          : step === 'robber'
            ? 'robber'
            : state.freeRoads > 0
              ? 'road'
              : step === 'main'
                ? mode
                : null;

    // Sounds: the dice, and your turn coming round.
    const seenDice = useRef(state.diceSeq);
    useEffect(() => {
        if (state.diceSeq && state.diceSeq !== seenDice.current) playRoll(!isMyTurn);
        seenDice.current = state.diceSeq;
    }, [state.diceSeq, isMyTurn]);
    const wasMine = useRef(isMyTurn);
    useEffect(() => {
        if (isMyTurn && !wasMine.current) playTurn();
        wasMine.current = isMyTurn;
    }, [isMyTurn]);

    const hint = hintFor({ state, hand, playerId, spectating });
    const toggleHints = () => {
        setHints((h) => {
            try {
                localStorage.setItem(HINTS_KEY, h ? 'off' : 'on');
            } catch {
                /* a preference that does not stick is still a preference */
            }
            return !h;
        });
    };

    const build = (kind, at) => {
        send('notan:build', { kind, at });
        if (kind !== 'road' || !(state.freeRoads > 0)) setMode(null);
    };
    const onVertex = (v) => build(boardMode === 'city' ? 'city' : 'settlement', v);
    const onEdge = (e) => build('road', e);
    const onHex = (h) => send('notan:robber', { hexId: h });

    const canBuild = (kind) => {
        if (!isMyTurn || step !== 'main') return false;
        if (kind === 'dev') return canAfford(res, costs.dev) && state.devLeft > 0;
        return canAfford(res, costs[kind]) && hand.legal[kind]?.length > 0;
    };

    const players = state.players;
    const latest = state.log?.[state.log.length - 1] || null;

    return (
        <div className="flex h-svh flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/8 px-4 py-1.5">
                <div className="flex items-center gap-3">
                    <span className="text-lg font-medium tracking-tight">notan</span>
                    <span className="label hidden sm:inline">first to {state.target || 10} points</span>
                    <PresencePill />
                    <VoteStatusChip />
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={toggleHints}
                        className={cn(
                            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px]',
                            hints ? 'border-primary/50 text-[#a68cff]' : 'border-white/10 text-muted-foreground',
                        )}
                        title="Show or hide the hint bar and the ★ suggestions"
                    >
                        <Lightbulb className="size-3.5" /> Hints {hints ? 'on' : 'off'}
                    </button>
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

            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 xl:grid xl:grid-cols-[300px_minmax(0,1fr)] xl:gap-4">
                <main
                    className={cn(
                        'relative min-h-0 flex-1 flex-col gap-2 xl:col-start-2 xl:row-start-1',
                        tab === 'board' ? 'flex' : 'hidden xl:flex',
                    )}
                >
                    {/* The line that says what to do. Always there for the
                        moments that are yours; the rest of the time only if
                        hints are on. */}
                    {(hints || hint.tone === 'you') && (
                        <div
                            className={cn(
                                'flex shrink-0 items-center gap-2.5 rounded-xl border px-4 py-2.5 text-[14px]',
                                hint.tone === 'you'
                                    ? 'border-primary/40 bg-primary/[0.08]'
                                    : 'border-white/8 bg-white/[0.03] text-muted-foreground',
                            )}
                        >
                            <Lightbulb className={cn('size-4 shrink-0', hint.tone === 'you' && 'text-[#a68cff]')} />
                            <span>{hint.text}</span>
                        </div>
                    )}

                    <div className="relative min-h-0 flex-1">
                        {state.map && (
                            <IslandBoard
                                map={state.map}
                                buildings={state.buildings}
                                roads={state.roads}
                                robber={state.robber}
                                colorOf={colorOf}
                                nameOf={nameOf}
                                legal={hand.legal}
                                mode={boardMode}
                                suggest={hints ? hand.suggest : null}
                                onVertex={onVertex}
                                onEdge={onEdge}
                                onHex={onHex}
                                produce={state.lastProduce}
                                setupVertex={step === 'setup' ? state.setup?.vertex : null}
                            />
                        )}
                        <OfferCard state={state} hand={hand} playerId={playerId} send={send} />

                        {/* The dice, top left of the sea. */}
                        <Tip
                            side="bottom"
                            className="absolute top-2 left-2"
                            text="The last roll. Every hex showing this number pays the towns on its corners — a 7 pays nobody and moves the robber."
                        >
                        <div className="flex items-center gap-1.5 rounded-xl bg-black/40 p-2 backdrop-blur-sm">
                            {state.dice ? (
                                <>
                                    <Die key={`a${state.diceSeq}`} value={state.dice[0]} />
                                    <Die key={`b${state.diceSeq}`} value={state.dice[1]} />
                                    <span className="mono ml-1 text-xl">{state.dice[0] + state.dice[1]}</span>
                                </>
                            ) : (
                                <span className="px-1 text-[12px] text-muted-foreground">no roll yet</span>
                            )}
                        </div>
                        </Tip>

                        <AnimatePresence mode="popLayout">
                            {latest && (
                                <motion.div
                                    key={latest.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="pointer-events-none absolute top-2 right-2 flex max-w-[55%] justify-end"
                                >
                                    <span className="rounded-xl bg-black/55 px-3 py-1.5 text-right text-[12px] backdrop-blur-sm">
                                        {latest.text}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Your side of the table: cards, what they build, and the turn. */}
                    {me && (
                        <section className="panel flex shrink-0 flex-col gap-3 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                {RESOURCES.map((r) => (
                                    <Tip key={r} text={`${LOOK[r].name} — you hold ${res[r] || 0}. Used for ${LOOK[r].uses}. Bank trade rate ${hand.rates[r]}:1.`}>
                                    <div
                                        className="flex min-w-[64px] items-center gap-2 rounded-xl border px-2.5 py-1.5"
                                        style={{ borderColor: alpha(LOOK[r].fill, 0.55), background: alpha(LOOK[r].fill, res[r] ? 0.2 : 0.05) }}
                                    >
                                        <ResourceIcon kind={r} size={20} />
                                        <span className={cn('mono text-lg', !res[r] && 'text-muted-foreground')}>{res[r] || 0}</span>
                                    </div>
                                    </Tip>
                                ))}
                                <div className="ml-auto flex items-center gap-2">
                                    <Tip text={`Your points, counting any hidden Victory Point cards. First to ${state.target || 10} wins.`}>
                                        <span className="mono text-[13px] text-muted-foreground">{hand.points} pts</span>
                                    </Tip>
                                    {isMyTurn && step === 'roll' && (
                                        <Button className="h-11 px-6 text-[15px]" onClick={() => send('notan:roll')}>
                                            Roll dice
                                        </Button>
                                    )}
                                    {isMyTurn && step === 'main' && (
                                        <>
                                            <Button variant="outline" className="h-11" onClick={() => setTradeOpen(true)}>
                                                <ArrowLeftRight className="size-4" /> Trade
                                            </Button>
                                            <Button className="h-11 px-5" onClick={() => send('notan:end')}>
                                                End turn
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {BUILDS.map((b) => {
                                    const able = canBuild(b.kind);
                                    const active = mode === b.kind;
                                    const missing = shortOf(res, costs[b.kind]);
                                    const why = able
                                        ? ''
                                        : !isMyTurn || step !== 'main'
                                          ? ' You can build after rolling, on your turn.'
                                          : count(missing)
                                            ? ` You need ${describe(missing)} more.`
                                            : b.kind === 'dev'
                                              ? ' The deck is empty.'
                                              : b.kind === 'settlement'
                                                ? ' No corner is free yet: it must touch your road and be at least two roads from every other town. Build a road out first.'
                                                : b.kind === 'city'
                                                  ? ' You have no settlement left to upgrade.'
                                                  : ' There is nowhere to put one right now.';
                                    return (
                                        <Tip key={b.kind} text={b.blurb + why} className="flex">
                                        <button
                                            type="button"
                                            disabled={!able}
                                            onClick={() => {
                                                if (b.kind === 'dev') return send('notan:build', { kind: 'dev' });
                                                setMode(active ? null : b.kind);
                                            }}
                                            className={cn(
                                                'flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40',
                                                active ? 'border-primary/70 bg-primary/10' : 'border-white/10 hover:border-white/30',
                                            )}
                                        >
                                            <span className="flex w-full items-center justify-between text-[14px]">
                                                {b.label}
                                                {b.points > 0 && <span className="label">+1 pt</span>}
                                            </span>
                                            <Cost cost={costs[b.kind]} have={res} />
                                        </button>
                                        </Tip>
                                    );
                                })}
                            </div>
                            {mode && step === 'main' && (
                                <span className="text-[12px] text-[#a68cff]">
                                    {mode === 'city' ? 'Click one of your settlements to upgrade it.' : `Click a glowing ${mode === 'road' ? 'edge' : 'corner'} on the island.`}{' '}
                                    <button type="button" className="underline" onClick={() => setMode(null)}>
                                        Cancel
                                    </button>
                                </span>
                            )}

                            {hand.dev.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {hand.dev.map((c) => (
                                        <Tip
                                            key={c.id}
                                            text={
                                                DEV_BLURB[c.kind] +
                                                (c.kind !== 'point' && !c.playable
                                                    ? state.devPlayed
                                                        ? ' One development card a turn.'
                                                        : ' Playable from your next turn.'
                                                    : '')
                                            }
                                        >
                                        <div className="flex items-center gap-2 rounded-xl border border-[#a68cff]/40 bg-[#7c5cff]/10 px-3 py-1.5">
                                            <span className="text-[13px]">{state.devNames?.[c.kind] || c.kind}</span>
                                            {c.kind !== 'point' && (
                                                <Button
                                                    size="xs"
                                                    disabled={!c.playable}
                                                    onClick={() =>
                                                        c.kind === 'plenty' || c.kind === 'monopoly'
                                                            ? setDevCard(c)
                                                            : send('notan:dev', { cardId: c.id })
                                                    }
                                                >
                                                    Play
                                                </Button>
                                            )}
                                        </div>
                                        </Tip>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </main>

                <aside
                    className={cn(
                        'scroll-thin min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:col-start-1 xl:row-start-1 xl:flex',
                        tab === 'players' || tab === 'chat' ? 'flex' : 'hidden',
                    )}
                >
                    <div className={cn('min-h-0 flex-col gap-3 xl:contents', tab === 'players' ? 'flex' : 'hidden')}>
                        <section className="panel flex shrink-0 flex-col">
                            <header className="panel-divider flex items-center justify-between px-4 py-3">
                                <span className="label">Players ({players.length})</span>
                                <VoteKickPicker />
                            </header>
                            <div className="flex flex-col gap-1.5 p-3">
                                {players.map((p) => (
                                    <div
                                        key={p.id}
                                        className="flex flex-col gap-1 rounded-lg border px-2.5 py-2"
                                        style={{
                                            borderColor: current?.id === p.id ? alpha(p.color, 0.6) : 'var(--border)',
                                            background: current?.id === p.id ? alpha(p.color, 0.1) : 'transparent',
                                            opacity: p.out ? 0.45 : 1,
                                        }}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <span
                                                className="mono flex size-6 items-center justify-center rounded-full text-[9px] text-white"
                                                style={{ background: p.color }}
                                            >
                                                {tag(p)}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-[14px]">
                                                {p.name}
                                                {p.id === playerId && <span className="text-muted-foreground"> (you)</span>}
                                                {p.bot && <span className="label ml-1.5">bot</span>}
                                            </span>
                                            <span className="mono text-[15px]">{p.id === playerId ? hand.points : p.points}</span>
                                            <span className="label">pts</span>
                                        </div>
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-8 text-[11px] text-muted-foreground">
                                            <Tip side="bottom" text="Resource cards in their hand. Over 7 when a 7 is rolled means giving half back.">
                                                <span>{p.cardCount} cards</span>
                                            </Tip>
                                            <Tip side="bottom" text="Development cards they hold, unplayed. Some may be hidden Victory Points.">
                                                <span>{p.devCount} dev</span>
                                            </Tip>
                                            <Tip side="bottom" text="Knights played. The first to 3, and the most, holds Largest Army (+2).">
                                                <span>{p.knights} knights</span>
                                            </Tip>
                                            <Tip side="bottom" text="Their longest unbroken road. The first to 5, and the longest, holds Longest Road (+2).">
                                                <span>road {p.roadLength}</span>
                                            </Tip>
                                            {state.longestRoad?.playerId === p.id && <span className="text-[#ffd34d]">Longest road +2</span>}
                                            {state.largestArmy?.playerId === p.id && <span className="text-[#ffd34d]">Largest army +2</span>}
                                            {p.out && <span>left</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="panel flex shrink-0 flex-col gap-2 p-4">
                            <span className="label">What things cost</span>
                            {BUILDS.map((b) => (
                                <div key={b.kind} className="flex items-center justify-between gap-2 text-[13px]">
                                    <span>{b.label}</span>
                                    <Cost cost={costs[b.kind]} />
                                </div>
                            ))}
                            <span className="pt-1 text-[11px] leading-snug text-muted-foreground">
                                Settlement 1 pt · City 2 pts · Longest road (5+) 2 pts · Largest army (3+ knights) 2 pts.
                            </span>
                            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                                Bank
                                {state.bank &&
                                    RESOURCES.map((r) => (
                                        <span key={r} className="mono flex items-center gap-1">
                                            <ResourceIcon kind={r} size={12} />
                                            {state.bank[r]}
                                        </span>
                                    ))}
                                · {state.devLeft} dev cards left
                            </span>
                        </section>
                    </div>
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
                        {tab === id && <motion.span layoutId="notan-tab" className="absolute inset-0 rounded-lg bg-white/[0.07]" />}
                        <Icon className="relative size-4" />
                        <span className="relative">{label}</span>
                    </button>
                ))}
            </nav>

            <TradeModal open={tradeOpen && isMyTurn && step === 'main'} onClose={() => setTradeOpen(false)} hand={hand} state={state} send={send} />
            {hand.discard > 0 && step === 'discard' && <DiscardModal need={hand.discard} hand={hand} send={send} />}
            {isMyTurn && step === 'steal' && <StealModal state={state} send={send} />}
            <DevPlayModal card={devCard} onClose={() => setDevCard(null)} send={send} />
            <VoteKickModal />
        </div>
    );
}
