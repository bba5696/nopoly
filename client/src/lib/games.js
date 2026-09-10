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
    { id: 'nopoly', name: 'nopoly', blurb: 'The board. Buy it, build it, charge rent.' },
    { id: 'nouno', name: 'nouno', blurb: 'The cards. Shed your hand before anyone else.' },
];

/** Anything saved before the card game existed was the board game. */
export const DEFAULT_GAME = 'nopoly';

export const gameOf = (id) => GAMES.find((g) => g.id === id) || GAMES[0];
export const gameName = (id) => gameOf(id).name;
