// Authoritative game engine. Every mutation lives here; index.js only wires
// sockets to these functions and broadcasts the resulting state.

const crypto = require('crypto');
const { BOARD_LIST, DEFAULT_BOARD, getBoard, geometryOf, makeTiles, boardMeta } = require('./board');
const { makeDecks, drawCard } = require('./cards');
const market = require('./market');

const PLAYER_COLORS = [
    '#7c5cff', '#ff5c7c', '#3ddc97', '#ffb648', '#4cc9f0',
    '#f06fd0', '#a3e635', '#fb7185', '#38bdf8', '#c084fc',
    '#f59e0b', '#2dd4bf',
];

/**
 * Team ids, and the pair of shades each one wears. Teammates share a hue so the
 * board reads as "theirs" at a glance, and differ in lightness so two tokens on
 * the same tile are still two tokens — a single flat colour would make the
 * board honest about the team and useless about the player.
 */
const TEAM_IDS = ['A', 'B', 'C', 'D'];
const TEAM_COLORS = {
    A: ['#7c5cff', '#b9a8ff'],
    B: ['#ff5c7c', '#ffa8b9'],
    C: ['#3ddc97', '#9df0ca'],
    D: ['#ffb648', '#ffd9a3'],
};
const TEAM_SIZE = 2;
/** Charged on a transfer made outside your own turn. */
const OFF_TURN_FEE = 0.1;

const STARTING_CASH = 1500;
const PASS_START_BONUS = 200;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;

// Short on purpose: an auction is a reflex, not a negotiation, and every bid
// puts the full clock back so a contested tile still gets its back-and-forth.
const AUCTION_MS = 6000;
/** Raise amounts offered in the auction UI. */
const BID_STEPS = [2, 10, 100];

const DEFAULT_SETTINGS = {
    startingCash: STARTING_CASH,
    passStartBonus: PASS_START_BONUS,
    maxPlayers: 8,
    doubleRent: true,
    vacationCash: false,
    auction: true,
    noRentInPrison: false,
    evenBuild: true,
    dynamicValues: false,
    auctionBalance: false,
    teams: false,
    turnTimer: true,
    board: DEFAULT_BOARD,
};

/**
 * How long a turn may sit with nobody touching anything before it plays itself.
 *
 * Measured from the last sign of life rather than from the start of the turn:
 * someone reading a trade offer or counting their money is present, and cutting
 * them off for thinking would be worse than the stall it prevents. Moving the
 * mouse is enough to reset it, so the only turns this ever ends are the ones
 * nobody is sitting in front of.
 */
// Overridable only so a test doesn't have to sit here for a minute per turn.
const IDLE_MS = Number(process.env.NOPOLY_IDLE_MS) || 60_000;

/** Bounds every settings value is clamped to before it's stored. */
const SETTING_LIMITS = {
    startingCash: { min: 500, max: 10000 },
    passStartBonus: { min: 0, max: 1000 },
    maxPlayers: { min: 2, max: 999 },
};

const uid = () => crypto.randomUUID();

/** Shown whenever a player tries to carry on with a debt outstanding. */
const DEBT_BLOCKED = 'Settle your debt first — sell buildings or property';

/* Vote-kick. Long enough that someone mid-turn can still weigh in, short
 * enough that a vote nobody answers doesn't sit on screen all game. */
const VOTE_MS = 45_000;
/** A failed vote can't be re-run on the same player straight away. */
const VOTE_COOLDOWN_MS = 3 * 60_000;
/** Below this a vote is just one player removing another, so it's refused. */
const MIN_VOTERS = 3;
/**
 * Ceiling on how many yes votes a kick can ever need. Without it a big table
 * makes kicking impossible, since one person who isn't looking at their phone
 * would veto every vote.
 */
const VOTE_CAP = 4;
/**
 * How long someone who has dropped out gets to come back before a kick called
 * on them goes through on its own. Generous on purpose — a phone changing
 * networks, a laptop closing its lid or a router restarting all cost a couple
 * of minutes, and none of them should cost you the game.
 */
const ABANDON_MS = 5 * 60_000;

/* ------------------------------------------------------------------ rooms */

function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
}

function createRoom(code, boardId = DEFAULT_BOARD) {
    const board = getBoard(boardId);
    return {
        roomCode: code,
        hostId: null,
        // Both read by the sweep in index.js, and both here rather than sprung
        // into existence there, so a snapshot round-trips the same shape it
        // was saved in. `lastActionAt` is the last request from a client;
        // `emptySince` is when the last socket dropped, or null while anyone
        // is attached.
        lastActionAt: Date.now(),
        emptySince: null,
        players: [],
        // Watching, not playing: people who arrived after the game started, and
        // people who are out of it but still want to see how it ends.
        spectators: [],
        board,
        tiles: makeTiles(board),
        turnIndex: 0,
        paused: false,
        pausedBy: null,
        diceRoll: [0, 0],
        phase: 'waiting',
        // transient turn state
        doublesCount: 0,
        hasRolled: false,
        pendingAction: null, // { type: 'buy', playerId, tileId }
        pendingCard: null,   // { deck, text, playerId }
        lastMove: null,      // { playerId, from, to, passedStart, seq }
        moveSeq: 0,
        trades: [],
        log: [],
        chat: [],
        decks: makeDecks(board),
        winnerId: null,
        winnerTeam: null,
        auction: null,        // { tileId, bid, bidderId, endsAt }
        vote: null,           // { targetId, byId, yes: [], no: [], endsAt }
        idle: null,           // { playerId, endsAt } — the turn clock
        lastPayment: null,    // { seq, fromId, toId, amount, reason }
        paySeq: 0,
        banned: [],           // player ids a vote removed; they can't come back
        voteCooldown: {},     // targetId -> when they may be voted on again
        vacationPot: 0,       // taxes and fines waiting on Vacation
        settings: { ...DEFAULT_SETTINGS },
        stats: {
            startedAt: null,
            endedAt: null,
            turnCount: 0,
            doubles: 0,
            trades: 0,
            chatMessages: 0,
            visits: {},          // tileId -> count
            jailVisits: {},      // playerId -> count
            netWorth: [],        // [{ turn, values: { playerId: net } }]
        },
    };
}

/* ---------------------------------------------------------------- helpers */

/** Where the corners fall and how long a lap is, for this room's board. */
const geom = (room) => geometryOf(room.board);
const groupsOf = (room) => room.board.groups;

const findPlayer = (room, id) => room.players.find((p) => p.id === id) || null;
const activePlayers = (room) => room.players.filter((p) => !p.bankrupt);
const currentPlayer = (room) => room.players[room.turnIndex] || null;

function isCurrent(room, playerId) {
    const cur = currentPlayer(room);
    return !!cur && cur.id === playerId;
}

function log(room, text) {
    room.log.push({ id: uid(), text, at: Date.now() });
    if (room.log.length > 200) room.log.shift();
}

/* ------------------------------------------------------------------ teams */

// Deeds stay in the name of whoever bought them even in a team game — the buyer
// pays for it out of their own cash, they alone may sell it, and the log can
// still say who did what. What teams change is who a deed *counts for*, and
// that is entirely this one predicate.

/** The team a player belongs to, or null in a free-for-all. */
function teamOf(room, playerId) {
    if (!room.settings.teams || !playerId) return null;
    return findPlayer(room, playerId)?.teamId || null;
}

/**
 * Identity for anything that owns as a unit: the team if there is one, the
 * player otherwise. Sets, wins and turn order are all counted per side.
 */
function sideKey(room, playerId) {
    if (!playerId) return null;
    return teamOf(room, playerId) ? `team:${teamOf(room, playerId)}` : `p:${playerId}`;
}

/** Do these two ids own as one? True for a player and themselves. */
function sameSide(room, a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const ta = teamOf(room, a);
    return !!ta && ta === teamOf(room, b);
}

/** The other member of a player's team, if they have one and it's still alive. */
function teammate(room, player) {
    if (!player?.teamId || !room.settings.teams) return null;
    return room.players.find((p) => p.id !== player.id && p.teamId === player.teamId) || null;
}

function livingTeammate(room, player) {
    const mate = teammate(room, player);
    return mate && !mate.bankrupt ? mate : null;
}

/** Every side with at least one player still in the game. */
function livingSides(room) {
    return new Set(activePlayers(room).map((p) => sideKey(room, p.id)));
}

/**
 * Per-team roster and combined worth, so the rail can group players without
 * re-deriving the teams on every render.
 */
function teamSummary(room) {
    const out = {};
    for (const p of room.players) {
        if (!p.teamId) continue;
        const team = (out[p.teamId] ||= {
            id: p.teamId,
            color: TEAM_COLORS[p.teamId][0],
            playerIds: [],
            cash: 0,
            netWorth: 0,
            out: true,
        });
        team.playerIds.push(p.id);
        if (p.bankrupt) continue;
        team.out = false;
        team.cash += p.cash;
        team.netWorth += netWorth(room, p);
    }
    return out;
}

function groupTiles(room, groupId) {
    return room.tiles.filter((t) => t.groupId === groupId);
}

/** A set counts as complete when one *side* holds all of it, not one player. */
function ownsFullGroup(room, playerId, groupId) {
    if (!groupId) return false;
    const tiles = groupTiles(room, groupId);
    return tiles.length > 0 && tiles.every((t) => sameSide(room, t.ownerId, playerId));
}

