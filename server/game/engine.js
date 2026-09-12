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
 * Team ids, and the hue each one wears. Teammates share a hue so the board reads
 * as "theirs" at a glance, and differ in lightness so two tokens on the same
 * tile are still two tokens — a single flat colour would make the board honest
 * about the team and useless about the player.
 *
 * Eight hues, because that is about as many as stay apart from each other on a
 * dark board. The shades within one are worked out from the hue when the sides
 * are dealt, so a team holds as many people as it likes: what caps a game is
 * the room's own player limit, not the number of colours written down here.
 */
const TEAM_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const TEAM_COLORS = {
    A: '#7c5cff',
    B: '#ff5c7c',
    C: '#3ddc97',
    D: '#ffb648',
    E: '#4cc9f0',
    F: '#f072d0',
    G: '#a3e635',
    H: '#ff8a5c',
};
/** What an auto-deal aims for, while the table is small enough to have the choice. */
const TEAM_PAIR = 2;

/**
 * Shares in a country — the exchange.
 *
 * A monopoly is the only thing on a normal board worth having, and at twelve
 * players most of the table never gets one: the deeds run out first. A share
 * is a stake in somebody else's country — a quarter of every rent its tiles
 * collect, bought from the bank, with the deed left exactly where it is.
 *
 * The cut comes out of the rent rather than out of the bank, so the payer pays
 * what they always paid and no new money enters a game that already inflates.
 * Two to a country, so an owner can be taken to half their rent and no
 * further. Priced off what the country earns now (see SHARE_PAYBACK), and
 * bought back on a closing window (see BUYBACK_LADDER): the shareholder cannot
 * be robbed, only bought out at a premium, and the owner is taxed forever only
 * if they wait three of the holder's laps to do something about it.
 */
/**
 * Landmarks: the one thing on the board money cannot buy.
 *
 * Everything else here rewards being ahead — rent needs deeds, shares need
 * cash, and the player who started badly is priced out of both. A landmark is
 * claimed by standing on it, costs nothing, and is not exclusive: everyone who
 * lands there keeps it for the rest of the game. It is the one race a losing
 * player can still win, and it takes nothing from anybody to do it.
 *
 * Two kinds, named in the layout's `extra`: a bigger payout every time you pass
 * Start, or a standing discount on rent you pay. Both are permanent, both stack
 * with a second landmark of the same kind, and neither can be traded or taken.
 */
const SHARE_CUT = 0.25;
const SHARES_PER_GROUP = 2;
/**
 * The floor under a share's price, as a fraction of what the country's deeds
 * cost together — what a stake in a country nobody has built on is worth.
 */
const SHARE_PRICE = 0.2;
/**
 * How many landings a share should take to pay for itself, at any point in the
 * game. The price follows what the country earns *now*, so this stays true when
 * the hotels go up — which is the whole fix. A price pegged to the deeds let a
 * $170 stake in a hotel country pay for itself three times over on one landing,
 * and let the owner shake it off for $255: late in a game neither buying one
 * nor buying one back was a decision at all.
 */
const SHARE_PAYBACK = 4;
/**
 * What a deed holder pays to take a share back, by how many laps it has been
 * held — and past the end of the ladder, it cannot be taken at all.
 *
 * A window that closes rather than a flat price, so buying back is a race the
 * owner can lose: act while it is cheap, or pay double, or live with the stake
 * for the rest of the game. For the shareholder it is the reverse — survive
 * three laps and it is yours for good.
 */
const BUYBACK_LADDER = [1.5, 2, 3];
/** Charged on a transfer made outside your own turn. */
const OFF_TURN_FEE = 0.1;

const STARTING_CASH = 1500;
const PASS_START_BONUS = 200;
const JAIL_FINE = 50;
const MAX_JAIL_TURNS = 3;

// Short on purpose: an auction is a reflex, not a negotiation, and every bid
// puts the full clock back so a contested tile still gets its back-and-forth.
//
// Six seconds was right while an auction was a modal over a blacked-out screen,
// with nothing to look at but the bid. Now it runs in the middle of the board
// with the country lit up around it, and the whole point is that people read
// the board before they bid — which takes longer than a reflex.
const AUCTION_MS = 10_000;
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
    // The shape of the sides, when teams are on. Eight letters and no size cap
    // is the open end of it; a host who wants four threes says so here and the
    // deal, the picker and the start check all follow the same two numbers.
    maxTeams: 8,
    maxTeamSize: 0,
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

/**
 * The same clock for someone who isn't there. Nobody is going to move the mouse
 * from a closed tab, so the whole reason the window above is generous — that a
 * person might be reading, or counting — doesn't apply. A minute per absent
 * player is how an hour-long game turns into ten minutes of watching nothing
 * happen once people start drifting off at the end.
 */
const AWAY_MS = Number(process.env.NOPOLY_AWAY_MS) || 5_000;

/**
 * Except right after they drop, where a refresh looks exactly like leaving. So
 * the shortened clock never comes due sooner than this, counted from the moment
 * the socket died: gone for two seconds is someone reloading, gone for two
 * minutes is someone gone.
 *
 * Keep it longer than DISCONNECT_GRACE_MS in index.js — that grace is the
 * promise that a refresh mid-turn costs you nothing, and this would break it.
 */
const AWAY_GRACE_MS = Number(process.env.NOPOLY_AWAY_GRACE_MS) || 50_000;

/**
 * How long a paused game is kept with nobody touching it.
 *
 * A pause is how a table says "we'll finish this later", so the sweep's usual
 * endings — everyone gone for half an hour, nothing sent for three — are
 * exactly what it has to survive. A day is enough for "later tonight" and
 * "tomorrow", and short enough that a pause somebody forgot about still ends.
 */
const PAUSED_ROOM_MS = Number(process.env.NOPOLY_PAUSED_ROOM_MS) || 24 * 60 * 60 * 1000;

/** Bounds every settings value is clamped to before it's stored. */
const SETTING_LIMITS = {
    startingCash: { min: 500, max: 10000 },
    passStartBonus: { min: 0, max: 1000 },
    maxPlayers: { min: 2, max: 999 },
    maxTeams: { min: 2, max: 8 },
    // Zero is the default and means no cap — a side holds whoever the host puts
    // on it. Anything above that is a real limit the picker enforces.
    maxTeamSize: { min: 0, max: 99 },
};

const uid = () => crypto.randomUUID();

/** Shown whenever a player tries to carry on with a debt outstanding. */
const DEBT_BLOCKED = 'Settle your debt first — sell buildings or property';

/* Vote-kick. Long enough that someone mid-turn can still weigh in, short
 * enough that a vote nobody answers doesn't sit on screen all game. */
const VOTE_MS = 45_000;
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
 * on them goes through on its own. Two minutes: long enough for a phone
 * changing networks or a refresh that hung, short enough that a table is not
 * sat looking at an empty seat for the length of a song.
 */
const ABANDON_MS = 2 * 60_000;
/**
 * How long a game runs before anyone can be voted out: five minutes. Every vote
 * called inside that window was someone reacting to a bad opening roll.
 */
// Overridable only so a wire test doesn't have to play five minutes of a game
// before it can call the vote it is there to test.
const VOTE_OPEN_MS = Number(process.env.NOPOLY_VOTE_OPEN_MS ?? 5 * 60_000);

/**
 * The rules this room is playing by.
 *
 * Required inside the call rather than at the top of the file: rules.js
 * requires this module to register the property game, so a top-level require
 * here would be a cycle and hand one of the two a half-built exports object.
 * `require` caches, so after the first call this is a map lookup.
 */
const rulesFor = (room) => require('./rules').rulesFor(room);

/* ------------------------------------------------------------------ rooms */

function makeRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
}

/**
 * A room, in two halves: everything every game needs, and then whatever the
 * game being played adds to it.
 *
 * `opts` also accepts a bare board id, which is what the second argument used
 * to be — a room made by an older caller is still a room.
 */
