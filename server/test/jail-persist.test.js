// Jail staging (server half) and the room snapshot round-trip.
process.env.NOPOLY_STATE = require('path').join(__dirname, 'state-test');
const fs = require('fs');
const e = require('../game/engine');
const persist = require('../persist');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const mk = (names) => {
    const r = e.createRoom('JAIL');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    e.startGame(r, p[names[0]].id);
    return { r, p };
};
const pin = (fn) => {
    const orig = Math.random;
    Math.random = () => 0.0; // 1 + 1
    try { return fn(); } finally { Math.random = orig; }
};

/* -------------------------------------------- landing on the Go to Jail tile */
{
    const { r, p } = mk(['Ada', 'Bo']);
    const goToJail = (r.tiles.length / 4) * 3;
    p.Ada.position = goToJail - 2;
    r.turnIndex = 0;
    pin(() => e.rollDice(r, p.Ada.id));

    ok('the player ends up in jail', p.Ada.inJail, `pos=${p.Ada.position}`);
    ok('the move names the tile walked to', r.lastMove.via === goToJail,
        `via=${r.lastMove.via} expected=${goToJail}`);
    ok('and its destination is the cell', r.lastMove.to === p.Ada.position);
    ok('via differs from the destination, so the client stages it',
        r.lastMove.via !== r.lastMove.to);
    ok('the move is the newest one', r.lastMove.playerId === p.Ada.id);
}

/* --------------------------------- three doubles: nothing to walk to first */
{
    const { r, p } = mk(['Ada', 'Bo']);
    r.turnIndex = 0;
    const start = p.Ada.position;
    r.doublesCount = 2;
    pin(() => e.rollDice(r, p.Ada.id));
    ok('three doubles jails them', p.Ada.inJail);
    ok('via is where they already stood, so it snaps', r.lastMove.via === start,
        `via=${r.lastMove.via} start=${start}`);
}

/* ------------------------------------------------------ snapshot round-trip */
{
    fs.rmSync(process.env.NOPOLY_STATE, { recursive: true, force: true });
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    // Make the room worth saving: property, houses, cash, a trade, a log.
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Ada.id;
    tile.houses = 3;
    p.Ada.properties.push(tile.id);
    p.Bo.cash = 777;
    e.addChat(r, p.Cy.id, 'hello');
    e.createTrade(r, p.Ada.id, { toId: p.Bo.id, give: { cash: 50 }, get: {} });
    r.stats.turnCount = 12;

    const rooms = new Map([[r.roomCode, r]]);
    const saved = persist.save(rooms);
    ok('the snapshot writes', saved.ok && saved.count === 1, JSON.stringify(saved));
    ok('the file is really there', fs.existsSync(persist.FILE));

    const back = persist.load();
    ok('one room comes back', back.length === 1, String(back.length));
    const r2 = back[0];
    ok('the code survives', r2.roomCode === r.roomCode);
    ok('players survive', r2.players.length === 4);
    ok('cash survives', r2.players.find((q) => q.name === 'Bo').cash === 777);
    ok('ownership survives', r2.tiles[tile.id].ownerId === p.Ada.id);
    ok('buildings survive', r2.tiles[tile.id].houses === 3);
    ok('open trades survive', r2.trades.length === 1);
    ok('chat survives', r2.chat.length === 1 && r2.chat[0].text === 'hello');
    ok('turn count survives', r2.stats.turnCount === 12);
    ok('the deck survives', !!r2.decks && Object.keys(r2.decks).length > 0);

    // And the restored room is a working room, not just matching data.
    r2.turnIndex = r2.players.findIndex((q) => q.name === 'Ada');
    r2.phase = 'rolling';
    r2.hasRolled = false;
    const res = pin(() => e.rollDice(r2, r2.players[r2.turnIndex].id));
    ok('the restored room can still be played', !res.error, JSON.stringify(res));
    ok('and its state still serialises', !!e.publicState(r2).roomCode);
}

/* ------------------------------------------------------- snapshot integrity */
{
    persist.clear();
    ok('clearing removes the file', !fs.existsSync(persist.FILE));
    ok('a missing snapshot loads as empty', persist.load().length === 0);

    fs.mkdirSync(process.env.NOPOLY_STATE, { recursive: true });
    fs.writeFileSync(persist.FILE, 'not json at all');
    ok('a corrupt snapshot loads as empty rather than throwing', persist.load().length === 0);

    fs.writeFileSync(persist.FILE, JSON.stringify({ savedAt: Date.now() - 7 * 60 * 60 * 1000, rooms: [{ roomCode: 'OLD' }] }));
    ok('a stale snapshot is ignored', persist.load().length === 0);

    fs.writeFileSync(persist.FILE, JSON.stringify({ savedAt: Date.now(), rooms: [{ roomCode: 'NEW' }, null, 7] }));
    ok('junk entries are dropped', persist.load().length === 1);

    fs.rmSync(process.env.NOPOLY_STATE, { recursive: true, force: true });
    ok('saving creates its directory', persist.save(new Map()).ok);
    fs.rmSync(process.env.NOPOLY_STATE, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