function netWorth(room, player) {
    const estate = player.properties.reduce((sum, id) => {
        const tile = room.tiles[id];
        return sum + market.priceOf(room, tile) + tile.houses * (tile.houseCost || 0);
    }, player.cash);
    // An unsettled debt is a real liability — leaving it out would rank someone
    // above a rival they can't actually afford to stay in the game against.
    return estate - (player.debt?.amount ?? 0);
}

/**
 * Which side holds each completed colour set, used by the client for the
 * set-glow. Keyed by side rather than by player so a set split across two
 * teammates still lights up.
 */
function completedGroups(room) {
    const out = {};
    for (const groupId of Object.keys(groupsOf(room))) {
        const tiles = groupTiles(room, groupId);
        const owner = tiles[0]?.ownerId;
        if (owner && tiles.every((t) => sameSide(room, t.ownerId, owner))) {
            out[groupId] = sideKey(room, owner);
        }
    }
    return out;
}

/** State shape sent to clients — strips server-only bits like the decks. */
function publicState(room) {
    const sets = completedGroups(room);
    return {
        roomCode: room.roomCode,
        hostId: room.hostId,
        players: room.players.map((p) => ({ ...p, netWorth: netWorth(room, p) })),
        // Names only — there's nothing else about a watcher worth sending, and
        // the table should be able to see who's looking over their shoulder.
        spectators: room.spectators.map(({ id, name, seated }) => ({ id, name, seated })),
        // `price` stays the book value; the market numbers ride alongside it so
        // the client can show both what a tile costs and which way it's moving.
        // `side` is what the client compares against `completedGroups` — with
        // teams, the owner of a tile in a completed set may not be the only
        // owner of that set.
        tiles: room.tiles.map((t) => ({
            ...t,
            side: sideKey(room, t.ownerId),
            ...market.marketView(room, t, !!t.groupId && sets[t.groupId] === sideKey(room, t.ownerId)),
        })),
        turnIndex: room.turnIndex,
        paused: room.paused,
        pausedBy: room.pausedBy,
        diceRoll: room.diceRoll,
        phase: room.phase,
        hasRolled: room.hasRolled,
        doublesCount: room.doublesCount,
        pendingAction: room.pendingAction,
        pendingCard: room.pendingCard,
        lastMove: room.lastMove,
        auction: room.auction,
        vote: room.vote,
        voteMs: VOTE_MS,
        idle: room.idle,
        idleMs: IDLE_MS,
        lastPayment: room.lastPayment,
        vacationPot: room.vacationPot,
        bidSteps: BID_STEPS,
        trades: room.trades,
        log: room.log,
        chat: room.chat,
        winnerId: room.winnerId,
        winnerTeam: room.winnerTeam,
        teams: room.settings.teams ? teamSummary(room) : null,
        teamIds: TEAM_IDS,
        teamColors: TEAM_COLORS,
        // The palette to choose from, so the picker and the validation that
        // guards it can't drift apart.
        playerColors: PLAYER_COLORS,
        teamSize: TEAM_SIZE,
        offTurnFee: OFF_TURN_FEE,
        settings: room.settings,
        // Board meta rides along with the state rather than being handed out
        // once on join, since the host can swap boards in the lobby.
        board: boardMeta(room.board),
        boards: BOARD_LIST,
        completedGroups: sets,
        // The net-worth history is the only part of the state with no bound on
        // it — one entry per turn, each holding a value per player, and it ships
        // with every broadcast. Since `act()` broadcasts after every action by
        // anyone, a long game was re-sending tens of kilobytes of chart data
        // hundreds of times over. Nothing reads it until the end screen draws
        // the graph, so it only travels once there's a game over to explain.
        stats: room.phase === 'ended' ? room.stats : { ...room.stats, netWorth: [] },
    };
}

/* --------------------------------------------------------------- lobby ops */

function addPlayer(room, { name, playerId, initials, color }) {
    // Checked before the rejoin path, or a kicked player walks straight back in
    // on their stored id.
    if (playerId && room.banned?.includes(playerId)) {
        return { error: 'You were removed from this game' };
    }
    const existing = playerId ? findPlayer(room, playerId) : null;
    if (existing) {
        // Declaring bankruptcy is final — no coming back into this game.
        if (existing.resigned) return { error: 'You resigned from this game' };
        if (!existing.connected) log(room, `${existing.name} reconnected`);
        existing.connected = true;
        existing.disconnectedAt = null;
        if (name && name !== existing.name) existing.name = name;
        // Whatever they last set carries across a refresh with them. Errors are
        // ignored on purpose — a colour their browser remembers is not worth
        // refusing a reconnection over.
        if (initials !== undefined || color !== undefined) setProfile(room, existing.id, { initials, color });
        // Beating a countdown called on you is the whole way out of it.
        cancelAbandon(room, existing.id);
        // You're at the table now, not behind it.
        removeSpectator(room, existing.id);
        return { player: existing, rejoined: true };
    }
    if (room.phase !== 'waiting') return { error: 'Game already in progress' };
    if (room.players.length >= room.settings.maxPlayers) return { error: 'Room is full' };

    // A free colour to start with, so nobody has to visit the picker to be
    // told apart. It's only a default: picks are allowed to collide, and
    // recolourPlayers sorts out the shades afterwards.
    const used = new Set(room.players.map((p) => p.baseColor));
    const fallback =
        PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
    const player = {
        id: playerId || uid(),
        name: (name || 'player').slice(0, 16),
        // What they chose, and what the board draws — the same until someone
        // else wants the same colour.
        baseColor: cleanColor(color) || fallback,
        color: cleanColor(color) || fallback,
        // Null means "work it out from my name", which is what most people
        // will leave it as.
        initials: cleanInitials(initials),
        // Assigned by the host in the lobby; null in a free-for-all.
        teamId: null,
        cash: room.settings.startingCash,
        position: 0,
        properties: [],
        inJail: false,
        jailTurns: 0,
        jailCards: 0,
        connected: true,
        disconnectedAt: null,
        bankrupt: false,
        resigned: false,
        // { amount, toId } while they owe more than they held in cash. Blocks
        // their turn until they've sold enough to clear it.
        debt: null,
        activity: null,
    };
    room.players.push(player);
    // A watcher taking a seat when the lobby reopens after a rematch.
    removeSpectator(room, player.id);
    if (!room.hostId) room.hostId = player.id;
    // Their pick may be one somebody already has, so everyone's shade is
    // settled here rather than at the moment of choosing.
    recolourPlayers(room);
    log(room, `${player.name} joined`);
    return { player, rejoined: false };
}

/* -------------------------------------------------------------- spectating */

/**
 * Whether a seat is out of reach but the room isn't — turning "no" into "not
 * as a player", which is the whole point of this.
 *
 * Being voted out is the one exception. A kick is the table saying they don't
 * want you here; handing you a window back into the same game would undo it.
 */
function spectateReason(room, playerId) {
    if (playerId && room.banned?.includes(playerId)) return null;
    const existing = playerId ? findPlayer(room, playerId) : null;
    // Someone who resigned or went bankrupt is still sitting at the table
    // watching — they only need this if they closed the tab and came back.
    if (existing?.resigned) return 'You resigned from this game';
    if (existing) return null;
    if (room.phase !== 'waiting') return 'The game has already started';
    if (room.players.length >= room.settings.maxPlayers) return 'The room is full';
    return null;
}

/**
 * Join without a seat. Spectators are kept apart from `players` on purpose:
 * everything that matters — turn order, net worth, who has won, what a vote
 * needs — is counted off that list, and a watcher belongs in none of it.
 */
function addSpectator(room, { name, playerId } = {}) {
    const id = playerId || uid();
    // Never both at once. Someone who is out of the game is already in
    // `players`, and listing them twice would double them up everywhere.
    const seated = findPlayer(room, id);
    const label = String(name || seated?.name || 'someone').slice(0, 16);
    const existing = room.spectators.find((s) => s.id === id);
    if (existing) {
        existing.name = label;
        return { spectator: existing, rejoined: true };
    }
    const spectator = { id, name: label, seated: !!seated };
    room.spectators.push(spectator);
    // Not logged for someone already at the table — they never left it.
    if (!seated) log(room, `${label} is watching`);
    return { spectator, rejoined: false };
}

function removeSpectator(room, id) {
    const before = room.spectators.length;
    room.spectators = room.spectators.filter((s) => s.id !== id);
    return room.spectators.length !== before;
}

const isSpectator = (room, id) => room.spectators.some((s) => s.id === id);

/* --------------------------------------------------------------- profiles */

/** Up to three characters, or null to fall back to the name. */
function cleanInitials(value) {
    const text = String(value ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
    return text || null;
}

/** Only colours from the palette — an open field is a way to render nothing. */
function cleanColor(value) {
    const hex = String(value ?? '').toLowerCase();
    return PLAYER_COLORS.includes(hex) ? hex : null;
}

/**
 * Your own initials and colour. Both are yours alone to set — there's nothing
 * here for the host to arbitrate, and nothing another player can take from you
 * by picking it first.
 *
 * The colour is locked once the game is running: property markers, tokens and
 * the rail are all read by colour, and changing one mid-game would quietly
 * rewrite who the board says owns what. Initials stay editable, since they only
 * ever appear next to the name they stand in for.
 */
function setProfile(room, playerId, { initials, color } = {}) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };

    if (initials !== undefined) player.initials = cleanInitials(initials);

    if (color !== undefined && color !== null) {
        if (room.phase !== 'waiting') return { error: 'Colours are locked once the game starts' };
        if (room.settings.teams) return { error: 'Teams pick the colours' };
        const picked = cleanColor(color);
        if (!picked) return { error: 'Unknown colour' };
        player.baseColor = picked;
        recolourPlayers(room);
    }
    return {};
}