function createRoom(code, opts = {}) {
    const { game, boardId } = typeof opts === 'string' ? { boardId: opts } : opts;
    const room = {
        roomCode: code,
        // Which rules module owns this room. Set once, at creation: changing it
        // later would mean rebuilding every player record mid-lobby.
        game: require('./rules').gameId(game),
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
        // Whose turn it is. Generic on purpose: every game here has a seat
        // order, and the client reads `players[turnIndex]` to work out who is
        // playing without knowing which game it is looking at.
        turnIndex: 0,
        paused: false,
        pausedBy: null,
        phase: 'waiting',
        log: [],
        chat: [],
        vote: null,           // { targetId, byId, yes: [], no: [], endsAt }
        idle: null,           // { playerId, endsAt } — the turn clock
        banned: [],           // player ids a vote removed; they can't come back
        winnerId: null,
        winnerTeam: null,
        settings: { ...DEFAULT_SETTINGS },
        stats: {
            startedAt: null,
            endedAt: null,
            turnCount: 0,
            chatMessages: 0,
        },
    };
    rulesFor(room).createRoom(room, { boardId });
    return room;
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

/** The team letters this room is playing with, in order. */
const teamIdsFor = (room) => TEAM_IDS.slice(0, room.settings.maxTeams || TEAM_IDS.length);

/** Everyone else on a player's side — any number of them, since a team is not a pair. */
function teammates(room, player) {
    if (!player?.teamId || !room.settings.teams) return [];
    return room.players.filter((p) => p.id !== player.id && p.teamId === player.teamId);
}

/** The first of them, for the places that only need to know whether there is one. */
const teammate = (room, player) => teammates(room, player)[0] || null;

/**
 * Who gets asked to cover a debt. With more than one teammate it has to be
 * somebody, and the one holding the most is both the likeliest to manage it and
 * the least hurt by trying.
 */
function livingTeammate(room, player) {
    return teammates(room, player)
        .filter((p) => !p.bankrupt)
        .sort((a, b) => b.cash - a.cash)[0] || null;
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
            color: TEAM_COLORS[p.teamId],
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

/**
 * What a player's landmarks add up to. Read fresh from the tiles each time
 * rather than kept as a running total, so a snapshot written before landmarks
 * existed, or a board swapped underneath a room, cannot leave a stale bonus
 * attached to somebody.
 */
function boonsOf(room, player) {
    let startBonus = 0;
    let rentOff = 0;
    for (const id of player.landmarks || []) {
        const boon = room.tiles[id]?.boon;
        if (!boon) continue;
        startBonus += boon.startBonus || 0;
        rentOff += boon.rentOff || 0;
    }
    // Half off is as far as it goes, however many landmarks a long game hands
    // out — rent that rounds to nothing would stop the board working.
    return { startBonus, rentOff: Math.min(rentOff, 50) };
}

/** Every share out in a country. Guarded for rooms restored from older saves. */
const sharesIn = (room, groupId) => (room.shares || []).filter((sh) => sh.groupId === groupId);
/** Every share one player holds. */
const sharesOf = (room, playerId) => (room.shares || []).filter((sh) => sh.holderId === playerId);

/**
 * What a share in a country costs: a fifth of what its deeds cost together,
 * rounded to something a person can say out loud. Off the deeds' list prices
 * rather than the market's, so the number on the exchange doesn't drift while
 * you are reading it.
 */
/** What landing on a tile would cost right now, or nothing if nobody owns it. */
function liveRent(room, tile) {
    const owner = tile.ownerId && findPlayer(room, tile.ownerId);
    if (!owner || owner.bankrupt) return 0;
    return rentFor(room, tile, owner, [0, 0]);
}

/**
 * A share's price: what the country earns, not what it cost.
 *
 * The average rent across the country's tiles — an unowned tile pays nobody and
 * counts as nothing, which is how a half-bought country is discounted — times
 * how many landings a stake should take to pay back, never below a fifth of the
 * deeds. A bare country's share is as cheap as it always was; a country with
 * hotels on it is priced like one.
 */
function sharePrice(room, groupId) {
    const tiles = groupTiles(room, groupId);
    const deeds = tiles.reduce((sum, t) => sum + (t.price || 0), 0);
    const earning = tiles.reduce((sum, t) => sum + liveRent(room, t), 0) / Math.max(tiles.length, 1);
    const value = Math.max(deeds * SHARE_PRICE, earning * SHARE_PAYBACK * SHARE_CUT);
    return Math.max(10, Math.round(value / 10) * 10);
}

/**
 * What taking this share back costs, or null once it is held for good.
 *
 * Priced off whichever is higher, what they paid or what it is worth now: a
 * shareholder is bought out, never robbed, so a country whose houses were sold
 * off since cannot be used to take a stake back for less than it cost.
 */
function buybackPrice(room, share) {
    const laps = share.laps || 0;
    if (laps >= BUYBACK_LADDER.length) return null;
    const base = Math.max(share.paid, sharePrice(room, share.groupId));
    return Math.round((base * BUYBACK_LADDER[laps]) / 10) * 10;
}

/** What every country's share costs, for the exchange screen. */
function sharePrices(room) {
    const out = {};
    for (const groupId of Object.keys(groupsOf(room))) out[groupId] = sharePrice(room, groupId);
    return out;
}

/**
 * Everything a player is worth, itemised.
 *
 * One function rather than a sum, because the number on the rail was being
 * doubted — and a total nobody can take apart is a total nobody believes. The
 * client is sent the parts and shows them, so "why is my net worth that?" has
 * an answer on screen instead of an argument.
 *
 * What counts, and why:
 *
 *   cash       obvious.
 *   deeds      every property, airport and utility, at what the board says it
 *              is worth now — which is the list price, or the market's price
 *              when dynamic values are on, because that is what it would fetch.
 *   buildings  houses and hotels at what they cost to put up, all five levels
 *              of them. Not half, the way `liquidValue` counts them: this is a
 *              measure of what you have, not of what you could raise by
 *              tomorrow morning.
 *   shares     at what was paid, which is also what the bank buys them back at.
 *   jailCards  worth the fine they save, since that is exactly what a player
 *              spends one to avoid.
 *   debt       subtracted. An unsettled bill is a real liability, and leaving
 *              it out would rank someone above a rival they cannot actually
 *              afford to stay in the game against.
 *
 * Landmarks are deliberately absent: they cannot be sold, traded or taken, so
 * any figure put on one would be invented.
 */
function worthOf(room, player) {
    let deeds = 0;
    let buildings = 0;
    for (const id of player.properties) {
        const tile = room.tiles[id];
        if (!tile) continue;
        deeds += market.priceOf(room, tile);
        buildings += tile.houses * (tile.houseCost || 0);
    }
    const parts = {
        cash: player.cash,
        deeds,
        buildings,
        shares: shareValue(room, player),
        jailCards: (player.jailCards || 0) * JAIL_FINE,
        debt: player.debt?.amount ?? 0,
    };
    // Two totals, because they answer different questions. `estate` is what
    // they hold; `total` is that less what they owe, which is the number worth
    // ranking people by. And `liquid` is neither: it is what selling would
    // actually raise before the bill is due — buildings come back at half, so
    // it sits below the estate and is the figure that decides bankruptcy.
    parts.estate = parts.cash + parts.deeds + parts.buildings + parts.shares + parts.jailCards;
    parts.total = parts.estate - parts.debt;
    parts.liquid = liquidValue(room, player);
    return parts;
}

function netWorth(room, player) {
    return worthOf(room, player).total;
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
/**
 * What everyone in the room is told, in two halves.
 *
 * The common half is below; the game supplies the rest, and supplies it last
 * so it can sharpen anything it needs to — the property game's `players`
 * carry an estate, and a card game's carry a hand count and nothing else.
 *
 * `viewerId` is who is being told. It exists for games where the state is not
 * the same for everybody; the property game ignores it, because a board is on
 * the table and everyone can see it.
 */
function publicState(room, viewerId = null) {
    return { ...baseState(room), ...rulesFor(room).view(room, viewerId) };
}

function baseState(room) {
    return {
        roomCode: room.roomCode,
        // Which game this is, so the client can pick a screen before it reads
        // anything else.
        game: room.game,
        hostId: room.hostId,
        // Names only — there's nothing else about a watcher worth sending, and
        // the table should be able to see who's looking over their shoulder.
        spectators: room.spectators.map(({ id, name, seated }) => ({ id, name, seated })),
        turnIndex: room.turnIndex,
        paused: room.paused,
        pausedBy: room.pausedBy,
        // When a paused game stops being kept, so the table can be told.
        pausedUntil: room.paused && room.pausedAt ? room.pausedAt + PAUSED_ROOM_MS : null,
        phase: room.phase,
        vote: room.vote,
        voteMs: VOTE_MS,
        // The two rules a ballot has, sent rather than duplicated in the client,
        // so the picker greys people out by the rule the server enforces.
        voteOpensAt: voteOpensAt(room),
        minVoters: MIN_VOTERS,
        idle: room.idle,
        idleMs: IDLE_MS,
        log: room.log,
        chat: room.chat,
        winnerId: room.winnerId,
        winnerTeam: room.winnerTeam,
        teams: room.settings.teams ? teamSummary(room) : null,
        teamIds: teamIdsFor(room),
        teamColors: TEAM_COLORS,
        // The palette to choose from, so the picker and the validation that
        // guards it can't drift apart.
        playerColors: PLAYER_COLORS,
        teamPair: TEAM_PAIR,
        settings: room.settings,
        games: require('./rules').GAME_LIST,
        stats: room.stats,
    };
}

/** The property game's half of it. */
function nopolyView(room) {
    const sets = completedGroups(room);
    return {
        players: room.players.map((p) => {
            const worth = worthOf(room, p);
            return { ...p, netWorth: worth.total, worth };
        }),
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
        diceRoll: room.diceRoll,
        hasRolled: room.hasRolled,
        doublesCount: room.doublesCount,
        pendingAction: room.pendingAction,
        pendingCard: room.pendingCard,
        // The exchange, in two pieces: who holds what, and what a share costs.
        // The price is derived from the board and never moves, but working it
        // out twice — once here and once in the client — is how the two come
        // to disagree.
        // Each with what taking it back costs right now — null once it is held
        // for good — so the button and the server cannot disagree on a price.
        shares: (room.shares || []).map((sh) => ({ ...sh, laps: sh.laps || 0, buyback: buybackPrice(room, sh) })),
        sharePrices: sharePrices(room),
        shareCut: SHARE_CUT,
        sharesPerGroup: SHARES_PER_GROUP,
        buybackLadder: BUYBACK_LADDER,
        boughtBackBy: room.boughtBackBy || null,
        lastMove: room.lastMove,
        auction: room.auction,
        lastPayment: room.lastPayment,
        vacationPot: room.vacationPot,
        bidSteps: BID_STEPS,
        // How long a fresh auction clock runs, so the countdown is drawn
        // against the length the server is actually keeping rather than a
        // second copy of the number that can fall out of step with it.
        auctionMs: AUCTION_MS,
        trades: room.trades,
        offTurnFee: OFF_TURN_FEE,
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
        connected: true,
        disconnectedAt: null,
        // Both read by the vote rules, the sweep and the client, whatever is
        // being played — out of the game is out of the game.
        bankrupt: false,
        resigned: false,
        activity: null,
        // Times the turn clock has had to step in for them, and when it last
        // did. The only grounds for a vote-kick mid-game, so this is evidence
        // rather than a statistic.
        stalls: 0,
        lastStallAt: null,
    };
    // Money, deeds, a hand of cards — whatever this game gives someone to
    // hold.
    rulesFor(room).addPlayerFields(room, player);
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

    const shape = () => `${room.settings.maxTeams}/${room.settings.maxTeamSize}`;
    const wasShaped = shape();

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
    // Changing how many sides there are, or how big they may be, re-deals them.
    // The alternative is leaving people on a letter that is no longer in play
    // and making the host find them.
    if (room.settings.teams && shape() !== wasShaped) autoAssignTeams(room);
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
    const ids = teamIdsFor(room);
    const cap = room.settings.maxTeamSize;
    if (cap && ids.length * cap < room.players.length) {
        return { error: `${ids.length} teams of ${cap} can't hold ${room.players.length} players` };
    }
    const counts = {};
    for (const p of room.players) {
        if (!p.teamId) return { error: `${p.name} is not on a team` };
        counts[p.teamId] = (counts[p.teamId] || 0) + 1;
    }
    // Sides no longer have to match. Three against two is a game people
    // deliberately set up, and refusing it only ever sent the odd player home.
    if (Object.keys(counts).length < 2) return { error: 'Need at least 2 teams' };
    const over = cap && Object.entries(counts).find(([, n]) => n > cap);
    if (over) return { error: `Team ${over[0]} is over the ${cap}-player limit` };
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
 * Teammates wear the same hue in as many shades as there are of them, so
 * `player.color` stays the single source of truth for every existing token,
 * tile marker and rail row — and a side of five is still five tokens.
 */
function recolourTeams(room) {
    if (!room.settings.teams) {
        // Back to what everyone chose for themselves — the team colours were
        // only ever on loan.
        recolourPlayers(room);
        return;
    }
    const byTeam = new Map();
    for (const p of room.players) {
        if (!p.teamId) continue;
        if (!byTeam.has(p.teamId)) byTeam.set(p.teamId, []);
        byTeam.get(p.teamId).push(p);
    }
    for (const [id, members] of byTeam) {
        const base = TEAM_COLORS[id] || TEAM_COLORS.A;
        const { h, s, l } = hexToHsl(base);
        const levels = shadeLevels(l, members.length);
        members.forEach((p, i) => {
            p.color = members.length === 1 ? base : hslToHex(h, s, levels[i]);
        });
    }
}

/** Host-only, lobby-only. Pass a null team to take someone off a team. */
/**
 * The host showing somebody the door, which only exists in the lobby.
 *
 * Once the game has started this is a vote instead: by then the table has a
 * shared stake in who is at it, and one person removing another from a game in
 * progress is the thing the vote rules were written to stop. Here nothing has
 * happened yet, the room is the host's to set up, and the alternative is
 * abandoning a room code because a stranger wandered in.
 */
function kickPlayer(room, hostId, playerId) {
    if (room.hostId !== hostId) return { error: 'Only the host can remove someone' };
    if (room.phase !== 'waiting') return { error: 'Once the game starts it takes a vote' };
    if (playerId === hostId) return { error: 'You cannot remove yourself' };
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    return removePlayer(room, playerId, { note: `${player.name} was removed by the host` });
}

function setTeam(room, hostId, playerId, teamId) {
    if (room.hostId !== hostId) return { error: 'Only the host can pick teams' };
    if (room.phase !== 'waiting') return { error: 'Teams are locked once the game starts' };
    if (!room.settings.teams) return { error: 'Teams are off' };
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (teamId !== null && !teamIdsFor(room).includes(teamId)) return { error: 'That team is not in play' };
    // The only cap on a side is the one the host set. Left at zero there isn't
    // one, because a rule that stops five friends playing two against three was
    // never protecting them from anything.
    const cap = room.settings.maxTeamSize;
    if (cap && teamId && room.players.filter((p) => p.teamId === teamId && p.id !== playerId).length >= cap) {
        return { error: `Team ${teamId} is full — ${cap} players` };
    }
    player.teamId = teamId;
    recolourTeams(room);
    return {};
}

/** Fill the teams top to bottom in seating order — the host can then swap. */
/**
 * Deal everyone into pairs, which is what most tables mean by teams — and into
 * bigger sides only once there are more players than the hues can pair off, so
 * a full room lands on a sensible split instead of an unassigned tail. It is a
 * starting point in the lobby, not a rule: the host moves people afterwards.
 */
function autoAssignTeams(room) {
    const ids = teamIdsFor(room);
    const cap = room.settings.maxTeamSize || Infinity;
    const per = Math.min(cap, Math.max(TEAM_PAIR, Math.ceil(room.players.length / ids.length)));
    room.players.forEach((p, i) => {
        p.teamId = room.settings.teams ? ids[Math.floor(i / per)] || null : null;
    });
    recolourTeams(room);
}

function startGame(room, playerId) {
    const rules = rulesFor(room);
    if (room.hostId !== playerId) return { error: 'Only the host can start' };
    if (room.phase !== 'waiting') return { error: 'Already started' };
    if (room.players.length < rules.minPlayers) {
        return { error: `Need at least ${rules.minPlayers} players` };
    }
    if (room.settings.teams && rules.supportsTeams) {
        const ready = teamsReady(room);
        if (ready.error) return ready;
        interleaveTeams(room);
    }
    room.turnIndex = 0;
    room.stats.startedAt = Date.now();
    // Dealing, or setting the board out: the game says what starting means,
    // including which phase it starts in.
    const started = rules.startGame(room);
    if (started?.error) return started;
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
    }, player.cash + shareValue(room, player));
}

/**
 * What a player's shares are worth. The bank buys them back at what they cost,
 * so this is money they can actually reach — which is why it counts in the
 * test for whether a debt can be covered, not just in the ranking.
 */
function shareValue(room, player) {
    return sharesOf(room, player.id).reduce((sum, sh) => sum + sh.paid, 0);
}

/**
 * Bill a player. Anything they can't cover in cash becomes a debt they have to
 * clear themselves, by selling buildings or property — the game does not
 * liquidate the estate on their behalf while they are there to choose. Their
 * turn is blocked until it's settled, and bankruptcy only follows when the
 * whole estate provably falls short. The exception is a turn the clock plays
 * for someone who has gone, which sells for them: see sellToCover.
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
    // The whole side is counted, not just the one who will be asked: with three
    // or four of them the money that saves the debtor may be sitting with
    // somebody else, and a side only goes down when none of it is enough.
    const side = [player, ...teammates(room, player).filter((q) => !q.bankrupt)];
    if (side.reduce((sum, q) => sum + liquidValue(room, q), 0) < owed) {
        log(room, `Team ${player.teamId} together can't cover $${owed}`);
        for (const q of side) goBankrupt(room, q);
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
 * Raise the money a debt needs, on behalf of somebody who is not there to.
 *
 * Only ever for a turn the clock is playing. A debt used to stop the turn clock
 * dead — "nobody else's decision to make" — which in practice meant a player
 * who walked away owing money froze the whole table until someone voted them
 * out. Now the clock sells for them, in the order that costs them least:
 *
 *   1. shares, which the bank buys back at exactly what they cost
 *   2. deeds that are not part of a set, cheapest first — no money lost, and
 *      no rent a set would have doubled
 *   3. buildings, evenly, which lose half their cost but keep the sets
 *   4. whatever deeds are left, cheapest first
 *
 * Stops the moment the debt is clear. Each sale writes its own line to the
 * feed, the same line it would if they had tapped it themselves.
 */
function sellToCover(room, player) {
    if (!player.debt) return;
    const deeds = () =>
        player.properties
            .map((id) => room.tiles[id])
            .filter(Boolean)
            .sort((a, b) => market.priceOf(room, a) - market.priceOf(room, b));
    const inSet = (t) => !!t.groupId && ownsFullGroup(room, player.id, t.groupId);

    // Said once per sale that can happen, not on every tick of a clock that
    // keeps coming round to somebody with nothing left.
    if (!player.properties.length && !sharesOf(room, player.id).length) return;
    log(room, `${player.name} is away and owes $${player.debt.amount} — selling to cover it`);

    for (const sh of sharesOf(room, player.id).slice()) {
        if (!player.debt) return;
        sellShare(room, player.id, sh.groupId);
    }
    for (const tile of deeds().filter((t) => t.houses === 0 && !inSet(t))) {
        if (!player.debt) return;
        sellProperty(room, player.id, tile.id);
    }
    // One building at a time off whichever tile has the most, which is always
    // a sale the even-building rule allows.
    for (let guard = 0; player.debt && guard < 200; guard++) {
        const built = deeds()
            .filter((t) => t.houses > 0)
            .sort((a, b) => b.houses - a.houses)[0];
        if (!built || sellHouse(room, player.id, built.id).error) break;
    }
    for (const tile of deeds().filter((t) => t.houses === 0)) {
        if (!player.debt) return;
        sellProperty(room, player.id, tile.id);
    }
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
    // Shares go back to the bank with everything else, and are on sale again
    // the next time somebody lands on an exchange.
    const held = sharesOf(room, player.id).length;
    if (held) room.shares = room.shares.filter((sh) => sh.holderId !== player.id);
    log(room, `${player.name} went bankrupt — ${estate.length} properties returned to the bank`);
    dropTradesFor(room, player.id);
    // Nothing left to decide about someone already out — and a countdown left
    // pointing at them would block every other vote for two minutes.
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
        const paid = room.settings.passStartBonus + boonsOf(room, player).startBonus;
        player.cash += paid;
        log(room, `${player.name} passed Start (+$${paid})`);
        // A lap on every stake they hold: the buy-back window is measured in
        // the shareholder's laps, and closes for good at the end of the ladder.
        for (const sh of sharesOf(room, player.id)) {
            sh.laps = (sh.laps || 0) + 1;
            if (sh.laps === BUYBACK_LADDER.length) {
                log(room, `${player.name}'s share in ${groupName(room, sh.groupId)} can no longer be bought back`);
            }
        }
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
    if (tile.type === 'landmark') {
        // Free, and not a race anybody loses: the second visitor gets the same
        // as the first. Only the second visit by the same person is nothing.
        if (!player.landmarks.includes(tile.id)) {
            player.landmarks.push(tile.id);
            log(room, `${player.name} reached ${tile.name} — ${landmarkBlurb(tile)}`);
        }
        return;
    }
    if (tile.type === 'exchange') {
        // Nothing is forced here: the screen opens, and skipping it is a
        // button. Landing is only the gate — shares can't be bought from the
        // sofa, or the mechanic stops being about the board.
        room.pendingAction = { type: 'exchange', playerId: player.id, tileId: tile.id };
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
    // A landmark's discount comes off before anyone is charged, so the payer
    // pays less and the owner and any shareholders divide what is left — the
    // discount is the payer's, not something the landlord subsidises twice.
    const off = boonsOf(room, player).rentOff;
    const rent = Math.round(rentFor(room, tile, owner, dice) * (1 - off / 100));
    payRent(room, player, owner, tile, rent);
}

/**
 * Rent, and then the shareholders' cut of it.
 *
 * Two steps rather than three payments, because the payer may not have the
 * money: they are charged once, in full, and whatever actually reached the
 * owner is what gets divided. A shareholder's quarter of a rent half-paid is a
 * quarter of what was paid, not a claim on the rest.
 *
 * A share the owner holds themselves pays nothing — it would be their own
 * money going round in a circle. It is still worth owning, because it is one
 * of the two, and the other person can't have it.
 */
function payRent(room, payer, owner, tile, rent) {
    const before = owner.cash;
    transfer(room, payer, owner, rent, `rent on ${tile.name}`);
    const got = owner.cash - before;
    if (got <= 0 || !tile.groupId) return;
    for (const sh of sharesIn(room, tile.groupId)) {
        if (sh.holderId === owner.id) continue;
        const holder = findPlayer(room, sh.holderId);
        if (!holder || holder.bankrupt) continue;
        const cut = Math.round(got * SHARE_CUT);
        if (cut > 0) transfer(room, owner, holder, cut, `${Math.round(SHARE_CUT * 100)}% share in ${groupName(room, tile.groupId)}`);
    }
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
    room.boughtBackBy = null;

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
    // Paused is stopped: no clock runs until it resumes, and resuming arms one.
    if (room.phase === 'waiting' || room.phase === 'ended' || !player || room.paused) {
        room.idle = null;
        return;
    }
    // The turn timer is a rule about how long a *person* may take, so a table
    // that switched it off still gets an absent player's turn played for them.
    // That isn't the rule being enforced — it's the game not stopping dead for
    // someone who has closed the tab.
    if (player.connected && !room.settings.turnTimer) {
        room.idle = null;
        return;
    }
    // Nobody left to unblock. Playing turns into an empty room is the server
    // talking to itself: it changes nothing anyone can see, and it makes an
    // abandoned table look busy to everything that watches for one.
    if (!room.players.some((p) => p.connected)) {
        room.idle = null;
        return;
    }
    // The grace floor wins outright rather than being capped at IDLE_MS. It is
    // the promise that a refresh mid-turn costs nothing, and a table running a
    // deliberately short turn clock is not a reason to break it.
    const away = Math.max(Date.now() + AWAY_MS, (player.disconnectedAt || 0) + AWAY_GRACE_MS);
    room.idle = { playerId: player.id, endsAt: player.connected ? Date.now() + IDLE_MS : away };
}

/**
 * Their connection changed, so the clock they're on has to change with it —
 * dropping mid-turn shortens it, coming back gives the full window again.
 * Guarded on being the current player: re-arming for anyone else would hand
 * whoever is actually up a fresh minute every time someone's wifi blinked.
 */
function refreshIdle(room, playerId) {
    // The second case is the room coming back to life: a turn in progress with
    // no clock on it is what an absent player's turn looks like while there was
    // nobody there to wait for them. Whoever just arrived is that somebody.
    if (!isCurrent(room, playerId) && room.idle) return;
    armIdle(room);
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
    // A clock armed just before a pause can still come due during one. Nobody
    // can move, so nobody stalled — and resuming arms a fresh clock.
    if (room.paused) return {};
    if (!player || !isCurrent(room, player.id)) {
        armIdle(room);
        return {};
    }

    // Counted before the debt check, not after. A turn nobody else can play is
    // the longest anyone waits, and it's the one case where the clock runs out
    // over and over with nothing to show for it — so if the record of who is
    // holding the game up skipped it, it would miss the worst offender.
    player.stalls = (player.stalls || 0) + 1;
    player.lastStallAt = Date.now();
    const rules = rulesFor(room);
    // A game may have states it will not play through on somebody's behalf —
    // on the board, only a teammate's pending answer to a bailout. (A debt
    // alone used to be one; it is sold down instead now.)
    if (rules.blocksIdle(room, player)) {
        armIdle(room);
        return {};
    }

    log(room, `${player.name} was away — their turn was played for them`);
    rules.playIdleTurn(room, player);
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
    if (room.settings.auction) startAuction(room, tileId, playerId);
    return {};
}

/* ---------------------------------------------------------------- auctions */

/**
 * Anyone still in the game with cash to spare can bid — except, sometimes, the
 * player who put it up.
 *
 * `declinedBy` is the player who chose not to buy it. Turning a tile down and
 * then winning it at auction for less than the asking price was the cheapest
 * way to buy anything on the board, and it made the price on the deed a
 * suggestion. So a tile you declined is a tile you have declined: you can watch
 * somebody else take it.
 *
 * Landing on something you cannot afford is not that. Nobody chose anything
 * there, and the auction happens whether you like it or not — so if the money
 * turns up, from rent or a sale while the clock runs, that bid is allowed.
 */
function startAuction(room, tileId, declinedBy = null) {
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
        // Whoever turned it down, if anyone did. Sent to the client as part of
        // the auction so the panel can say why the buttons are missing rather
        // than refusing the bid after it is pressed.
        barredId: declinedBy,
        endsAt: Date.now() + AUCTION_MS,
    };
    const decliner = declinedBy && findPlayer(room, declinedBy);
    log(
        room,
        decliner
            ? `${tile.name} goes to auction (from $${opening}) — ${decliner.name} passed and cannot bid`
            : `${tile.name} goes to auction (from $${opening})`,
    );
}

function placeBid(room, playerId, amount) {
    const auction = room.auction;
    if (!auction) return { error: 'No auction running' };
    if (room.paused) return { error: 'Game is paused' };
    const player = findPlayer(room, playerId);
    if (!player || player.bankrupt) return { error: 'You are out of the game' };
    if (player.debt) return { error: DEBT_BLOCKED };
    // You turned it down. The bar covers the whole side, or with teams on it
    // would be one player declining and their partner buying it cheap, which is
    // the same trick with an extra step.
    if (auction.barredId && sameSide(room, auction.barredId, playerId)) {
        return {
            error:
                auction.barredId === playerId
                    ? 'You sent this to auction — you cannot bid on it'
                    : 'Your side sent this to auction',
        };
    }

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
    if (room.boughtBackBy === playerId) return { error: 'You bought a share back this turn — build next turn' };
    if (!canBuild(room, player, tile)) return { error: 'Cannot build there' };
    player.cash -= tile.houseCost;
    tile.houses += 1;
    log(room, `${player.name} built on ${tile.name} (${tile.houses === 5 ? 'hotel' : `${tile.houses} house${tile.houses > 1 ? 's' : ''}`})`);
    return {};
}

/** "3 houses" / "a hotel", for the one line these leave in the feed. */
function levelWords(level) {
    if (level >= 5) return 'a hotel each';
    if (level === 1) return 'a house each';
    return `${level} houses each`;
}

/**
 * Take a whole country to a level in one action.
 *
 * Building was one house, on one tile, through that tile's own card: a set of
 * three to hotels is fifteen trips through a modal, in an order even building
 * dictates anyway, and fifteen lines in the feed. The table can see what it
 * costs; making them click it out house by house was never the interesting
 * part.
 *
 * So the same rules run in a loop here instead. It always builds on the tile
 * with the fewest, which is exactly what even building demands, and stops the
 * moment `canBuild` says no — out of cash, at the level asked for, or at a
 * hotel. Stopping short is a result, not an error: taking a country as far as
 * the money goes is a thing people mean to do.
 */
function buildSetTo(room, playerId, groupId, level) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    if (!isCurrent(room, playerId)) return { error: 'You can only build on your own turn' };
    if (player.debt) return { error: DEBT_BLOCKED };
    if (room.boughtBackBy === playerId) return { error: 'You bought a share back this turn — build next turn' };
    if (!ownsFullGroup(room, playerId, groupId)) return { error: 'You do not hold that country' };

    const want = Math.max(1, Math.min(Math.round(Number(level) || 0), 5));
    const tiles = groupTiles(room, groupId);
    let built = 0;
    // A bound rather than a `while (true)`: five levels across the set is every
    // house there could be to add, so a rule that stopped saying no could never
    // spin here.
    for (let i = 0; i < tiles.length * 5; i++) {
        const next = tiles
            .filter((t) => t.houses < want)
            .sort((a, b) => a.houses - b.houses || a.id - b.id)[0];
        if (!next || !canBuild(room, player, next)) break;
        player.cash -= next.houseCost;
        next.houses += 1;
        built++;
    }
    if (!built) {
        const already = tiles.every((t) => t.houses >= want);
        return { error: already ? 'Already built that far' : 'Not enough cash to build there' };
    }

    // One line for the lot. Where it actually got to, not where it was aimed:
    // "up to 3 houses each" when the money ran out at two would be a lie in the
    // one place the table trusts.
    const reached = Math.min(...tiles.map((t) => t.houses));
    const even = tiles.every((t) => t.houses === reached);
    const name = room.board?.groups?.[groupId]?.name || 'their set';
    log(
        room,
        even
            ? `${player.name} built ${name} up to ${levelWords(reached)}`
            : `${player.name} built ${built} house${built > 1 ? 's' : ''} in ${name}`,
    );
    return {};
}

/**
 * The way back down: sell a country to a level.
 *
 * Not turn-gated, and allowed while in debt, for the same reason selling one
 * building isn't — rent lands on you during somebody else's turn, and this is
 * how it gets paid. Only the owner's own deeds are sold, so a teammate cannot
 * strip a set to raise their own cash.
 */
function sellSetTo(room, playerId, groupId, level) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    const want = Math.max(0, Math.min(Math.round(Number(level) || 0), 5));
    const tiles = groupTiles(room, groupId).filter((t) => t.ownerId === playerId);
    if (!tiles.length) return { error: 'Nothing of yours there' };

    let sold = 0;
    let raised = 0;
    for (let i = 0; i < tiles.length * 5; i++) {
        // Off the most-built first, which is what even selling demands.
        const next = tiles
            .filter((t) => t.houses > want)
            .sort((a, b) => b.houses - a.houses || a.id - b.id)[0];
        if (!next) break;
        if (room.settings.evenBuild) {
            const max = Math.max(...groupTiles(room, groupId).map((t) => t.houses));
            if (next.houses !== max) break;
        }
        next.houses -= 1;
        raised += Math.floor(next.houseCost / 2);
        sold++;
    }
    if (!sold) return { error: 'Nothing to sell there' };

    player.cash += raised;
    const name = room.board?.groups?.[groupId]?.name || 'their set';
    log(room, `${player.name} sold ${sold} building${sold > 1 ? 's' : ''} in ${name} for $${raised}`);
    // Last, so a debt cleared by the sale is settled with the money in hand.
    payDownDebt(room, player);
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
/** What a landmark gives, in the words the feed and the client both use. */
function landmarkBlurb(tile) {
    const boon = tile.boon || {};
    if (boon.startBonus) return `+$${boon.startBonus} every time they pass Start`;
    if (boon.rentOff) return `${boon.rentOff}% off every rent they pay`;
    return 'nothing at all';
}

/** A country's name, for the log — the id is a slug nobody says out loud. */
const groupName = (room, groupId) => groupsOf(room)[groupId]?.name || groupId;

/**
 * Buy a share, off the back of landing on an exchange. Any country, including
 * one nobody owns yet and one you own yourself.
 */
function buyShare(room, playerId, groupId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    const action = room.pendingAction;
    if (action?.type !== 'exchange' || action.playerId !== playerId) {
        return { error: 'You are not at the exchange' };
    }
    if (!groupsOf(room)[groupId]) return { error: 'No such country' };
    if (sharesIn(room, groupId).length >= SHARES_PER_GROUP) {
        return { error: `${groupName(room, groupId)} has no shares left` };
    }
    if (sharesIn(room, groupId).some((sh) => sh.holderId === playerId)) {
        return { error: `You already hold a share in ${groupName(room, groupId)}` };
    }
    const price = sharePrice(room, groupId);
    if (player.cash < price) return { error: `A share in ${groupName(room, groupId)} costs $${price}` };

    player.cash -= price;
    room.shares.push({ groupId, holderId: playerId, paid: price, laps: 0 });
    room.pendingAction = null;
    log(room, `${player.name} bought a ${Math.round(SHARE_CUT * 100)}% share in ${groupName(room, groupId)} for $${price}`);
    return {};
}

/** Walk away from the exchange without buying. */
function leaveExchange(room, playerId) {
    const action = room.pendingAction;
    if (action?.type !== 'exchange' || action.playerId !== playerId) {
        return { error: 'You are not at the exchange' };
    }
    room.pendingAction = null;
    return {};
}

/**
 * Sell a share back to the bank, at what it cost. The same price rather than
 * half of it, because deeds sell back at their price too — and because this
 * is the way out of a debt, which is no use to anyone at a discount.
 */
function sellShare(room, playerId, groupId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    const share = sharesOf(room, playerId).find((sh) => sh.groupId === groupId);
    if (!share) return { error: 'You do not hold that share' };

    room.shares = room.shares.filter((sh) => sh !== share);
    player.cash += share.paid;
    log(room, `${player.name} sold their share in ${groupName(room, groupId)} back for $${share.paid}`);
    payDownDebt(room, player);
    return {};
}

/**
 * Take a share back off whoever holds it. Open to anyone holding a deed in the
 * country — not only whoever holds all of them, since most countries are split.
 *
 * Not the shareholder's decision. They are not being robbed: they are bought
 * out at a premium on what the stake is worth today, and the longer they have
 * held it the bigger the premium, until it cannot be taken at all.
 *
 * And not free in time, either. It is done on your own turn, once, and it is
 * that turn's building: the owner of a developed country chooses between
 * adding a hotel and shaking off a stake, rather than doing both between rolls.
 */
function buyBackShare(room, playerId, groupId, holderId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    if (!groupTiles(room, groupId).some((t) => sameSide(room, t.ownerId, playerId))) {
        return { error: `You hold no deeds in ${groupName(room, groupId)}` };
    }
    if (!isCurrent(room, playerId)) return { error: 'You can only buy a share back on your own turn' };
    if (player.debt) return { error: DEBT_BLOCKED };
    if (room.boughtBackBy === playerId) return { error: 'One buy-back a turn' };

    const theirs = sharesIn(room, groupId).filter(
        (sh) => sh.holderId !== playerId && (!holderId || sh.holderId === holderId),
    );
    if (!theirs.length) return { error: 'Nothing to buy back' };
    const open = theirs.filter((sh) => buybackPrice(room, sh) !== null);
    if (!open.length) return { error: `That share in ${groupName(room, groupId)} is held for good` };
    // Asked for nobody in particular: the cheapest one open.
    const share = open.sort((a, b) => buybackPrice(room, a) - buybackPrice(room, b))[0];
    const price = buybackPrice(room, share);
    if (player.cash < price) return { error: `Buying that share back costs $${price}` };

    const holder = findPlayer(room, share.holderId);
    player.cash -= price;
    credit(room, holder, price);
    room.shares = room.shares.filter((sh) => sh !== share);
    room.boughtBackBy = playerId;
    log(room, `${player.name} bought back ${holder ? holder.name + "'s" : 'a'} share in ${groupName(room, groupId)} for $${price}`);
    return {};
}

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
    // A share is a stake, and a stake is a thing you own — so it moves the way
    // a deed does. It goes across at whatever it cost, because `paid` is what
    // the bank buys it back at and what a buy-back is priced from: the
    // certificate carries its own history rather than being repriced by
    // whoever is holding it today.
    const shares = (side?.shares || []).filter((groupId) =>
        sharesOf(room, player.id).some((sh) => sh.groupId === groupId),
    );
    return { cash, tiles: [...new Set(tiles)], shares: [...new Set(shares)] };
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
    if (
        !giveSide.cash && !getSide.cash &&
        !giveSide.tiles.length && !getSide.tiles.length &&
        !giveSide.shares.length && !getSide.shares.length
    ) {
        return { error: 'Empty trade' };
    }
    // Nobody holds two stakes in one country — that is the rule at the
    // exchange, and a trade is not the way around it. Checked here so the
    // offer is refused while it is being written rather than at the moment it
    // is accepted, when the person refused did nothing wrong.
    const doubled = (side, receiver) =>
        side.shares.find((groupId) => sharesOf(room, receiver.id).some((sh) => sh.groupId === groupId));
    const clash = doubled(giveSide, to) || doubled(getSide, from);
    if (clash) {
        return { error: `Somebody already holds a share in ${groupName(room, clash)}` };
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

    // Re-validate: ownership and cash may have changed since the offer. A
    // share can have been sold back, or bought back off them, in the meantime
    // — and either side may have acquired one in a country the offer moves.
    const holds = (player, groupId) => sharesOf(room, player.id).some((sh) => sh.groupId === groupId);
    const sideOk = (side, owner, receiver) =>
        side.tiles.every((id) => room.tiles[id].ownerId === owner.id) &&
        owner.cash >= side.cash &&
        (side.shares || []).every((g) => holds(owner, g) && !holds(receiver, g));
    const giveOk = sideOk(trade.give, from, to);
    const getOk = sideOk(trade.get, to, from);
    if (!giveOk || !getOk) {
        dropTrade(room, tradeId);
        return { error: 'That trade is no longer valid' };
    }

    const moveTile = (id, owner, receiver) => {
        room.tiles[id].ownerId = receiver.id;
        owner.properties = owner.properties.filter((t) => t !== id);
        receiver.properties.push(id);
    };
    const moveShare = (groupId, owner, receiver) => {
        const share = sharesOf(room, owner.id).find((sh) => sh.groupId === groupId);
        if (share) share.holderId = receiver.id;
    };
    trade.give.tiles.forEach((id) => moveTile(id, from, to));
    trade.get.tiles.forEach((id) => moveTile(id, to, from));
    // An offer written before shares could be traded has no shares side.
    (trade.give.shares || []).forEach((g) => moveShare(g, from, to));
    (trade.get.shares || []).forEach((g) => moveShare(g, to, from));
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

/**
 * When this game becomes old enough for anyone to be voted out. Null in the
 * lobby, where there are no turns to have taken too long over and a seat is
 * all anyone stands to lose.
 */
function voteOpensAt(room) {
    if (room.phase === 'waiting' || !room.stats.startedAt) return null;
    return room.stats.startedAt + VOTE_OPEN_MS;
}

function startVoteKick(room, byId, targetId) {
    if (room.phase === 'ended') return { error: 'Game is over' };
    if (room.vote) return { error: 'A vote is already running' };
    const by = findPlayer(room, byId);
    const target = findPlayer(room, targetId);
    if (!by || !target) return { error: 'Unknown player' };
    if (by.id === target.id) return { error: 'You cannot vote yourself out' };
    // Somebody gone from a paused game is somebody the pause is waiting for.
    if (room.paused) return { error: 'The game is paused — votes wait until it resumes' };
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
    // The one other rule a ballot has: not in the first minutes of a game, when
    // a vote is usually someone reacting to a bad opening roll. It does not
    // apply to the countdown, which is the room's only way of shedding somebody
    // who has gone for good.
    //
    // Everything else that used to stand here — a vote only on someone the turn
    // clock had played for, and cooldowns on voting the same person or calling
    // twice — is gone. In practice they mostly stopped a table removing
    // somebody it plainly wanted gone, and the majority a ballot needs is still
    // the thing that decides.
    if (!abandoned) {
        const opens = voteOpensAt(room);
        if (opens && Date.now() < opens) {
            return { error: `Too early — kicking opens ${Math.ceil((opens - Date.now()) / 60_000)} min into the game` };
        }
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

/** Names for a list of ids, for a log line that has to name people. */
const nameList = (room, ids) =>
    ids
        .map((id) => findPlayer(room, id)?.name)
        .filter(Boolean)
        .join(', ');

function finishVote(room, passed) {
    const vote = room.vote;
    if (!vote) return { error: 'No vote running' };
    room.vote = null;
    const target = findPlayer(room, vote.targetId);
    if (!target) return {};

    const abandoned = vote.mode === 'abandon';
    // Who voted which way, on the record. A kick among friends is a social act,
    // and the strongest thing keeping it honest is that everyone can see who
    // did it — the tally on its own let four people do this anonymously.
    const tally = [
        vote.yes.length ? `yes: ${nameList(room, vote.yes)}` : null,
        vote.no.length ? `no: ${nameList(room, vote.no)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    if (!passed) {
        log(
            room,
            abandoned
                ? `${target.name} came back in time`
                : `The vote to kick ${target.name} failed (${vote.yes.length}/${vote.needed}) — ${tally}`,
        );
        return {};
    }

    return ejectPlayer(
        room,
        target,
        abandoned
            ? `${target.name} never came back and is out`
            : `${target.name} was voted out (${vote.yes.length}/${vote.needed}) — ${tally}`,
    );
}

/**
 * Out, and staying out — in whatever phase the room is in.
 *
 * The one exit for everyone removed against their will: a vote that passed, and
 * the site's admin. Two paths would be two chances for one of them to forget
 * the ban, or to leave a kicked player's estate with a friend.
 */
function ejectPlayer(room, target, note) {
    // Banned, not merely removed — otherwise they reconnect two seconds later
    // and the removal meant nothing.
    banFromRoom(room, target);
    log(room, note);

    if (room.phase === 'waiting') {
        removePlayer(room, target.id, { note: null, quiet: true });
        return {};
    }
    // Mid-game it's the same exit as resigning: whatever they were holding
    // goes back where it came from, so being kicked can't become a way to hand
    // a friend your property.
    target.resigned = true;
    dropVoteFor(room, target.id);
    rulesFor(room).removeFromPlay(room, target);
    return {};
}

/**
 * The site's admin removing someone, from outside the room.
 *
 * No host check, no phase check and no vote: this is for the case the in-game
 * tools cannot reach — somebody harassing a table, or a room nobody left can
 * finish. It says so in the feed, because a player vanishing mid-game with no
 * explanation looks like a bug to everyone still sitting there.
 */
function adminKick(room, playerId) {
    const target = findPlayer(room, playerId);
    if (!target) return { error: 'Unknown player' };
    if (target.resigned || target.bankrupt || target.out) {
        // Already out of play; still banned, so they cannot come back to watch
        // and carry on whatever got them removed.
        banFromRoom(room, target);
        return {};
    }
    return ejectPlayer(room, target, `${target.name} was removed by an admin`);
}

/**
 * The ban list, with a name kept beside each id.
 *
 * A player kicked from the lobby is gone from `players` entirely, and a list of
 * bare ids is no use to anyone deciding whom to let back in.
 */
function banFromRoom(room, target) {
    if (!room.banned.includes(target.id)) room.banned.push(target.id);
    room.banNames = room.banNames || {};
    room.banNames[target.id] = target.name;
}

/* ------------------------------------------------- the admin's other tools */

// For a game that is stuck rather than a player who is the problem: each of
// these saves a room that would otherwise have to be ended. All of them say so
// in the feed — a game that pauses itself, or a turn that plays without anyone
// touching it, reads as a bug unless the table is told who did it.

function adminPause(room, paused) {
    if (room.phase === 'waiting' || room.phase === 'ended') return { error: 'The game is not running' };
    if (!!room.paused === !!paused) return { error: paused ? 'Already paused' : 'Not paused' };
    setPaused(room, !!paused, null);
    log(room, paused ? 'An admin paused the game' : 'An admin resumed the game');
    return {};
}

/**
 * Stop the game's clocks, or start them again.
 *
 * A pause has to hold for as long as it takes everyone to come back, and a
 * pause is usually taken because they are leaving. So everything that acts on
 * a table on its own stops with it: the turn clock, which would otherwise count
 * a stall against a player who cannot move and fill the feed with turns it did
 * not play; skipping the turn of whoever disconnected; and a countdown to
 * remove somebody who has gone, which would throw out the very people the pause
 * is waiting for.
 */
function setPaused(room, paused, byId) {
    room.paused = paused;
    room.pausedBy = paused ? byId : null;
    room.pausedAt = paused ? Date.now() : null;
    if (paused) {
        room.idle = null;
        if (room.vote) {
            const target = findPlayer(room, room.vote.targetId);
            room.vote = null;
            log(room, `The vote on ${target?.name || 'a player'} was called off — the game is paused`);
        }
    } else {
        // A fresh clock for whoever is up. If they are still away, armIdle
        // gives them the short one, and the game carries on without them.
        armIdle(room);
        // And fresh windows for the sweep. Everyone was gone and nothing was
        // sent for the whole pause, which by now is well past both — so a
        // resume a minute before the table sits back down would otherwise have
        // the room closed out from under them on the next sweep.
        room.emptySince = null;
        room.lastActionAt = Date.now();
    }
}

/**
 * Play the current turn the way the turn clock would — the passive option at
 * every step, and never a decision made on somebody's behalf.
 *
 * Deliberately not a bare skip. Advancing the seat by hand can leave a card
 * game halfway through naming a suit, or a board with a purchase still on
 * screen; the idle turn is the path already written and tested to leave
 * neither.
 */
function adminPlayTurn(room) {
    if (room.phase === 'waiting' || room.phase === 'ended') return { error: 'The game is not running' };
    if (room.paused) return { error: 'Resume the game first' };
    if (room.auction) return { error: 'An auction is running — finish it first' };
    const player = room.players[room.turnIndex];
    if (!player) return { error: 'Nobody is up' };
    const rules = rulesFor(room);
    if (rules.blocksIdle(room, player)) {
        return { error: `${player.name}'s teammate has been asked to cover their debt — that answer is theirs` };
    }
    log(room, `An admin played ${player.name}'s turn for them`);
    rules.playIdleTurn(room, player);
    return {};
}

/** End whatever the game is counting down to — on the board, an auction. */
function adminFinishDeadline(room) {
    const timer = rulesFor(room).timer(room);
    if (!timer) return { error: 'Nothing is counting down' };
    log(room, room.auction ? 'An admin closed the auction' : 'An admin ended the countdown');
    timer.resolve(room);
    return {};
}

/**
 * End a game where it stands and give the table its end screen.
 *
 * The other way to end one — closing the room — sends everyone home with
 * nothing, which is right for a game that should never have happened and wrong
 * for one that just ran out of evening: the end screen is what saves a game to
 * everyone's history. The winner is whoever the game says was ahead.
 */
function adminEndGame(room) {
    if (room.phase === 'waiting' || room.phase === 'ended') return { error: 'The game is not running' };
    // Nothing that could act on the table after it has ended.
    room.paused = false;
    room.pausedBy = null;
    room.pausedAt = null;
    room.vote = null;
    room.idle = null;
    const ahead = rulesFor(room).endEarly(room);
    // A game module that forgot is still an ended game, not a stuck one.
    room.phase = 'ended';
    room.stats.endedAt = room.stats.endedAt || Date.now();
    log(room, `An admin ended the game early — ${ahead}`);
    return {};
}

function adminUnban(room, playerId) {
    if (!room.banned.includes(playerId)) return { error: 'They are not banned here' };
    room.banned = room.banned.filter((id) => id !== playerId);
    const name = room.banNames?.[playerId] || 'A removed player';
    if (room.banNames) delete room.banNames[playerId];
    log(room, `An admin let ${name} back into the room`);
    return {};
}

/* ------------------------------------------------------------ misc actions */

function togglePause(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    setPaused(room, !room.paused, player.id);
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
function removePlayer(room, playerId, { note, quiet = false } = {}) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.phase !== 'waiting') {
        markDisconnected(room, playerId);
        return { kept: true };
    }

    room.players = room.players.filter((p) => p.id !== playerId);
    dropVoteFor(room, playerId);
    if (!quiet) log(room, note || `${player.name} left`);
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
    // Leaving a paused game is the point of pausing it. Their turn waits, and
    // resuming arms the clock that plays it if they are still not back.
    if (room.paused) return false;
    log(room, `${player.name} is away — turn skipped`);
    rulesFor(room).skipTurn(room, player);
    return true;
}

function resetForRematch(room) {
    room.turnIndex = 0;
    room.phase = 'waiting';
    room.paused = false;
    room.pausedBy = null;
    room.pausedAt = null;
    room.winnerId = null;
    room.winnerTeam = null;
    room.vote = null;
    room.idle = null;
    // Cooldowns are per-game grudges; the ban list is not — someone voted out
    // stays out of this room rather than reappearing for the next round.
    room.log = [];
    room.stats = { startedAt: null, endedAt: null, turnCount: 0, chatMessages: 0 };
    room.players = room.players
        .filter((p) => p.connected && !p.resigned)
        .map((p) => ({
            ...p,
            bankrupt: false,
            // Last game's slowness isn't grounds for a vote in this one.
            stalls: 0,
            lastStallAt: null,
        }));
    // The board back in its box, or the cards back in the deck.
    rulesFor(room).resetForRematch(room);
    if (room.players.length && !room.players.some((p) => p.id === room.hostId)) {
        room.hostId = room.players[0].id;
    }
    // Someone may not have come back, which can leave a team a player short.
    if (room.settings.teams && teamsReady(room).error) autoAssignTeams(room);
    log(room, 'New game — back to the lobby');
}

/* ----------------------------------------------------------- the rules seam */

/**
 * The property game, as a rules module.
 *
 * It lives in this file rather than beside rules.js because everything it
 * needs is already in scope here — `advanceTurn`, `goBankrupt`,
 * `snapshotNetWorth` and the rest are internals, and exporting a dozen of them
 * to satisfy a wrapper would widen this module's surface for no one's benefit.
 * What the seam is worth is not where the code sits; it is that engine.js no
 * longer decides what "start", "an idle turn" or "out of the game" mean.
 */
const rules = {
    id: 'nopoly',
    name: 'nopoly',
    tagline: 'Buy the board, charge the rent, outlast everyone.',
    minPlayers: 2,
    supportsTeams: true,

    /** The half of a room that is a property game. */
    createRoom(room, { boardId } = {}) {
        const board = getBoard(boardId ?? DEFAULT_BOARD);
        room.board = board;
        room.tiles = makeTiles(board);
        room.decks = makeDecks(board);
        room.diceRoll = [0, 0];
        // transient turn state
        room.doublesCount = 0;
        room.hasRolled = false;
        room.pendingAction = null; // { type: 'buy' | 'exchange', playerId, tileId }
        room.shares = [];          // [{ groupId, holderId, paid, laps }]
        room.boughtBackBy = null;  // who has spent this turn's build on a buy-back
        room.pendingCard = null;   // { deck, text, playerId }
        room.lastMove = null;      // { playerId, from, to, passedStart, seq }
        room.moveSeq = 0;
        room.trades = [];
        room.auction = null;       // { tileId, bid, bidderId, endsAt }
        room.lastPayment = null;   // { seq, fromId, toId, amount, reason }
        room.paySeq = 0;
        room.vacationPot = 0;      // taxes and fines waiting on Vacation
        Object.assign(room.stats, {
            doubles: 0,
            trades: 0,
            visits: {},          // tileId -> count
            jailVisits: {},      // playerId -> count
            netWorth: [],        // [{ turn, values: { playerId: net } }]
        });
    },

    /** What a player holds here: money, deeds, and a debt they may owe on it. */
    addPlayerFields(room, player) {
        player.cash = room.settings.startingCash;
        player.position = 0;
        player.properties = [];
        player.inJail = false;
        player.jailTurns = 0;
        player.jailCards = 0;
        // { amount, toId } while they owe more than they held in cash. Blocks
        // their turn until they've sold enough to clear it.
        player.debt = null;
        // Landmarks stood on, by tile id. Kept as ids rather than as totals so
        // the client can say which ones, and so landing twice is free.
        player.landmarks = [];
    },

    startGame(room) {
        room.phase = 'rolling';
        room.hasRolled = false;
        snapshotNetWorth(room);
        return {};
    },

    view: (room) => nopolyView(room),

    /**
     * Nothing here is secret — the board is on the table. Null rather than a
     * function returning null, so broadcast() can skip the walk over every
     * socket in the room instead of calling this once per person to be told
     * nothing, on every action anybody takes.
     */
    privateFor: null,

    /** A debt is theirs to settle; nobody else may decide what to sell. */
    /**
     * A debt no longer blocks it — it is sold down, see sellToCover. The one
     * thing that still does is a teammate who has been asked to cover the rest:
     * that answer is theirs, and playing the turn cannot move it along.
     */
    blocksIdle: (room, player) => player.debt?.bailout === 'offered',

    playIdleTurn(room, player) {
        if (player.debt) {
            sellToCover(room, player);
            if (player.debt) {
                // A teammate has been asked to cover the rest, and that is
                // theirs to answer — the clock does not decline it for them.
                if (player.debt.bailout === 'offered') return;
                // Everything is gone and it still is not enough. Leaving them
                // in debt would freeze the table again, which is the thing
                // this is here to stop.
                log(room, `${player.name} sold everything and still couldn't cover it`);
                goBankrupt(room, player);
                if (room.auction?.bidderId === player.id) {
                    room.auction.bidderId = null;
                    room.auction.bid = 0;
                    room.auction.nextBid = room.auction.opening ?? market.MIN_OPENING_BID;
                }
                if (room.phase !== 'ended' && isCurrent(room, player.id)) endTurnAuto(room);
                return;
            }
        }
        if (room.phase === 'rolling' && !room.hasRolled) rollDice(room, player.id);
        // Whatever the roll turned up, take the passive option: don't buy, and
        // get the card off the screen. An auction may open, which everyone else
        // can still bid in.
        if (room.pendingAction?.type === 'buy' && room.pendingAction.playerId === player.id) {
            declinePurchase(room, player.id);
        }
        room.pendingCard = null;
        // A roll can end the turn on its own — jail, or going bankrupt.
        if (isCurrent(room, player.id) && room.phase !== 'ended' && !player.debt) {
            endTurn(room, player.id);
        }
    },

    skipTurn(room) {
        advanceTurn(room);
    },

    /** The estate goes back to the bank, and the table plays on without them. */
    removeFromPlay(room, player) {
        const wasCurrent = isCurrent(room, player.id);
        goBankrupt(room, player);
        if (room.auction?.bidderId === player.id) {
            room.auction.bidderId = null;
            room.auction.bid = 0;
            room.auction.nextBid = room.auction.opening ?? market.MIN_OPENING_BID;
        }
        if (room.phase !== 'ended' && wasCurrent) {
            room.pendingAction = null;
            room.pendingCard = null;
            advanceTurn(room);
        }
    },

    resetForRematch(room) {
        this.createRoom(room, { boardId: room.board?.id });
        for (const p of room.players) this.addPlayerFields(room, p);
    },

    /** The auction clock, which is the only deadline this game runs on. */
    timer: (room) =>
        room.auction ? { endsAt: room.auction.endsAt, resolve: (r) => resolveAuction(r) } : null,

    /**
     * Stop here and call it: the side worth the most wins.
     *
     * Net worth rather than cash, because it is the number the end screen
     * ranks by and the one the table has watched all game — a player sitting on
     * six hotels and $40 is not losing. By side, so with teams on it is the
     * team's total that counts, the same way a debt is judged.
     */
    endEarly(room) {
        const alive = activePlayers(room);
        const totals = new Map();
        for (const p of alive) {
            const side = sideKey(room, p.id);
            totals.set(side, (totals.get(side) || 0) + worthOf(room, p).total);
        }
        const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const winners = alive.filter((p) => sideKey(room, p.id) === best);

        // Nothing half-done survives into the end screen.
        room.auction = null;
        room.pendingAction = null;
        room.pendingCard = null;
        room.phase = 'ended';
        room.winnerId = winners[0]?.id || null;
        room.winnerTeam = room.settings.teams ? winners[0]?.teamId || null : null;
        room.stats.endedAt = Date.now();
        snapshotNetWorth(room);
        const names = winners.map((p) => p.name).join(' and ');
        return names ? `${names} ${winners.length > 1 ? 'were' : 'was'} ahead` : 'nobody was ahead';
    },

    /** Its actions are wired by name in index.js, not through the registry. */
    actions: {},
};

module.exports = {
    rules,
    PAUSED_ROOM_MS,
    adminKick,
    adminPause,
    adminPlayTurn,
    adminFinishDeadline,
    adminEndGame,
    adminUnban,
    baseState,
    // Every game writes to the same feed, so the way to write to it is part of
    // what a rules module is handed.
    log,
    PLAYER_COLORS,
    TEAM_IDS,
    TEAM_COLORS,
    TEAM_PAIR,
    JAIL_FINE,
    BID_STEPS,
    DEFAULT_SETTINGS,
    updateSettings,
    setTeam,
    kickPlayer,
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
    refreshIdle,
    noteActive,
    expireIdle,
    spectateReason,
    addSpectator,
    removeSpectator,
    isSpectator,
    sameSide,
    // Exported for the tests: landing is where the rent split happens, and
    // rolling until the dice cooperate is a slower test that fails sometimes.
    resolveLanding,
    SHARE_CUT,
    SHARES_PER_GROUP,
    sharePrice,
    worthOf,
    boonsOf,
    landmarkBlurb,
    sharesIn,
    sharesOf,
    shareValue,
    buyShare,
    leaveExchange,
    sellShare,
    buyBackShare,
    buybackPrice,
    movePlayerTo,
    BUYBACK_LADDER,
    teammate,
    teammates,
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
    buildSetTo,
    sellHouse,
    sellSetTo,
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
