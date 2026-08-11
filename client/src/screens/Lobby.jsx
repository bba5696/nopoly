import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Coins, Copy, Crown, Gavel, Hammer, LogOut, Palmtree, Percent, Scale, ShieldOff, TrendingUp, Users } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Toggle, NumberField } from '@/components/ui/toggle';
import { alpha, initials } from '@/lib/color';
import { cn } from '@/lib/utils';

/**
 * The settings column is tabbed rather than one long list — the whole lobby
 * used to push the page into a scroll, and the beta rules read better kept
 * apart from the ones people already know.
 */
const TABS = [
    { id: 'board', label: 'Board' },
    { id: 'rules', label: 'Rules' },
    { id: 'beta', label: 'Beta' },
];

/**
 * Miniature of a board's ring, drawn from the group colour of each tile. Gives
 * the picker a shape you can recognise — the longer board is visibly denser —
 * without shipping the whole layout to the lobby.
 */
function BoardMini({ ring, active }) {
    const per = ring.length / 4;
    const grid = per + 1;
    const cells = ring.map((color, id) => {
        let row;
        let col;
        if (id <= per) {
            row = 1;
            col = 1 + id;
        } else if (id <= per * 2) {
            row = 1 + (id - per);
            col = grid;
        } else if (id <= per * 3) {
            row = grid;
            col = grid - (id - per * 2);
        } else {
            row = grid - (id - per * 3);
            col = 1;
        }
        return { id, color, row, col };
    });
    return (
        <span
            className="grid shrink-0 gap-px rounded-[3px] p-px transition-colors"
            style={{
                gridTemplateColumns: `repeat(${grid}, 1fr)`,
                gridTemplateRows: `repeat(${grid}, 1fr)`,
                width: 52,
                height: 52,
                background: active ? 'rgba(255,255,255,.07)' : 'transparent',
            }}
        >
            {cells.map((c) => (
                <span
                    key={c.id}
                    style={{
                        gridRow: c.row,
                        gridColumn: c.col,
                        borderRadius: 1,
                        background: c.color || 'rgba(255,255,255,.22)',
                        opacity: active ? 1 : 0.55,
                    }}
                />
            ))}
        </span>
    );
}

const RULES = [
    {
        key: 'doubleRent',
        icon: Percent,
        label: '×2 rent on full-set properties',
        hint: 'If a player owns a full property set, the base rent payment will be doubled',
    },
    {
        key: 'vacationCash',
        icon: Palmtree,
        label: 'Vacation cash',
        hint: 'If a player lands on Vacation, all collected money from taxes and bank payments will be earned',
    },
    {
        key: 'auction',
        icon: Gavel,
        label: 'Auction',
        hint: 'If someone skips purchasing the property landed on, it will be sold to the highest bidder',
    },
    {
        key: 'noRentInPrison',
        icon: ShieldOff,
        label: "Don't collect rent while in prison",
        hint: 'Rent will not be collected when landing on properties whose owners are in prison',
    },
    {
        key: 'evenBuild',
        icon: Hammer,
        label: 'Even build',
        hint: 'Houses and hotels must be built up and sold off evenly within a property set',
    },
    {
        key: 'dynamicValues',
        icon: TrendingUp,
        label: 'Dynamic property values',
        hint: 'Prices drift with how often a property gets landed on and what it fetches at auction. Rent follows too, until the property is built up or its set is complete',
        beta: true,
    },
    {
        key: 'auctionBalance',
        icon: Scale,
        label: 'Auction balance',
        hint: 'Auctions open at half the property’s value instead of $2, so nothing goes for pocket change',
        beta: true,
    },
];

const CORE_RULES = RULES.filter((r) => !r.beta);
const BETA_RULES = RULES.filter((r) => r.beta);