/**
 * Swap the board in the lobby. Boards differ in length, so the tiles and the
 * decks (whose destinations are bound to tile ids) are both rebuilt, and any
 * player standing somewhere is put back on Start.
 */
function setBoard(room, boardId) {
    const board = getBoard(boardId);
    if (board.id === room.board.id) return;
    room.board = board;
    room.settings.board = board.id;
    room.tiles = makeTiles(board);
    room.decks = makeDecks(board);
    room.vacationPot = 0;
    room.trades = [];
    room.auction = null;
    for (const p of room.players) {
        p.position = 0;
        p.properties = [];
        p.inJail = false;
        p.jailTurns = 0;
    }
    log(room, `Board changed to ${board.name}`);
}

/** Host-only, lobby-only. Unknown keys are ignored and numbers are clamped. */
function updateSettings(room, playerId, patch = {}) {
    if (room.hostId !== playerId) return { error: 'Only the host can change the rules' };
    if (room.phase !== 'waiting') return { error: 'Rules are locked once the game starts' };

    for (const [key, raw] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS)) continue;
        if (key === 'board') {
            setBoard(room, raw);
            continue;
        }
        if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
            room.settings[key] = !!raw;
            // Toggling teams reshuffles everyone's colour, so it can't just be
            // a flag — pair people up now and let the host swap from there.
            if (key === 'teams') autoAssignTeams(room);
            continue;
        }
        const limit = SETTING_LIMITS[key];
        const value = Math.round(Number(raw));
        if (!Number.isFinite(value)) continue;
        room.settings[key] = Math.min(Math.max(value, limit.min), limit.max);
    }
    if (room.settings.maxPlayers < room.players.length) {
        room.settings.maxPlayers = room.players.length;
    }
    // Nobody has moved yet, so a starting-cash change applies retroactively.
    for (const p of room.players) p.cash = room.settings.startingCash;
    return {};
}

/**
 * Deal the seating out so the teams alternate: A1, B1, A2, B2 rather than both
 * of A then both of B. Two turns back to back is a real edge when auctions and
 * jail timing are involved, and it's free to avoid.
 */
function interleaveTeams(room) {
    const order = [];
    const byTeam = new Map();
    for (const p of room.players) {
        if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
        byTeam.get(p.teamId).push(p);
    }
    const queues = [...byTeam.values()];
    for (let slot = 0; queues.some((q) => q.length > slot); slot++) {
        for (const q of queues) if (q[slot]) order.push(q[slot]);
    }
    room.players = order;
}

function teamsReady(room) {
    const counts = {};
    for (const p of room.players) {
        if (!p.teamId) return { error: `${p.name} is not on a team` };
        counts[p.teamId] = (counts[p.teamId] || 0) + 1;
    }
    const short = Object.entries(counts).find(([, n]) => n !== TEAM_SIZE);
    if (short) return { error: `Team ${short[0]} needs exactly ${TEAM_SIZE} players` };
    if (Object.keys(counts).length < 2) return { error: 'Need at least 2 teams' };
    return {};
}

/* ------------------------------------------------------------- shades */

/** #rrggbb -> {h, s, l}, with h in degrees and s/l in percent. */
function hexToHsl(hex) {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16) || 0;
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    const hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: hue * 60, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
    const S = s / 100;
    const L = l / 100;
    const c = (1 - Math.abs(2 * L - 1)) * S;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = L - c / 2;
    const seg = Math.floor(((h % 360) + 360) % 360 / 60);
    const [r, g, b] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][seg];
    const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Kept off the extremes, where every colour turns into black or white. */
const SHADE_MIN = 26;
const SHADE_MAX = 84;
/** How far apart two people who picked the same colour end up. */
const SHADE_SPAN = 50;

/**
 * Lightnesses for `n` players who all picked the same colour, spread evenly
 * around what they picked. Nobody keeps the exact shade once there's a clash —
 * an even spread is the only arrangement that can't put two of them on the same
 * value when the colour they chose is already near the top or bottom of the
 * range, and two players wearing the same colour is the one outcome this
 * exists to prevent.
 */
function shadeLevels(base, n) {
    if (n <= 1) return [base];
    const span = Math.min(SHADE_SPAN, SHADE_MAX - SHADE_MIN);
    const start = Math.max(SHADE_MIN, Math.min(base - span / 2, SHADE_MAX - span));
    return Array.from({ length: n }, (_, i) => start + (span * i) / (n - 1));
}

/**
 * Derive everyone's rendered colour from the one they picked. Picks are free to
 * collide — the board just has to be able to tell them apart afterwards.
 */
function recolourPlayers(room) {
    const claimants = new Map();
    for (const p of room.players) {
        // A room restored from before picks existed only has a rendered colour;
        // treat that as what they chose.
        if (!p.baseColor) p.baseColor = p.color;
        if (!claimants.has(p.baseColor)) claimants.set(p.baseColor, []);
        claimants.get(p.baseColor).push(p);
    }
    for (const [base, players] of claimants) {
        const { h, s, l } = hexToHsl(base);
        const levels = shadeLevels(l, players.length);
        players.forEach((p, i) => {
            p.color = players.length === 1 ? base : hslToHex(h, s, levels[i]);
        });
    }
}

/**
 * Teammates wear the same hue in two shades, so `player.color` stays the single
 * source of truth for every existing token, tile marker and rail row.
 */
function recolourTeams(room) {
    if (!room.settings.teams) {
        // Back to what everyone chose for themselves — the team colours were
        // only ever on loan.
        recolourPlayers(room);
        return;
    }
    const slots = {};
    for (const p of room.players) {
        if (!p.teamId) continue;
        const slot = (slots[p.teamId] = (slots[p.teamId] ?? -1) + 1);
        p.color = TEAM_COLORS[p.teamId][Math.min(slot, TEAM_COLORS[p.teamId].length - 1)];
    }
}

/** Host-only, lobby-only. Pass a null team to take someone off a team. */
function setTeam(room, hostId, playerId, teamId) {
    if (room.hostId !== hostId) return { error: 'Only the host can pick teams' };
    if (room.phase !== 'waiting') return { error: 'Teams are locked once the game starts' };
    if (!room.settings.teams) return { error: 'Teams are off' };
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (teamId !== null && !TEAM_IDS.includes(teamId)) return { error: 'Unknown team' };
    if (teamId && room.players.filter((p) => p.teamId === teamId && p.id !== playerId).length >= TEAM_SIZE) {
        return { error: `Team ${teamId} is full` };
    }
    player.teamId = teamId;
    recolourTeams(room);
    return {};
}

/** Fill the teams top to bottom in seating order — the host can then swap. */
function autoAssignTeams(room) {
    room.players.forEach((p, i) => {
        p.teamId = room.settings.teams ? TEAM_IDS[Math.floor(i / TEAM_SIZE)] || null : null;
    });
    recolourTeams(room);
}

function startGame(room, playerId) {
    if (room.hostId !== playerId) return { error: 'Only the host can start' };
    if (room.phase !== 'waiting') return { error: 'Already started' };
    if (room.players.length < 2) return { error: 'Need at least 2 players' };
    if (room.settings.teams) {
        const ready = teamsReady(room);
        if (ready.error) return ready;
        interleaveTeams(room);
    }
    room.phase = 'rolling';
    room.turnIndex = 0;
    room.hasRolled = false;
    room.stats.startedAt = Date.now();
    snapshotNetWorth(room);
    log(room, 'Game started — good luck');
    armIdle(room);
    return {};
}

/* ------------------------------------------------------------- turn engine */

function snapshotNetWorth(room) {
    const values = {};
    for (const p of room.players) values[p.id] = p.bankrupt ? 0 : netWorth(room, p);
    room.stats.netWorth.push({ turn: room.stats.turnCount, values });
}

function payBank(room, player, amount, reason) {
    charge(room, player, null, amount, reason);
}

function transfer(room, from, to, amount, reason) {
    charge(room, from, to, amount, reason);
}

/** Hand cash to whoever is owed — the bank's share can pile up on Vacation. */
function credit(room, creditor, amount) {
    if (amount <= 0) return;
    if (creditor && !creditor.bankrupt) creditor.cash += amount;
    else if (room.settings.vacationCash) room.vacationPot += amount;
}

/**
 * What the estate would actually raise if it were all sold right now.
 * Buildings come back at half, which is why this isn't `netWorth` — that one
 * values them at cost and would tell a player they can cover a debt they
 * can't.
 */
function liquidValue(room, player) {
    return player.properties.reduce((sum, id) => {
        const tile = room.tiles[id];
        return sum + market.priceOf(room, tile) + tile.houses * Math.floor((tile.houseCost || 0) / 2);
    }, player.cash);
}

/**
 * Bill a player. Anything they can't cover in cash becomes a debt they have to
 * clear themselves, by selling buildings or property — the game does not
 * liquidate the estate on their behalf. Their turn is blocked until it's
 * settled, and bankruptcy only follows when the whole estate provably falls
 * short.
 */
