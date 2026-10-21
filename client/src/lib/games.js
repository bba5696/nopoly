/**
 * The games this site hosts, as the client talks about them.
 *
 * The server has the authoritative list — `/meta` returns it, built from the
 * rules registry — but the home screen has to draw the picker before it has
 * asked anything, and past games are read from this device's storage with no
 * server involved at all. So the names and blurbs live here, and the ids are
 * the contract with `server/game/rules.js`.
 */
export const GAMES = [
    { id: 'nopoly', name: 'nopoly', blurb: 'The board. Buy it, build it, charge rent.', minPlayers: 2 },
    {
        id: 'nouno',
        name: 'nouno',
        blurb: 'The cards. Shed your hand before anyone else.',
        minPlayers: 2,
        // Newer than the board game by a long way, and it shows. Said here
        // rather than in the screens, so the tag and the warning cannot end up
        // disagreeing about which game is the rough one.
        beta: true,
        warning:
            'nouno is still being written and still has bugs in it — turns that stick, hands that need a refresh, games worth restarting. Play it at your own risk.',
    },
    {
        id: 'notan',
        name: 'notan',
        blurb: 'The island. Settle it, trade, first to ten.',
        beta: true,
        // Three to six round one island, and the bigger island past four.
        // Short of three, the server can seat bots.
        minPlayers: 3,
        maxPlayers: 6,
        bots: true,
        warning:
            'notan is brand new. The rules are the full island game, but expect the odd rough edge — tell the host if a turn gets stuck.',
    },
];

/** What the warning says for a game, wherever it is shown. */
export const warningFor = (id) => gameOf(id).warning || '';
/** Kept for anything still importing the old single warning. */
export const BETA_WARNING = 'This game is still being written. Play it at your own risk.';

/** Anything saved before the card game existed was the board game. */
export const DEFAULT_GAME = 'nopoly';

export const gameOf = (id) => GAMES.find((g) => g.id === id) || GAMES[0];
export const gameName = (id) => gameOf(id).name;
export const isBeta = (id) => !!gameOf(id).beta;
