// Staged rooms for the socket suites, written as a snapshot and picked up by
// the server's own restoreRooms() on boot.
//
// This is the convention the rest of the project already follows: a snapshot
// gives a deterministic mid-game position, where driving one there with dice
// does not. Rolling to reach a particular tile is a coin flip dressed up as a
// test — it passes most of the time, which is the worst thing a test can do.
//
// Built by calling the engine rather than by hand-writing JSON, so a room here
// can never drift out of the shape the engine actually produces.

const fs = require('fs');
const path = require('path');
const e = require('../game/engine');

/**
 * A running game with a guaranteed charge available on demand: Ada is in jail
 * on her own turn holding enough to buy her way out, which is the one payment a
 * socket client can trigger without waiting on the dice.
 */
function rentRoom() {
    const room = e.createRoom('RENTX');
    const ada = e.addPlayer(room, { name: 'Ada', playerId: 'pid-Ada' }).player;
    e.addPlayer(room, { name: 'Bo', playerId: 'pid-Bo' });
    // The shared test server runs a 3-second turn clock for idlewire, which
    // would otherwise play this turn before the suite has finished connecting.
    e.updateSettings(room, ada.id, { turnTimer: false });
    e.startGame(room, ada.id);

    ada.inJail = true;
    ada.position = 10;
    // Whatever the jail fine costs, with room to spare — the suite asserts on
    // the cash that actually moved rather than on a number written here.
    ada.cash = 1500;
    return room;
}

/** Write every staged room into `dir` as the snapshot the server reads at boot. */
function write(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const payload = { savedAt: Date.now(), rooms: [rentRoom()] };
    fs.writeFileSync(path.join(dir, 'rooms.json'), JSON.stringify(payload));
}

module.exports = { write, rentRoom };