function charge(room, player, creditor, amount, reason) {
    // Bankruptcy is settled the moment it happens and the estate is already
    // gone — a card that moves the player on and re-resolves the landing must
    // not bill them again.
    if (amount <= 0 || player.bankrupt) return;

    const paid = Math.min(amount, Math.max(player.cash, 0));
    player.cash -= paid;
    credit(room, creditor, paid);
    const who = creditor ? ` to ${creditor.name}` : '';
    log(room, `${player.name} paid $${paid}${who}${reason ? ` — ${reason}` : ''}`);

    // Broadcast as an event rather than left to be inferred from two balances
    // changing, so the client can sound it for the two people involved. The
    // sequence number is what lets a repeat of the same amount between the same
    // two people fire again instead of looking like the state hadn't changed.
    // `|| 0` for rooms restored from a snapshot written before this existed.
    room.paySeq = (room.paySeq || 0) + 1;
    room.lastPayment = {
        seq: room.paySeq,
        fromId: player.id,
        toId: creditor && !creditor.bankrupt ? creditor.id : null,
        amount: paid,
        reason: reason || null,
    };

    const owed = amount - paid;
    if (owed <= 0) return;

    player.debt = { amount: owed, toId: creditor && !creditor.bankrupt ? creditor.id : null, bailout: null };
    if (liquidValue(room, player) >= owed) {
        log(room, `${player.name} owes $${owed} — sell buildings or property to cover it`);
        return;
    }

    // Short on their own. In a free-for-all that's the end of it; on a team it
    // becomes the teammate's decision, and only a team that provably can't
    // raise the money between them goes down.
    const mate = livingTeammate(room, player);
    if (!mate) {
        log(room, `${player.name} owes $${owed} and can't cover it`);
        goBankrupt(room, player);
        return;
    }
    if (liquidValue(room, player) + liquidValue(room, mate) < owed) {
        log(room, `${player.name} and ${mate.name} together can't cover $${owed}`);
        goBankrupt(room, player);
        goBankrupt(room, mate);
        return;
    }
    player.debt.bailout = 'offered';
    log(room, `${player.name} owes $${owed} — ${mate.name} can cover it`);
}

/** Push whatever cash is in hand at an outstanding debt. Called after a sale. */
function payDownDebt(room, player) {
    if (!player.debt || player.bankrupt || player.cash <= 0) return;
    const pay = Math.min(player.cash, player.debt.amount);
    player.cash -= pay;
    credit(room, player.debt.toId ? findPlayer(room, player.debt.toId) : null, pay);
    player.debt.amount -= pay;
    if (player.debt.amount <= 0) {
        player.debt = null;
        log(room, `${player.name} settled the debt`);
    }
}

/**
 * A teammate answering the "cover their debt?" prompt.
 *
 * Accepting moves the debt across rather than moving cash: the debtor is free
 * again immediately and the teammate is the one whose turn is now blocked until
 * they've sold enough. That's why accepting is only allowed once the teammate
 * can actually raise the amount on their own — the debtor sells their own
 * estate down first, which is what shrinks the debt to something coverable.
 */
function respondBailout(room, playerId, accept) {
    const mate = findPlayer(room, playerId);
    if (!mate || mate.bankrupt) return { error: 'You are out of the game' };
    const debtor = room.players.find(
        (p) => p.debt?.bailout === 'offered' && p.teamId && p.teamId === mate.teamId && p.id !== mate.id,
    );
    if (!debtor) return { error: 'Nothing to cover' };

    if (!accept) {
        log(room, `${mate.name} declined to cover ${debtor.name}'s debt`);
        goBankrupt(room, debtor);
        if (room.phase !== 'ended' && isCurrent(room, debtor.id)) endTurnAuto(room);
        return {};
    }

    const owed = debtor.debt.amount;
    if (mate.debt) return { error: 'Settle your own debt first' };
    if (liquidValue(room, mate) < owed) {
        return { error: `You can't raise $${owed} — ${debtor.name} has to sell down first` };
    }

    mate.debt = { amount: owed, toId: debtor.debt.toId, bailout: null };
    debtor.debt = null;
    log(room, `${mate.name} took on ${debtor.name}'s $${owed} debt`);
    // Whatever they're holding goes straight at it; the rest they sell for.
    payDownDebt(room, mate);
    return {};
}

/**
 * Out of the game. The estate goes back to the bank and the tiles are vacant
 * again — a creditor doesn't inherit it, so nothing can be handed to a friend
 * on the way out and no one wins the game by being owed money. A teammate
 * doesn't inherit it either, which is what makes declining a bailout expensive.
 */
function goBankrupt(room, player) {
    if (player.bankrupt) return;
    player.bankrupt = true;
    player.debt = null;
    player.cash = 0;
    const estate = player.properties.slice();
    player.properties = [];
    for (const tileId of estate) {
        const tile = room.tiles[tileId];
        tile.houses = 0;
        tile.ownerId = null;
    }
    log(room, `${player.name} went bankrupt — ${estate.length} properties returned to the bank`);
    dropTradesFor(room, player.id);
    // Nothing left to decide about someone already out — and a countdown left
    // pointing at them would block every other vote for five minutes.
    dropVoteFor(room, player.id);
    // One fewer voter changes what a majority is, and can settle a running
    // vote outright. Safe from recursion: finishVote clears room.vote before
    // it ever gets here.
    resolveVoteIfDecided(room);
    checkWin(room);
}


/** Last side standing — one player in a free-for-all, one team otherwise. */
function checkWin(room) {
    if (room.phase === 'waiting' || room.phase === 'ended') return false;
    const alive = activePlayers(room);
    if (livingSides(room).size > 1) return false;

    room.phase = 'ended';
    room.winnerId = alive[0]?.id || null;
    room.winnerTeam = alive[0]?.teamId || null;
    room.stats.endedAt = Date.now();
    room.pendingAction = null;
    room.pendingCard = null;
    // Nothing left to hurry along, and a clock still ticking on the winner's
    // name would be the last thing anyone sees.
    room.idle = null;
    snapshotNetWorth(room);
    // A surviving team is named by its members, since there's no one winner.
    const names = alive.map((p) => p.name).join(' and ');
    log(room, names ? `${names} win${alive.length > 1 ? '' : 's'}!` : 'Game over');
    return true;
}

function sendToJail(room, player) {
    // Where they were standing when it happened. The client walks them there
    // first and only then drops them in jail — otherwise landing on Go to Jail
    // reads as a teleport from wherever the roll started, and you never see the
    // tile that did it. When nothing moved them (three doubles, a card drawn on
    // the spot) this equals where the token already is, so it snaps as before.
    const via = player.position;
    player.position = geom(room).jailIndex;
    player.inJail = true;
    player.jailTurns = 0;
    room.moveSeq += 1;
    room.lastMove = {
        playerId: player.id,
        from: via,
        to: player.position,
        via,
        direct: true,
        seq: room.moveSeq,
    };
    room.stats.jailVisits[player.id] = (room.stats.jailVisits[player.id] || 0) + 1;
    room.doublesCount = 0;
    log(room, `${player.name} was sent to jail`);
}

function movePlayerTo(room, player, target, { collectStart = true, direct = false } = {}) {
    const from = player.position;
    const size = room.tiles.length;
    const to = ((target % size) + size) % size;
    const passedStart = collectStart && !direct && to < from;
    if (passedStart) {
        player.cash += room.settings.passStartBonus;
        log(room, `${player.name} passed Start (+$${room.settings.passStartBonus})`);
    }
    player.position = to;
    room.moveSeq += 1;
    room.lastMove = { playerId: player.id, from, to, direct, seq: room.moveSeq };
    room.stats.visits[to] = (room.stats.visits[to] || 0) + 1;
}

/**
 * A tax tile charges either a flat fee or a share of net worth. The percentage
 * kind scales with how well you're doing, so the leader pays the most.
 *
 * `max` caps that share. A flat fee is at its most painful on the first lap,
 * when it's a tenth of everything you own, and beneath notice by the time
 * anyone has a set — a percentage fixes both ends, but without a ceiling it
 * turns into a four-figure bill that a property-rich player has to sell
 * buildings to pay. The cap keeps it a tax rather than an eviction.
 */
function taxFor(room, player, tile) {
    const rule = tile.tax || { amount: 100 };
    if (!rule.percent) return rule.amount || 0;
    const share = Math.round((netWorth(room, player) * rule.percent) / 100);
    return rule.max ? Math.min(share, rule.max) : share;
}

/**
 * How many tiles of this kind the owner's *side* holds, and whether that's all
 * of them. Airports and utilities scale with the count, so a team splitting
 * three airports between them still collects the three-airport rate.
 */
function holdingOf(room, owner, type, total) {
    const owned = room.tiles.filter((t) => t.type === type && sameSide(room, t.ownerId, owner.id)).length;
    return { owned, complete: owned >= total };
}

function rentFor(room, tile, owner, dice) {
    if (tile.type === 'property') {
        const setOwned = ownsFullGroup(room, owner.id, tile.groupId);
        // The market only touches rent while a tile is still undeveloped — see
        // market.js. Houses on the ground or a full set pay the book rate.
        if (tile.houses > 0) return tile.rent[tile.houses];
        const base = room.settings.doubleRent && setOwned ? tile.rent[0] * 2 : tile.rent[0];
        return Math.round(base * market.rentMult(room, tile, setOwned));
    }
    if (tile.type === 'airport') {
        const table = room.board.airportRent;
        const { owned, complete } = holdingOf(room, owner, 'airport', table.length);
        const base = table[Math.min(Math.max(owned - 1, 0), table.length - 1)];
        return Math.round(base * market.rentMult(room, tile, complete));
    }
    if (tile.type === 'utility') {
        const table = room.board.utilityMultiplier;
        const { owned, complete } = holdingOf(room, owner, 'utility', table.length);
        const mult = table[Math.min(Math.max(owned - 1, 0), table.length - 1)];
        return Math.round(mult * (dice[0] + dice[1] || 7) * market.rentMult(room, tile, complete));
    }
    return 0;
}

