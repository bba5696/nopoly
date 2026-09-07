import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Coins, Copy, Crown, Gavel, Hammer, LogOut, Palmtree, Pencil, Percent, Scale, ShieldOff, Timer, TrendingUp, UserMinus, Users, UsersRound } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';
import { Toggle, NumberField } from '@/components/ui/toggle';
import { PresencePill } from '@/components/ui/presence';
import { ProfileModal } from '@/components/modals/ProfileModal';
import { alpha, tag } from '@/lib/color';
import { cn } from '@/lib/utils';
import { playJoin, playPlayerJoined } from '@/lib/sound';

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
        key: 'turnTimer',
        icon: Timer,
        label: 'Turn timer',
        hint: 'A turn nobody is sitting in front of plays itself after a minute — rolls, buys nothing, and hands on. Any movement at all resets it, so thinking is free',
    },
    {
        key: 'evenBuild',
        icon: Hammer,
        label: 'Even build',
        hint: 'Houses and hotels must be built up and sold off evenly within a property set',
    },
    {
        key: 'teams',
        icon: UsersRound,
        label: 'Teams',
        hint: 'Teammates share properties, monopolies and a colour, but keep separate balances. Sides can be any size and don’t have to match. Rent goes to whoever holds the deed, and a teammate can bail you out of a debt you can’t cover',
        beta: true,
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

/**
 * Which team section a point is over, by hit-testing the sections' boxes.
 *
 * Sides are set by dragging a player onto one, because a row of letters was a
 * legend you had to learn: the sections are already on screen with the names in
 * them, so the thing you want to say — put this person with those people — is
 * the thing you do. Measured live rather than once at the start of the drag,
 * since the roster reflows the moment a row lifts out of it.
 */
/**
 * Nudge the roster along while a row is held near its top or bottom edge. The
 * column is its own scroller and eight sides do not fit in it — without this, a
 * side you can't see is a side you can't drop on.
 */
function edgeScroll(el, y) {
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (y < box.top + 64) el.scrollTop -= 14;
    else if (y > box.bottom - 64) el.scrollTop += 14;
}

function zoneAt(zones, x, y) {
    for (const [key, el] of zones) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
}

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
    const [profileOpen, setProfileOpen] = useState(false);

    // Landing in the lobby is a gesture-adjacent moment — the click that got
    // you here has already opened the audio context.
    useEffect(() => {
        playJoin();
    }, []);

    // A host setting up rules isn't watching the roster, so announce arrivals.
    // Seeded with the current count so the players already here on mount don't
    // all fire at once.
    const seenPlayers = useRef(state.players.length);
    useEffect(() => {
        if (state.players.length > seenPlayers.current) playPlayerJoined();
        seenPlayers.current = state.players.length;
    }, [state.players.length]);

    const [tab, setTab] = useState('rules');
    // The row being carried and the section under it. Both are only ever set
    // while a drag is in flight; `dragged` is the one that outlives it, long
    // enough to stop the drop from also counting as a click on the row.
    const [draggingId, setDraggingId] = useState(null);
    const [dragOver, setDragOver] = useState(null);
    const zones = useRef(new Map());
    const list = useRef(null);
    const dragged = useRef(false);
    const settings = state.settings;
    const away = state.players.filter((p) => !p.connected).length;
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

    const teamIds = state.teamIds || [];
    const teamColors = state.teamColors || {};

    // Grouped under team headers when teams are on, one flat group otherwise —
    // so the roster you set up here is laid out the way the rail will be.
    // Empty sides stay on screen, unlike the empty unassigned pile: a side with
    // nobody on it is a place to drop somebody, and a pile with nobody left in
    // it is a job finished.
    const roster = settings.teams
        ? [
              ...teamIds.map((id) => ({
                  key: id,
                  teamId: id,
                  players: state.players.filter((p) => p.teamId === id),
              })),
              { key: 'unassigned', teamId: null, players: state.players.filter((p) => !p.teamId) },
          ].filter((g) => g.teamId || g.players.length)
        : [{ key: 'all', teamId: null, players: state.players }];

    /** Only the host moves anyone, and only while there are sides to move between. */
    const canDrag = isHost && settings.teams;

    // Why the button is dead, in the same words the server would use.
    const blockedReason = (() => {
        if (state.players.length < 2) return 'need at least 2 players';
        if (!settings.teams) return null;
        const cap = settings.maxTeamSize;
        if (cap && teamIds.length * cap < state.players.length) {
            return `${teamIds.length} teams of ${cap} can't hold ${state.players.length} players`;
        }
        if (state.players.some((p) => !p.teamId)) return 'everyone needs a team';
        if (new Set(state.players.map((p) => p.teamId)).size < 2) return 'need at least 2 teams';
        return null;
    })();

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
                    <div className="flex items-center gap-3.5">
                        <span className="text-2xl font-medium tracking-tight">nopoly</span>
                        <PresencePill />
                    </div>
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
                    {/* `min-h-0` only from lg, where this column is its own
                        scroll container. Stacked, there's no overflow rule
                        here — the parent scrolls — so letting it shrink below
                        its content spills the roster over the settings. */}
                    <div
                        ref={list}
                        className="scroll-thin flex shrink-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                    >
                        <span className="label flex shrink-0 items-center gap-2">
                            Players ({state.players.length}/{settings.maxPlayers})
                            {/* Someone whose tab dropped still holds their seat
                                for a moment, and a host counting heads before
                                pressing Start should see that. */}
                            {away > 0 && <span className="text-[#ff5c7c]">{away} away</span>}
                            {canDrag && <span className="normal-case opacity-60">drag a player onto a side</span>}
                        </span>
                        {roster.map((group) => {
                            const cap = settings.maxTeamSize;
                            const full = !!cap && !!group.teamId && group.players.length >= cap;
                            // Lit only for a row that isn't already here — picking
                            // somebody up shouldn't make their own side look like a
                            // destination.
                            const over =
                                dragOver === group.key &&
                                !!draggingId &&
                                !group.players.some((p) => p.id === draggingId);
                            return (
                            <div
                                key={group.key}
                                ref={(el) => zones.current.set(group.key, el)}
                                className={cn(
                                    'flex shrink-0 flex-col gap-2',
                                    canDrag && 'rounded-xl border border-dashed p-2 transition-colors',
                                    canDrag &&
                                        (over
                                            ? full
                                                ? 'border-[#ff5c7c]/60 bg-[#ff5c7c]/[0.06]'
                                                : 'border-white/40 bg-white/[0.05]'
                                            : 'border-white/10'),
                                )}
                            >
                                {settings.teams && (
                                    <span className="label flex items-center gap-2 pt-1">
                                        <span
                                            className={cn('size-2 rounded-full', !group.teamId && 'border border-dashed border-white/40')}
                                            style={{ background: group.teamId ? teamColors[group.teamId] : 'transparent' }}
                                        />
                                        {group.teamId ? `Team ${group.teamId}` : 'No team'}
                                        {/* Sides are allowed to be uneven, so this
                                            is a count rather than a complaint —
                                            it's only there so the host can see the
                                            shape of the table before starting. */}
                                        <span className="normal-case opacity-70">
                                            {group.players.length === 1
                                                ? 'on their own'
                                                : `${group.players.length} players`}
                                            {full && ' · full'}
                                        </span>
                                    </span>
                                )}
                                {!group.players.length && (
                                    <div className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-center text-[13px] text-muted-foreground">
                                        {canDrag ? 'drag someone here to start this side' : 'nobody yet'}
                                    </div>
                                )}
                                {group.players.map((p) => (
                                    <motion.div
                                        layout
                                        key={p.id}
                                        drag={canDrag}
                                        // Back where it came from on a bad drop,
                                        // and no throwing: this is a list, not a
                                        // physics toy.
                                        dragSnapToOrigin
                                        dragMomentum={false}
                                        dragElastic={0.12}
                                        whileDrag={{ scale: 1.02, zIndex: 40, cursor: 'grabbing' }}
                                        onDragStart={() => {
                                            dragged.current = true;
                                            setDraggingId(p.id);
                                        }}
                                        onDrag={(e, info) => {
                                            const y = info.point.y - window.scrollY;
                                            edgeScroll(list.current, y);
                                            setDragOver(zoneAt(zones.current, info.point.x - window.scrollX, y));
                                        }}
                                        onDragEnd={(e, info) => {
                                            const key = zoneAt(
                                                zones.current,
                                                info.point.x - window.scrollX,
                                                info.point.y - window.scrollY,
                                            );
                                            setDraggingId(null);
                                            setDragOver(null);
                                            // Cleared late, because the click the
                                            // drop generates arrives after this.
                                            setTimeout(() => {
                                                dragged.current = false;
                                            }, 120);
                                            const teamId = key === 'unassigned' ? null : key;
                                            if (key && teamId !== p.teamId) send('room:team', { playerId: p.id, teamId });
                                        }}
                                        // Your own row opens your profile. Nobody
                                        // else's does anything, so there's no
                                        // mis-tap to make.
                                        role={p.id === playerId ? 'button' : undefined}
                                        onClick={
                                            p.id === playerId
                                                ? () => {
                                                      if (!dragged.current) setProfileOpen(true);
                                                  }
                                                : undefined
                                        }
                                        className={cn(
                                            'flex shrink-0 items-center gap-3 rounded-xl border px-4 py-3',
                                            p.id === playerId && 'cursor-pointer transition-colors hover:border-white/40',
                                            canDrag && 'cursor-grab',
                                        )}
                                        style={{ borderColor: alpha(p.color, 0.35), background: alpha(p.color, 0.07) }}
                                    >
                                        <span
                                            className="mono flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                                            style={{ background: `linear-gradient(160deg, ${p.color}, ${alpha(p.color, 0.6)})` }}
                                        >
                                            {tag(p)}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-lg">{p.name}</span>
                                        {p.id === playerId && (
                                            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                                                <span className="label">you</span>
                                                <Pencil className="size-3.5" />
                                            </span>
                                        )}
                                        {p.id === state.hostId && <Crown className="size-4 shrink-0 text-[#ffb648]" />}
                                        {/* Only in the lobby, and only for
                                            somebody else. Once the game starts
                                            this is a vote instead. */}
                                        {isHost && p.id !== playerId && (
                                            <button
                                                type="button"
                                                title={`Remove ${p.name} from the room`}
                                                onClick={() => send('room:kick', { playerId: p.id })}
                                                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-[#ff5c7c]/10 hover:text-[#ff5c7c]"
                                            >
                                                <UserMinus className="size-4" />
                                            </button>
                                        )}
                                    </motion.div>
                                ))}
                            </div>
                            );
                        })}
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
                            {/* Only while teams are on — off, they are two
                                numbers about nothing. Changing either re-deals
                                the sides, which is what the hint warns about. */}
                            {settings.teams && (
                                <>
                                    <SettingRow
                                        icon={UsersRound}
                                        label="Teams"
                                        hint="How many sides are in play. Changing it re-deals everyone — the host can move people afterwards"
                                    >
                                        <NumberField
                                            value={settings.maxTeams}
                                            disabled={!isHost}
                                            min={2}
                                            max={8}
                                            onChange={patch('maxTeams')}
                                        />
                                    </SettingRow>
                                    <SettingRow
                                        icon={Users}
                                        label="Max per team"
                                        hint="The most players one side may hold. 0 means no limit, and sides never have to be the same size"
                                    >
                                        <NumberField
                                            value={settings.maxTeamSize}
                                            disabled={!isHost}
                                            min={0}
                                            max={99}
                                            onChange={patch('maxTeamSize')}
                                        />
                                    </SettingRow>
                                </>
                            )}
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
                            disabled={!isHost || !!blockedReason}
                            onClick={() => send('game:start')}
                        >
                            Start game
                        </Button>
                        <span className="label mt-1 text-center">
                            {isHost ? blockedReason || 'you are the host' : 'only the host can change the rules'}
                        </span>
                    </div>
                </div>
            </motion.div>
            {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
        </div>
    );
}
