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
    board: DEFAULT_BOARD,
};

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
        players: [],
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
        teamSize: TEAM_SIZE,
        offTurnFee: OFF_TURN_FEE,
        settings: room.settings,
        // Board meta rides along with the state rather than being handed out
        // once on join, since the host can swap boards in the lobby.
        board: boardMeta(room.board),
        boards: BOARD_LIST,
        completedGroups: sets,
        stats: room.stats,
    };
}

/* --------------------------------------------------------------- lobby ops */

function addPlayer(room, { name, playerId }) {
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
        return { player: existing, rejoined: true };
    }
    if (room.phase !== 'waiting') return { error: 'Game already in progress' };
    if (room.players.length >= room.settings.maxPlayers) return { error: 'Room is full' };

    const used = new Set(room.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
    const player = {
        id: playerId || uid(),
        name: (name || 'player').slice(0, 16),
        color,
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
    if (!room.hostId) room.hostId = player.id;
    log(room, `${player.name} joined`);
    return { player, rejoined: false };
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

/**
 * Teammates wear the same hue in two shades, so `player.color` stays the single
 * source of truth for every existing token, tile marker and rail row.
 */
function recolourTeams(room) {
    if (!room.settings.teams) {
        const used = new Set();
        for (const p of room.players) {
            p.color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[0];
            used.add(p.color);
        }
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
 */
function taxFor(room, player, tile) {
    const rule = tile.tax || { amount: 100 };
    if (rule.percent) return Math.round((netWorth(room, player) * rule.percent) / 100);
    return rule.amount || 0;
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
        return;
    }
    let guard = 0;
    do {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        guard += 1;
    } while (room.players[room.turnIndex].bankrupt && guard <= room.players.length);
    room.phase = 'rolling';
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

/** Strict majority of the people who could vote, so a tie fails. */
const votesNeeded = (room, targetId) => Math.floor(voters(room, targetId).length / 2) + 1;

function startVoteKick(room, byId, targetId) {
    if (room.phase === 'ended') return { error: 'Game is over' };
    if (room.vote) return { error: 'A vote is already running' };
    const by = findPlayer(room, byId);
    const target = findPlayer(room, targetId);
    if (!by || !target) return { error: 'Unknown player' };
    if (by.id === target.id) return { error: 'You cannot vote yourself out' };
    if (by.bankrupt) return { error: 'You are out of the game' };
    if (target.bankrupt) return { error: `${target.name} is already out` };

    // Two people can't gang up on a third in a game that small — from three
    // players up, a majority means more than one person actually agreed.
    if (voters(room, targetId).length + 1 < MIN_VOTERS) {
        return { error: `Needs at least ${MIN_VOTERS} players in the game` };
    }
    const until = room.voteCooldown?.[targetId] || 0;
    if (until > Date.now()) {
        return { error: `${target.name} was just voted on — try again in ${Math.ceil((until - Date.now()) / 1000)}s` };
    }

    room.vote = {
        targetId,
        byId,
        yes: [byId], // calling the vote is a vote
        no: [],
        needed: votesNeeded(room, targetId),
        endsAt: Date.now() + VOTE_MS,
    };
    log(room, `${by.name} started a vote to kick ${target.name}`);
    // At three players the caller alone is already a majority of the two
    // eligible voters, so this can resolve immediately.
    return resolveVoteIfDecided(room) || {};
}

function castVote(room, playerId, agree) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
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
    // Recounted every time: someone may have gone bankrupt mid-vote, which
    // changes what a majority is.
    const eligible = voters(room, vote.targetId).length;
    const needed = Math.floor(eligible / 2) + 1;
    vote.needed = needed;

    if (vote.yes.length >= needed) return finishVote(room, true);
    // Can't reach the bar even if every remaining voter says yes.
    const undecided = eligible - vote.yes.length - vote.no.length;
    if (vote.yes.length + undecided < needed) return finishVote(room, false);
    return null;
}

/** Called by the room's vote timer when the clock runs out. */
function expireVote(room) {
    if (!room.vote) return { error: 'No vote running' };
    return finishVote(room, room.vote.yes.length >= room.vote.needed);
}

function finishVote(room, passed) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
    room.vote = null;
    const target = findPlayer(room, vote.targetId);
    if (!target) return {};

    if (!passed) {
        room.voteCooldown[vote.targetId] = Date.now() + VOTE_COOLDOWN_MS;
        log(room, `The vote to kick ${target.name} failed (${vote.yes.length}/${vote.needed})`);
        return {};
    }

    // Banned, not merely removed — otherwise they reconnect two seconds later
    // and the vote meant nothing.
    if (!room.banned.includes(target.id)) room.banned.push(target.id);
    log(room, `${target.name} was voted out (${vote.yes.length}/${vote.needed})`);

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
    const player = findPlayer(room, playerId);
    const body = String(text || '').trim().slice(0, 240);
    if (!player || !body) return { error: 'Empty message' };
    room.chat.push({ id: uid(), playerId, name: player.name, color: player.color, text: body, at: Date.now() });
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
    if (room.settings.teams) recolourTeams(room);
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