function resolveLanding(room, player, dice) {
    const tile = room.tiles[player.position];

    if (tile.type === 'corner') {
        if (player.position === geom(room).goToJailIndex) {
            sendToJail(room, player);
            return endTurnAuto(room);
        }
        if (player.position === geom(room).vacationIndex && room.settings.vacationCash && room.vacationPot > 0) {
            player.cash += room.vacationPot;
            log(room, `${player.name} collected $${room.vacationPot} of vacation cash`);
            room.vacationPot = 0;
        }
        return;
    }
    if (tile.type === 'tax') {
        payBank(room, player, taxFor(room, player, tile), tile.name);
        return;
    }
    if (tile.type === 'chance' || tile.type === 'chest') {
        const deckName = tile.type === 'chance' ? 'chance' : 'chest';
        const card = drawCard(room.decks[deckName]);
        room.pendingCard = { deck: deckName, text: card.text, playerId: player.id };
        log(room, `${player.name} drew: ${card.text}`);
        applyCard(room, player, card, dice);
        return;
    }

    // property / airport / utility
    if (tile.ownerId === null) {
        if (player.cash >= market.priceOf(room, tile)) {
            room.pendingAction = { type: 'buy', playerId: player.id, tileId: tile.id };
        } else if (room.settings.auction) {
            // Can't afford it — straight to auction rather than nothing.
            startAuction(room, tile.id);
        }
        return;
    }
    // Your own tile, or your teammate's — either way the side already owns it.
    if (sameSide(room, tile.ownerId, player.id)) return;
    const owner = findPlayer(room, tile.ownerId);
    if (!owner || owner.bankrupt) return;
    if (owner.inJail && room.settings.noRentInPrison) {
        log(room, `${owner.name} is in prison — no rent on ${tile.name}`);
        return;
    }
    const rent = rentFor(room, tile, owner, dice);
    transfer(room, player, owner, rent, `rent on ${tile.name}`);
}

function applyCard(room, player, card, dice) {
    const e = card.effect;
    switch (e.kind) {
        case 'cash':
            if (e.amount >= 0) player.cash += e.amount;
            else payBank(room, player, -e.amount, 'card');
            break;
        case 'collect':
            for (const other of activePlayers(room)) {
                if (other.id !== player.id) transfer(room, other, player, e.amount, 'card');
            }
            break;
        case 'pay':
            for (const other of activePlayers(room)) {
                if (other.id !== player.id) transfer(room, player, other, e.amount, 'card');
            }
            break;
        case 'move':
            movePlayerTo(room, player, e.to, { collectStart: e.collectStart });
            resolveLanding(room, player, dice);
            break;
        case 'step': {
            movePlayerTo(room, player, player.position + e.by, { collectStart: false });
            resolveLanding(room, player, dice);
            break;
        }
        case 'nearestAirport': {
            const airports = room.tiles.filter((t) => t.type === 'airport').map((t) => t.id);
            const next = airports.find((id) => id > player.position) ?? airports[0];
            movePlayerTo(room, player, next, { collectStart: true });
            resolveLanding(room, player, dice);
            break;
        }
        case 'jail':
            sendToJail(room, player);
            endTurnAuto(room);
            break;
        case 'jailfree':
            player.jailCards += 1;
            break;
        case 'repairs': {
            let total = 0;
            for (const id of player.properties) {
                const t = room.tiles[id];
                if (t.houses === 5) total += e.perHotel;
                else total += t.houses * e.perHouse;
            }
            payBank(room, player, total, 'repairs');
            break;
        }
        default:
            break;
    }
}

/** Ends the turn immediately (jail, bankruptcy) without waiting on the player. */
function endTurnAuto(room) {
    room.pendingAction = null;
    advanceTurn(room);
}

function advanceTurn(room) {
    if (room.phase === 'ended') return;
    room.stats.turnCount += 1;
    snapshotNetWorth(room);
    room.doublesCount = 0;
    room.hasRolled = false;
    room.pendingAction = null;

    if (livingSides(room).size <= 1) {
        checkWin(room);
        armIdle(room);
        return;
    }
    let guard = 0;
    do {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        guard += 1;
    } while (room.players[room.turnIndex].bankrupt && guard <= room.players.length);
    room.phase = 'rolling';
    // The clock starts with the turn, not with the first thing they do.
    armIdle(room);
}

/* -------------------------------------------------------------- turn clock */

/**
 * Start the clock on whoever is up. Called wherever a turn begins, and cleared
 * outright when the rule is off or there's nothing to wait for.
 */
function armIdle(room) {
    const player = room.players[room.turnIndex];
    if (!room.settings.turnTimer || room.phase === 'waiting' || room.phase === 'ended' || !player) {
        room.idle = null;
        return;
    }
    room.idle = { playerId: player.id, endsAt: Date.now() + IDLE_MS };
}

/** A sign of life from the player whose turn it is. */
function noteActive(room, playerId) {
    if (!room.idle || room.idle.playerId !== playerId) return {};
    room.idle.endsAt = Date.now() + IDLE_MS;
    return {};
}

/**
 * Nobody has touched anything for a minute, so play the turn for them — roll,
 * take the cheapest way out of whatever it lands on, and hand it on. All in one
 * go rather than a minute per step, because three minutes to pass one empty
 * turn is the stall this exists to prevent.
 *
 * A debt is the exception: only the player can decide what to sell, so the turn
 * stays theirs. That's what the abandonment countdown is for.
 */
function expireIdle(room) {
    const idle = room.idle;
    if (!idle) return { error: 'No turn clock running' };
    const player = findPlayer(room, idle.playerId);
    room.idle = null;
    if (!player || !isCurrent(room, player.id) || player.debt) {
        armIdle(room);
        return {};
    }

    log(room, `${player.name} was away — their turn was played for them`);
    if (room.phase === 'rolling' && !room.hasRolled) rollDice(room, player.id);
    // Whatever the roll turned up, take the passive option: don't buy, and get
    // the card off the screen. An auction may open, which everyone else can
    // still bid in.
    if (room.pendingAction?.type === 'buy' && room.pendingAction.playerId === player.id) {
        declinePurchase(room, player.id);
    }
    room.pendingCard = null;
    // A roll can end the turn on its own — jail, or going bankrupt.
    if (isCurrent(room, player.id) && room.phase !== 'ended' && !player.debt) {
        endTurn(room, player.id);
    }
    armIdle(room);
    return {};
}

