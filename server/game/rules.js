// Which game a room is playing.
//
// nopoly's expensive half was never the property rules — it is rooms, codes,
// reconnecting into your seat, presence, chat, kick, spectating, the turn
// clock, snapshots, past games and share links. All of that is written once
// and knows nothing about what is being played. This is the seam where it
// stops knowing.
//
// A rules module owns the parts a game cannot share: what a fresh room holds,
// what a player carries, what starting means, what the clock does for someone
// who has gone quiet, what happens to a player who is removed, and which slice
// of the state the client is sent. Everything else in engine.js is common
// ground and stays there.
//
// Shaped like board.js on purpose: a registry keyed by id, a getter that falls
// back rather than throwing, and a list precomputed for the picker. Adding a
// game is adding a file and one line here.

const nopoly = require('./engine').rules;
const nouno = require('./nouno/rules');

const GAMES = {
    [nopoly.id]: nopoly,
    [nouno.id]: nouno,
};

const DEFAULT_GAME = nopoly.id;

/**
 * The rules a room is playing by.
 *
 * Falls back rather than throwing, the way `getBoard` does: a snapshot written
 * before games had ids has no `game` field, and a room from the future with an
 * id this build has never heard of should still be a room somebody can leave.
 */
const rulesFor = (room) => GAMES[room?.game] || GAMES[DEFAULT_GAME];

/** A known id, or the default — what `room:create` is allowed to have meant. */
const gameId = (id) => (GAMES[id] ? id : DEFAULT_GAME);

/** Summary of every game, for the picker on the home screen. */
const GAME_LIST = Object.values(GAMES).map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline,
    minPlayers: g.minPlayers,
    supportsTeams: !!g.supportsTeams,
}));

/**
 * Every hook a rules module has to implement. Exported so a test can hold a
 * new game to the same contract — a half-written module that silently returns
 * undefined from one of these is the kind of thing that only shows up three
 * turns into somebody's game.
 */
const HOOKS = [
    'id',
    'name',
    'tagline',
    'minPlayers',
    'createRoom',
    'addPlayerFields',
    'startGame',
    'view',
    'privateFor',
    'blocksIdle',
    'playIdleTurn',
    'skipTurn',
    'removeFromPlay',
    'resetForRematch',
    'timer',
    'endEarly',
    'actions',
];

module.exports = { GAMES, GAME_LIST, DEFAULT_GAME, HOOKS, rulesFor, gameId };