/** One line of the settings list: icon, label, explanation, control. */
function SettingRow({ icon: Icon, label, hint, beta, children }) {
    return (
        <div className="flex items-start gap-3 rounded-lg px-1 py-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-[15px] leading-tight">
                    {label}
                    {beta && (
                        <span className="label rounded-full bg-[#7c5cff]/20 px-1.5 py-0.5 !text-[9px] text-[#a68cff]">
                            beta
                        </span>
                    )}
                </span>
                <span className="text-[12px] leading-snug text-muted-foreground">{hint}</span>
            </div>
            {children}
        </div>
    );
}

export function Lobby() {
    const { state, playerId, isHost, send, leaveRoom } = useGame();
    const [copied, setCopied] = useState(false);
    const [tab, setTab] = useState('rules');
    const settings = state.settings;
    // Surfaced on the tab itself, so an experimental rule someone turned on
    // isn't hidden behind a tab nobody opens.
    const activeBeta = BETA_RULES.filter((r) => settings[r.key]).length;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(state.roomCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            /* clipboard blocked — the code is on screen anyway */
        }
    };

    const patch = (key) => (value) => send('room:settings', { [key]: value });

    return (
        // The panel is capped to the viewport and scrolls internally, so a long
        // player list or a long rule list never drags the whole page into a
        // scrollbar.
        <div className="flex h-svh items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel flex max-h-full w-full max-w-[980px] flex-col overflow-hidden"
            >
                <header className="panel-divider flex shrink-0 flex-wrap items-center justify-between gap-3 px-7 py-5">
                    <span className="text-2xl font-medium tracking-tight">nopoly</span>
                    <div className="flex items-center gap-3">
                        <span className="mono rounded-lg border border-dashed border-white/15 px-4 py-2 text-lg tracking-[0.28em]">
                            {state.roomCode}
                        </span>
                        <Button variant="outline" className="h-10" onClick={copy}>
                            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy code'}
                        </Button>
                        <Button variant="ghost" className="h-10 text-muted-foreground" onClick={leaveRoom}>
                            <LogOut /> Leave
                        </Button>
                    </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-7 lg:flex-row lg:overflow-visible">
                    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto">
                        <span className="label shrink-0">
                            Players ({state.players.length}/{settings.maxPlayers})
                        </span>
                        {state.players.map((p) => (
                            <motion.div
                                layout
                                key={p.id}
                                className="flex shrink-0 items-center gap-3.5 rounded-xl border px-4 py-3"
                                style={{ borderColor: alpha(p.color, 0.35), background: alpha(p.color, 0.07) }}
                            >
                                <span
                                    className="mono flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                                    style={{ background: `linear-gradient(160deg, ${p.color}, ${alpha(p.color, 0.6)})` }}
                                >
                                    {initials(p.name)}
                                </span>
                                <span className="flex-1 truncate text-lg">{p.name}</span>
                                {p.id === playerId && <span className="label">you</span>}
                                {p.id === state.hostId && <Crown className="size-4 text-[#ffb648]" />}
                            </motion.div>
                        ))}
                        {state.players.length < settings.maxPlayers && (
                            <div className="flex shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 px-4 py-4 text-[15px] text-muted-foreground">
                                empty seat — share the code
                            </div>
                        )}
                    </div>

                    <div className="flex w-full min-w-0 flex-col lg:w-[440px]">
                        <div className="flex shrink-0 gap-1 rounded-xl bg-white/[0.04] p-1">
                            {TABS.map(({ id, label }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setTab(id)}
                                    className={cn(
                                        'relative flex-1 rounded-lg px-3 py-2 text-[13px] transition-colors',
                                        tab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    {tab === id && (
                                        <motion.span
                                            layoutId="lobby-tab"
                                            className="absolute inset-0 rounded-lg bg-white/[0.09]"
                                            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                                        />
                                    )}
                                    <span className="relative flex items-center justify-center gap-1.5">
                                        {label}
                                        {id === 'beta' && activeBeta > 0 && (
                                            <span className="mono rounded-full bg-[#7c5cff]/25 px-1.5 text-[10px] text-[#a68cff]">
                                                {activeBeta}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* A fixed height, so the card doesn't resize when you
                            switch tabs and a longer rule list scrolls in place
                            rather than growing the panel. */}
                        <div className="scroll-thin h-[356px] overflow-y-auto py-2">
                            {tab === 'board' && (
                                <div className="flex flex-col gap-2">
                                    {(state.boards || []).map((b) => {
                                        const active = settings.board === b.id;
                                        return (
                                            <button
                                                key={b.id}
                                                type="button"
                                                disabled={!isHost}
                                                onClick={() => patch('board')(b.id)}
                                                className={cn(
                                                    'flex items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:cursor-default',
                                                    active
                                                        ? 'border-primary/50 bg-primary/10'
                                                        : 'border-white/8 hover:border-white/20 disabled:hover:border-white/8',
                                                )}
                                            >
                                                <BoardMini ring={b.ring} active={active} />
                                                <span className="flex min-w-0 flex-1 flex-col">
                                                    <span className="text-[15px] leading-tight">{b.name}</span>
                                                    <span className="text-[12px] leading-snug text-muted-foreground">
                                                        {b.tagline}
                                                    </span>
                                                    <span className="mono mt-1 text-[11px] text-muted-foreground">
                                                        {b.size} tiles · {b.countries} countries
                                                    </span>
                                                </span>
                                                {active && <Check className="size-4 shrink-0 text-primary" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {tab === 'rules' &&
                                CORE_RULES.map((rule) => (
                                    <SettingRow key={rule.key} {...rule}>
                                        <Toggle
                                            label={rule.label}
                                            checked={!!settings[rule.key]}
                                            disabled={!isHost}
                                            onChange={patch(rule.key)}
                                        />
                                    </SettingRow>
                                ))}

                            {tab === 'beta' && (
                                <>
                                    <p className="mb-1 rounded-lg border border-[#7c5cff]/25 bg-[#7c5cff]/[0.07] px-3 py-2 text-[12px] leading-snug text-muted-foreground">
                                        Experimental rules, off by default. They change how the game plays and
                                        can't be switched once it starts.
                                    </p>
                                    {BETA_RULES.map((rule) => (
                                        <SettingRow key={rule.key} {...rule}>
                                            <Toggle
                                                label={rule.label}
                                                checked={!!settings[rule.key]}
                                                disabled={!isHost}
                                                onChange={patch(rule.key)}
                                            />
                                        </SettingRow>
                                    ))}
                                </>
                            )}
                        </div>

                        {/* Below the divider and outside the tabs — these two
                            apply whichever tab you're looking at. */}
                        <div className="shrink-0 border-t border-white/8 pt-1.5">
                            <SettingRow
                                icon={Coins}
                                label="Starting cash"
                                hint="Adjust how much money players start the game with"
                            >
                                <NumberField
                                    value={settings.startingCash}
                                    disabled={!isHost}
                                    min={500}
                                    max={10000}
                                    step={100}
                                    onChange={patch('startingCash')}
                                />
                            </SettingRow>
                            <SettingRow
                                icon={Users}
                                label="Maximum players"
                                hint="How many players can join the game — set it as high as you like"
                            >
                                <NumberField
                                    value={settings.maxPlayers}
                                    disabled={!isHost}
                                    min={Math.max(2, state.players.length)}
                                    max={999}
                                    onChange={patch('maxPlayers')}
                                />
                            </SettingRow>
                        </div>

                        <Button
                            className="mt-3 shrink-0 text-lg"
                            style={{ height: 52 }}
                            disabled={!isHost || state.players.length < 2}
                            onClick={() => send('game:start')}
                        >
                            Start game
                        </Button>
                        <span className="label mt-1 text-center">
                            {isHost
                                ? state.players.length < 2
                                    ? 'need at least 2 players'
                                    : 'you are the host'
                                : 'only the host can change the rules'}
                        </span>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