function rollDice(room, playerId) {
    if (room.paused) return { error: 'Game is paused' };
    if (room.phase !== 'rolling') return { error: 'Not the rolling phase' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (room.hasRolled && room.doublesCount === 0) return { error: 'Already rolled' };
    if (currentPlayer(room)?.debt) return { error: DEBT_BLOCKED };

    const player = currentPlayer(room);
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    const isDouble = dice[0] === dice[1];
    room.diceRoll = dice;
    room.hasRolled = true;
    room.pendingCard = null;
    log(room, `${player.name} rolled ${dice[0]} + ${dice[1]}`);

    if (player.inJail) {
        if (isDouble) {
            player.inJail = false;
            player.jailTurns = 0;
            log(room, `${player.name} rolled doubles and left jail`);
        } else {
            player.jailTurns += 1;
            if (player.jailTurns >= MAX_JAIL_TURNS) {
                payBank(room, player, JAIL_FINE, 'jail fine');
                player.inJail = false;
                player.jailTurns = 0;
                log(room, `${player.name} paid the fine and left jail`);
            } else {
                room.phase = 'resolving';
                return {};
            }
        }
    } else if (isDouble) {
        room.doublesCount += 1;
        room.stats.doubles += 1;
        if (room.doublesCount >= 3) {
            sendToJail(room, player);
            room.phase = 'resolving';
            endTurnAuto(room);
            return {};
        }
    } else {
        room.doublesCount = 0;
    }

    room.phase = 'moving';
    movePlayerTo(room, player, player.position + dice[0] + dice[1]);
    resolveLanding(room, player, dice);
    if (room.phase !== 'ended' && room.phase !== 'rolling') room.phase = 'resolving';
    return {};
}

function buyProperty(room, playerId) {
    const action = room.pendingAction;
    if (!action || action.type !== 'buy' || action.playerId !== playerId) return { error: 'Nothing to buy' };
    const player = findPlayer(room, playerId);
    const tile = room.tiles[action.tileId];
    if (!player || tile.ownerId !== null) return { error: 'Unavailable' };
    if (player.debt) return { error: DEBT_BLOCKED };
    const price = market.priceOf(room, tile);
    if (player.cash < price) return { error: 'Not enough cash' };

    player.cash -= price;
    tile.ownerId = player.id;
    player.properties.push(tile.id);
    room.pendingAction = null;
    log(room, `${player.name} bought ${tile.name} for $${price}`);
    if (ownsFullGroup(room, player.id, tile.groupId)) {
        log(room, `${player.name} completed the ${groupsOf(room)[tile.groupId]?.name || tile.groupId} set`);
    }
    return {};
}

function declinePurchase(room, playerId) {
    const action = room.pendingAction;
    if (!action || action.playerId !== playerId) return { error: 'Nothing to decline' };
    const tileId = action.tileId;
    room.pendingAction = null;
    if (room.settings.auction) startAuction(room, tileId);
    return {};
}

/* ---------------------------------------------------------------- auctions */

/** Anyone still in the game with cash to spare can bid. */
function startAuction(room, tileId) {
    const tile = room.tiles[tileId];
    if (!tile || tile.ownerId !== null || room.auction) return;
    // A reserve price is what stops a table quietly agreeing to let everything
    // go for pocket change.
    const opening = market.openingBid(room, tile);
    room.auction = {
        tileId,
        bid: 0,
        bidderId: null,
        opening,
        nextBid: opening,
        endsAt: Date.now() + AUCTION_MS,
    };
    log(room, `${tile.name} goes to auction (from $${opening})`);
}

function placeBid(room, playerId, amount) {
    const auction = room.auction;
    if (!auction) return { error: 'No auction running' };
    if (room.paused) return { error: 'Game is paused' };
    const player = findPlayer(room, playerId);
    if (!player || player.bankrupt) return { error: 'You are out of the game' };
    if (player.debt) return { error: DEBT_BLOCKED };

    // Bidding your own teammate up is only ever burning team money.
    if (auction.bidderId && auction.bidderId !== playerId && sameSide(room, auction.bidderId, playerId)) {
        return { error: 'Your teammate holds the high bid' };
    }

    const bid = Math.round(Number(amount));
    if (!Number.isFinite(bid) || bid < auction.nextBid) return { error: 'Bid is too low' };
    if (bid > player.cash) return { error: 'Not enough cash' };

    auction.bid = bid;
    auction.bidderId = playerId;
    auction.nextBid = bid + 1;
    // Each bid puts time back on the clock so it can't be sniped.
    auction.endsAt = Date.now() + AUCTION_MS;
    log(room, `${player.name} bid $${bid} on ${room.tiles[auction.tileId].name}`);
    return {};
}

/** Called by the room's auction timer once the clock runs out. */
function resolveAuction(room) {
    const auction = room.auction;
    if (!auction) return { error: 'No auction running' };
    room.auction = null;

    const tile = room.tiles[auction.tileId];
    const winner = auction.bidderId ? findPlayer(room, auction.bidderId) : null;
    if (!winner || winner.bankrupt || winner.cash < auction.bid || tile.ownerId !== null) {
        log(room, `${tile.name} drew no bids and stays with the bank`);
        return {};
    }
    winner.cash -= auction.bid;
    tile.ownerId = winner.id;
    winner.properties.push(tile.id);
    log(room, `${winner.name} won ${tile.name} at auction for $${auction.bid}`);
    // What the room was willing to pay is the best price signal there is.
    market.appraise(room, tile, auction.bid);
    if (ownsFullGroup(room, winner.id, tile.groupId)) {
        log(room, `${winner.name} completed the ${groupsOf(room)[tile.groupId]?.name || tile.groupId} set`);
    }
    return {};
}

function endTurn(room, playerId) {
    if (room.phase === 'waiting' || room.phase === 'ended') return { error: 'Game is not running' };
    if (room.paused) return { error: 'Game is paused' };
    if (room.auction) return { error: 'Wait for the auction to finish' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (room.phase === 'rolling' && !room.hasRolled) return { error: 'Roll first' };
    // The table would otherwise move on and leave the debt hanging forever.
    if (findPlayer(room, playerId)?.debt) return { error: DEBT_BLOCKED };
    if (room.pendingAction) room.pendingAction = null;
    room.pendingCard = null;

    // A double earns another roll (unless it landed them in jail).
    const player = currentPlayer(room);
    if (room.doublesCount > 0 && room.doublesCount < 3 && !player.inJail && !player.bankrupt) {
        room.phase = 'rolling';
        room.hasRolled = false;
        log(room, `${player.name} rolled doubles — rolling again`);
        return {};
    }
    advanceTurn(room);
    return {};
}

function payJailFine(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player || !player.inJail) return { error: 'Not in jail' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (player.cash < JAIL_FINE) return { error: 'Not enough cash' };
    payBank(room, player, JAIL_FINE, 'jail fine');
    player.inJail = false;
    player.jailTurns = 0;
    log(room, `${player.name} paid $${JAIL_FINE} to leave jail`);
    return {};
}

function useJailCard(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player || !player.inJail) return { error: 'Not in jail' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (player.jailCards < 1) return { error: 'No card' };
    player.jailCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    log(room, `${player.name} used a get-out-of-jail card`);
    return {};
}

/* ---------------------------------------------------------------- building */

/**
 * Anyone on the side may develop a set the side owns, paying from their own
 * cash — the rent still goes to whoever's name is on the deed. Selling is the
 * asymmetric half: see sellHouse.
 */
function canBuild(room, player, tile) {
    if (tile.type !== 'property' || !sameSide(room, tile.ownerId, player.id)) return false;
    if (!ownsFullGroup(room, player.id, tile.groupId)) return false;
    if (tile.houses >= 5) return false;
    if (player.cash < tile.houseCost) return false;
    if (!room.settings.evenBuild) return true;
    // Even building: never more than one ahead of the rest of the set.
    const min = Math.min(...groupTiles(room, tile.groupId).map((t) => t.houses));
    return tile.houses === min;
}

function buildHouse(room, playerId, tileId) {
    const player = findPlayer(room, playerId);
    const tile = room.tiles[tileId];
    if (!player || !tile) return { error: 'Unknown tile' };
    if (room.paused) return { error: 'Game is paused' };
    // Your own turn only. Nothing enforced this before, so a set could be built
    // up in the middle of someone else's roll — including in the seconds
    // between them landing on it and the rent being worked out.
    //
    // Selling is deliberately not gated the same way: rent lands on you during
    // other people's turns, and clearing a debt has to be possible when it does.
    if (!isCurrent(room, playerId)) return { error: 'You can only build on your own turn' };
    if (player.debt) return { error: DEBT_BLOCKED };
    if (!canBuild(room, player, tile)) return { error: 'Cannot build there' };
    player.cash -= tile.houseCost;
    tile.houses += 1;
    log(room, `${player.name} built on ${tile.name} (${tile.houses === 5 ? 'hotel' : `${tile.houses} house${tile.houses > 1 ? 's' : ''}`})`);
    return {};
}

function sellHouse(room, playerId, tileId) {
    const player = findPlayer(room, playerId);
    const tile = room.tiles[tileId];
    if (!player || !tile) return { error: 'Unknown tile' };
    // Building on a teammate's deed is allowed; selling off it is not, or a
    // teammate could strip your set to raise cash for themselves.
    if (tile.ownerId !== playerId && sameSide(room, tile.ownerId, playerId)) {
        return { error: 'Only the owner can sell buildings on that' };
    }
    if (tile.ownerId !== playerId || tile.houses < 1) return { error: 'Nothing to sell' };
    if (room.settings.evenBuild) {
        const max = Math.max(...groupTiles(room, tile.groupId).map((t) => t.houses));
        if (tile.houses !== max) return { error: 'Sell evenly across the set' };
    }
    tile.houses -= 1;
    player.cash += Math.floor(tile.houseCost / 2);
    log(room, `${player.name} sold a building on ${tile.name}`);
    payDownDebt(room, player);
    return {};
}

/** Sell a whole (building-free) property back to the bank for what it cost. */
function sellProperty(room, playerId, tileId) {
    const player = findPlayer(room, playerId);
    const tile = room.tiles[tileId];
    if (!player || !tile) return { error: 'Unknown tile' };
    if (room.paused) return { error: 'Game is paused' };
    if (tile.ownerId !== playerId) return { error: 'You do not own that' };
    if (tile.houses > 0) return { error: 'Sell its buildings first' };

    const value = market.priceOf(room, tile);
    tile.ownerId = null;
    player.properties = player.properties.filter((id) => id !== tileId);
    player.cash += value;
    log(room, `${player.name} sold ${tile.name} back to the bank for $${value}`);
    payDownDebt(room, player);
    return {};
}

/* --------------------------------------------------------------- transfers */

/**
 * Hand cash to your teammate. Free on your own turn; outside it there's a fee
 * to the bank, so bailing someone out mid-crisis costs the team something even
 * when it works — otherwise two separate balances are just one balance with
 * extra clicks.
 */
function sendCash(room, fromId, toId, amount) {
    if (room.paused) return { error: 'Game is paused' };
    const from = findPlayer(room, fromId);
    const to = findPlayer(room, toId);
    if (!from || !to || from.id === to.id) return { error: 'Unknown player' };
    if (!room.settings.teams || !sameSide(room, fromId, toId)) return { error: 'Not your teammate' };
    if (from.bankrupt || to.bankrupt) return { error: 'Player is out' };
    if (from.debt) return { error: DEBT_BLOCKED };

    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return { error: 'Nothing to send' };
    const fee = isCurrent(room, fromId) ? 0 : Math.ceil(value * OFF_TURN_FEE);
    if (from.cash < value + fee) return { error: 'Not enough cash' };

    from.cash -= value + fee;
    to.cash += value;
    // The fee leaves the game the same way a tax does.
    if (fee > 0 && room.settings.vacationCash) room.vacationPot += fee;
    log(room, `${from.name} sent $${value} to ${to.name}${fee ? ` (+$${fee} fee)` : ''}`);
    payDownDebt(room, to);
    return {};
}

/* ------------------------------------------------------------------ trades */

/**
 * Trades only exist while they're live — once one is accepted, declined,
 * cancelled or invalidated it leaves the list rather than lingering as history.
 */
function dropTrade(room, tradeId) {
    room.trades = room.trades.filter((t) => t.id !== tradeId);
}

function dropTradesFor(room, playerId) {
    room.trades = room.trades.filter((t) => t.fromId !== playerId && t.toId !== playerId);
}

function normaliseSide(room, player, side) {
    const cash = Math.max(0, Math.min(Math.floor(side?.cash || 0), player.cash));
    const tiles = (side?.tiles || [])
        .map(Number)
        .filter((id) => room.tiles[id] && room.tiles[id].ownerId === player.id && room.tiles[id].houses === 0);
    return { cash, tiles: [...new Set(tiles)] };
}

function createTrade(room, fromId, { toId, give, get, counterOf }) {
    if (room.paused) return { error: 'Game is paused' };
    const from = findPlayer(room, fromId);
    const to = findPlayer(room, toId);
    if (!from || !to || from.id === to.id) return { error: 'Unknown player' };
    if (from.bankrupt || to.bankrupt) return { error: 'Player is out' };
    // Without this, a player about to go under could gift their whole estate to
    // their teammate for nothing and then go bankrupt owning air — which would
    // hand the team everything the bank is supposed to take back, and make
    // declining a bailout free. Selling to the bank or taking the bailout are
    // the ways out of a debt; laundering the estate isn't.
    if (from.debt && sameSide(room, fromId, toId)) {
        return { error: 'You cannot trade with your teammate while you owe money' };
    }

    const giveSide = normaliseSide(room, from, give);
    const getSide = normaliseSide(room, to, get);
    if (!giveSide.cash && !getSide.cash && !giveSide.tiles.length && !getSide.tiles.length) {
        return { error: 'Empty trade' };
    }
    // A counter replaces the offer it answers.
    if (counterOf) dropTrade(room, counterOf);
    // One live offer per direction. Without this a player can bury someone
    // under fifty offers, and since an incoming trade opens a modal that would
    // be a way to stop them playing at all.
    const open = room.trades.find((t) => t.fromId === fromId && t.toId === toId);
    if (open) {
        // A counter is a reply to something they sent you, so it replaces
        // whatever you had open with them rather than being refused — being
        // mid-offer with someone shouldn't stop you answering them.
        if (!counterOf) return { error: `You already have an offer open with ${to.name}` };
        dropTrade(room, open.id);
    }
    const trade = {
        id: uid(),
        fromId,
        toId,
        give: giveSide,
        get: getSide,
        status: 'pending',
        counterOf: counterOf || null,
        at: Date.now(),
    };
    room.trades.unshift(trade);
    log(room, `${from.name} offered ${to.name} a trade`);
    return { trade };
}

function respondTrade(room, playerId, tradeId, response) {
    const trade = room.trades.find((t) => t.id === tradeId);
    if (!trade || trade.status !== 'pending') return { error: 'Trade unavailable' };
    const from = findPlayer(room, trade.fromId);
    const to = findPlayer(room, trade.toId);
    if (!from || !to) return { error: 'Unknown player' };

    if (response === 'cancel') {
        if (playerId !== trade.fromId) return { error: 'Not your trade' };
        dropTrade(room, tradeId);
        return {};
    }
    if (playerId !== trade.toId) return { error: 'Not your trade' };
    if (response === 'decline') {
        dropTrade(room, tradeId);
        log(room, `${to.name} declined a trade from ${from.name}`);
        return {};
    }
    if (response !== 'accept') return { error: 'Unknown response' };
    // The debt may have appeared after the offer was made — see createTrade.
    if ((from.debt || to.debt) && sameSide(room, from.id, to.id)) {
        dropTrade(room, tradeId);
        return { error: 'Teammates cannot trade while either of you owes money' };
    }

    // Re-validate: ownership and cash may have changed since the offer.
    const giveOk = trade.give.tiles.every((id) => room.tiles[id].ownerId === from.id) && from.cash >= trade.give.cash;
    const getOk = trade.get.tiles.every((id) => room.tiles[id].ownerId === to.id) && to.cash >= trade.get.cash;
    if (!giveOk || !getOk) {
        dropTrade(room, tradeId);
        return { error: 'That trade is no longer valid' };
    }

    const moveTile = (id, owner, receiver) => {
        room.tiles[id].ownerId = receiver.id;
        owner.properties = owner.properties.filter((t) => t !== id);
        receiver.properties.push(id);
    };
    trade.give.tiles.forEach((id) => moveTile(id, from, to));
    trade.get.tiles.forEach((id) => moveTile(id, to, from));
    from.cash += trade.get.cash - trade.give.cash;
    to.cash += trade.give.cash - trade.get.cash;
    dropTrade(room, tradeId);
    room.stats.trades += 1;
    log(room, `${to.name} accepted a trade with ${from.name}`);
    // Trading is a legitimate way to raise the money, so a debt can be cleared
    // by selling a property to another player rather than back to the bank.
    payDownDebt(room, from);
    payDownDebt(room, to);
    return {};
}

/**
 * Voluntary bankruptcy. The whole estate goes back to the bank rather than to
 * another player, and the seat is closed for good — see addPlayer().
 */
function declareBankruptcy(room, playerId) {
    if (room.phase === 'waiting' || room.phase === 'ended') return { error: 'Game is not running' };
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (player.bankrupt) return { error: 'You are already out' };

    const wasCurrent = isCurrent(room, playerId);
    // Resigning is the one thing you may do while in debt — it's the way out.
    player.resigned = true;
    goBankrupt(room, player);

    // Withdraw their bid rather than letting them win a tile they can't pay for.
    if (room.auction?.bidderId === playerId) {
        room.auction.bidderId = null;
        room.auction.bid = 0;
        room.auction.nextBid = room.auction.opening ?? market.MIN_OPENING_BID;
    }

    if (room.phase === 'ended') return {};
    if (wasCurrent) {
        room.pendingAction = null;
        room.pendingCard = null;
        advanceTurn(room);
    }
    return {};
}

/* -------------------------------------------------------------- vote-kick */

/**
 * Everyone entitled to a say: still in the game, and not the person on trial.
 * Bankrupt players are out of it — they have nothing left to lose by voting.
 */
function voters(room, targetId) {
    return activePlayers(room).filter((p) => p.id !== targetId);
}

/**
 * How many yes votes a kick takes: everyone else still in the game, up to four.
 * So 3 players need 2, 4 need 3, 5 need 4, and any bigger table stays at 4.
 *
 * Unanimity rather than a majority, because removing someone from a game with
 * friends should take the whole table agreeing rather than half of it. The
 * floor of 2 is what stops one player ever removing another on their own — if
 * bankruptcies leave only one eligible voter, the bar becomes unreachable and
 * the vote fails immediately rather than handing them the power.
 */
const votesNeeded = (room, targetId) => clampVotes(voters(room, targetId).length);
const clampVotes = (eligible) => Math.max(2, Math.min(eligible, VOTE_CAP));

function startVoteKick(room, byId, targetId) {
    if (room.phase === 'ended') return { error: 'Game is over' };
    if (room.vote) return { error: 'A vote is already running' };
    const by = findPlayer(room, byId);
    const target = findPlayer(room, targetId);
    if (!by || !target) return { error: 'Unknown player' };
    if (by.id === target.id) return { error: 'You cannot vote yourself out' };
    if (by.bankrupt) return { error: 'You are out of the game' };
    if (target.bankrupt) return { error: `${target.name} is already out` };

    // Someone who isn't connected can't put their case, and there's nothing for
    // the table to weigh — either they come back or they don't. So the ballot is
    // replaced by a clock, and the only vote that counts is theirs: reconnect
    // and it's dropped.
    //
    // The three-player floor doesn't apply to that. It exists so a kick can't be
    // one player's decision, and a countdown isn't one — it's the absence that
    // decides. It's also the only way out of a two-player game whose other half
    // has gone for good.
    const abandoned = !target.connected;
    if (!abandoned && voters(room, targetId).length + 1 < MIN_VOTERS) {
        return { error: `Needs at least ${MIN_VOTERS} players in the game` };
    }
    const until = room.voteCooldown?.[targetId] || 0;
    if (until > Date.now()) {
        return { error: `${target.name} was just voted on — try again in ${Math.ceil((until - Date.now()) / 1000)}s` };
    }

    room.vote = {
        targetId,
        byId,
        mode: abandoned ? 'abandon' : 'ballot',
        yes: abandoned ? [] : [byId], // calling the vote is a vote
        no: [],
        needed: abandoned ? 0 : votesNeeded(room, targetId),
        // Both ends of the window, so the client can draw how far through it is
        // without having to know how long either kind runs for.
        startedAt: Date.now(),
        endsAt: Date.now() + (abandoned ? ABANDON_MS : VOTE_MS),
    };
    log(
        room,
        abandoned
            ? `${by.name} started a countdown on ${target.name}, who has dropped out`
            : `${by.name} started a vote to kick ${target.name}`,
    );
    return resolveVoteIfDecided(room) || {};
}

/** A vote on someone no longer in play has nothing left to decide. */
function dropVoteFor(room, playerId) {
    if (room.vote?.targetId !== playerId) return false;
    room.vote = null;
    return true;
}

/**
 * They came back. Nothing to decide any more, and no cooldown either — if the
 * table still wants them gone, that's now an ordinary vote they can answer.
 */
function cancelAbandon(room, playerId) {
    const vote = room.vote;
    if (!vote || vote.mode !== 'abandon' || vote.targetId !== playerId) return false;
    room.vote = null;
    const target = findPlayer(room, playerId);
    log(room, `${target ? target.name : 'They'} made it back — the countdown was dropped`);
    return true;
}

/**
 * A restore hands every player back disconnected, so an inherited countdown
 * would run out before anyone had a chance to reconnect. Give it back its full
 * length from the moment the server is up.
 */
function refreshAbandonDeadline(room) {
    if (room.vote?.mode !== 'abandon') return;
    room.vote.startedAt = Date.now();
    room.vote.endsAt = Date.now() + ABANDON_MS;
}

function castVote(room, playerId, agree) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
    if (vote.mode === 'abandon') return { error: 'Nothing to vote on — they have to reconnect' };
    if (playerId === vote.targetId) return { error: 'You cannot vote on your own removal' };
    const player = findPlayer(room, playerId);
    if (!player || player.bankrupt) return { error: 'You are out of the game' };
    if (vote.yes.includes(playerId) || vote.no.includes(playerId)) return { error: 'You already voted' };

    (agree ? vote.yes : vote.no).push(playerId);
    return resolveVoteIfDecided(room) || {};
}

/**
 * Close the vote the moment the outcome can't change, rather than making
 * everyone sit out the clock on a decision that's already settled.
 */
function resolveVoteIfDecided(room) {
    const vote = room.vote;
    if (!vote) return null;
    // A countdown has no tally to settle — it ends when the clock does, or the
    // moment they reconnect.
    if (vote.mode === 'abandon') return null;
    // Recounted every time: someone may have gone bankrupt mid-vote, which
    // changes how many people are left to agree.
    const eligible = voters(room, vote.targetId).length;
    const needed = clampVotes(eligible);
    vote.needed = needed;

    if (vote.yes.length >= needed) return finishVote(room, true);
    // Can't reach the bar even if every remaining voter says yes.
    const undecided = eligible - vote.yes.length - vote.no.length;
    if (vote.yes.length + undecided < needed) return finishVote(room, false);
    return null;
}

/** Called by the room's vote timer when the clock runs out. */
function expireVote(room) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
    if (vote.mode === 'abandon') {
        // Checked here rather than trusted from when the clock started: they
        // may have slipped back in on the last second.
        const target = findPlayer(room, vote.targetId);
        return finishVote(room, !!target && !target.connected);
    }
    return finishVote(room, vote.yes.length >= vote.needed);
}

function finishVote(room, passed) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
    room.vote = null;
    const target = findPlayer(room, vote.targetId);
    if (!target) return {};

    const abandoned = vote.mode === 'abandon';

    if (!passed) {
        room.voteCooldown[vote.targetId] = Date.now() + VOTE_COOLDOWN_MS;
        log(
            room,
            abandoned
                ? `${target.name} came back in time`
                : `The vote to kick ${target.name} failed (${vote.yes.length}/${vote.needed})`,
        );
        return {};
    }

    // Banned, not merely removed — otherwise they reconnect two seconds later
    // and the vote meant nothing.
    if (!room.banned.includes(target.id)) room.banned.push(target.id);
    log(
        room,
        abandoned
            ? `${target.name} never came back and is out`
            : `${target.name} was voted out (${vote.yes.length}/${vote.needed})`,
    );

    if (room.phase === 'waiting') {
        removePlayer(room, target.id);
        return {};
    }
    // Mid-game it's the same exit as resigning: the estate goes back to the
    // bank, so being kicked can't become a way to hand a friend your property.
    const wasCurrent = isCurrent(room, target.id);
    target.resigned = true;
    goBankrupt(room, target);
    if (room.auction?.bidderId === target.id) {
        room.auction.bidderId = null;
        room.auction.bid = 0;
        room.auction.nextBid = room.auction.opening ?? market.MIN_OPENING_BID;
    }
    if (room.phase !== 'ended' && wasCurrent) {
        room.pendingAction = null;
        room.pendingCard = null;
        advanceTurn(room);
    }
    return {};
}

/* ------------------------------------------------------------ misc actions */

function togglePause(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    room.paused = !room.paused;
    room.pausedBy = room.paused ? player.id : null;
    log(room, room.paused ? `${player.name} paused the game` : `${player.name} resumed the game`);
    return {};
}

function addChat(room, playerId, text) {
    // Watchers get to talk. Being out of the game is not the same as being out
    // of the room, and half the reason to stay is to say something about it.
    const player = findPlayer(room, playerId) || room.spectators.find((s) => s.id === playerId);
    const body = String(text || '').trim().slice(0, 240);
    if (!player || !body) return { error: 'Empty message' };
    const color = player.color || '#9aa0b5';
    room.chat.push({ id: uid(), playerId, name: player.name, color, text: body, at: Date.now() });
    if (room.chat.length > 200) room.chat.shift();
    room.stats.chatMessages += 1;
    return {};
}

const ACTIVITY_KINDS = ['trading', 'viewing'];

/** Ambient "what is this player doing" flag, e.g. building or reading a trade. */
function setActivity(room, playerId, activity = {}) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    const kind = ACTIVITY_KINDS.includes(activity?.kind) ? activity.kind : null;
    player.activity = kind ? { kind, tradeId: activity.tradeId || null } : null;
    return {};
}

/**
 * Give up a seat entirely. Only possible before the game starts — once it's
 * running a player owns property and holds a place in the turn order, so
 * leaving can only ever mean "disconnected", and the seat is held for them.
 *
 * In the lobby there's nothing to hold: keeping the row meant a leaver still
 * took up a seat against the player cap, still filled a team slot, and — if
 * they were the host — took the ability to change any setting or start the
 * game with them.
 */
function removePlayer(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.phase !== 'waiting') {
        markDisconnected(room, playerId);
        return { kept: true };
    }

    room.players = room.players.filter((p) => p.id !== playerId);
    dropVoteFor(room, playerId);
    log(room, `${player.name} left`);
    // The room outlives its host — otherwise the rules are frozen for everyone
    // left behind and nobody can start.
    if (room.hostId === playerId) {
        room.hostId = room.players[0]?.id || null;
        if (room.hostId) log(room, `${findPlayer(room, room.hostId).name} is now the host`);
    }
    // Their team is a player short now; the remaining member keeps their slot
    // and the host can re-pick. Colours only churn when teams are on, where
    // they're derived rather than chosen.
    // A seat freed can also free the colour that came with it, so whoever was
    // sharing it goes back to wearing it plain.
    if (room.settings.teams) recolourTeams(room);
    else recolourPlayers(room);
    return {};
}

function markDisconnected(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return;
    player.activity = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    log(room, `${player.name} disconnected`);
}

/**
 * Called after the grace period for someone who vanished from the lobby rather
 * than pressing Leave — a closed tab, a dead connection. The grace period is
 * what makes this safe against a refresh, which is also a disconnect.
 */
function dropIfStillGone(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player || player.connected || room.phase !== 'waiting') return false;
    removePlayer(room, playerId);
    return true;
}

/** Called after the grace period — skips their turn so the game can continue. */
function skipIfStillGone(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player || player.connected || room.phase === 'waiting' || room.phase === 'ended') return false;
    if (!isCurrent(room, playerId)) return false;
    log(room, `${player.name} is away — turn skipped`);
    advanceTurn(room);
    return true;
}

function resetForRematch(room) {
    room.tiles = makeTiles(room.board);
    room.decks = makeDecks(room.board);
    room.turnIndex = 0;
    room.phase = 'waiting';
    room.paused = false;
    room.pausedBy = null;
    room.diceRoll = [0, 0];
    room.doublesCount = 0;
    room.hasRolled = false;
    room.pendingAction = null;
    room.pendingCard = null;
    room.lastMove = null;
    room.trades = [];
    room.winnerId = null;
    room.winnerTeam = null;
    room.auction = null;
    room.vote = null;
    room.idle = null;
    room.lastPayment = null;
    // Cooldowns are per-game grudges; the ban list is not — someone voted out
    // stays out of this room rather than reappearing for the next round.
    room.voteCooldown = {};
    room.vacationPot = 0;
    room.log = [];
    room.stats = {
        startedAt: null, endedAt: null, turnCount: 0, doubles: 0, trades: 0,
        chatMessages: 0, visits: {}, jailVisits: {}, netWorth: [],
    };
    room.players = room.players
        .filter((p) => p.connected && !p.resigned)
        .map((p) => ({
            ...p,
            cash: room.settings.startingCash,
            position: 0,
            properties: [],
            inJail: false,
            jailTurns: 0,
            jailCards: 0,
            bankrupt: false,
            debt: null,
        }));
    if (room.players.length && !room.players.some((p) => p.id === room.hostId)) {
        room.hostId = room.players[0].id;
    }
    // Someone may not have come back, which can leave a team a player short.
    if (room.settings.teams && teamsReady(room).error) autoAssignTeams(room);
    log(room, 'New game — back to the lobby');
}

module.exports = {
    PLAYER_COLORS,
    TEAM_IDS,
    TEAM_COLORS,
    TEAM_SIZE,
    JAIL_FINE,
    BID_STEPS,
    DEFAULT_SETTINGS,
    updateSettings,
    setTeam,
    sendCash,
    respondBailout,
    startVoteKick,
    castVote,
    expireVote,
    cancelAbandon,
    refreshAbandonDeadline,
    setProfile,
    taxFor,
    payBank,
    transfer,
    armIdle,
    noteActive,
    expireIdle,
    spectateReason,
    addSpectator,
    removeSpectator,
    isSpectator,
    sameSide,
    teammate,
    startAuction,
    placeBid,
    resolveAuction,
    makeRoomCode,
    createRoom,
    publicState,
    findPlayer,
    currentPlayer,
    addPlayer,
    startGame,
    rollDice,
    buyProperty,
    declinePurchase,
    endTurn,
    payJailFine,
    useJailCard,
    buildHouse,
    sellHouse,
    sellProperty,
    declareBankruptcy,
    canBuild,
    createTrade,
    respondTrade,
    togglePause,
    setActivity,
    addChat,
    markDisconnected,
    removePlayer,
    dropIfStillGone,
    skipIfStillGone,
    resetForRematch,
    netWorth,
    ownsFullGroup,
};
