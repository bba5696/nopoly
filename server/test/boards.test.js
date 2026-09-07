// What every board has to be true about itself.
//
// board.js derives geometry from the length of a layout, and the engine derives
// set completion from a group's declared size and airport and utility rents from
// the length of their rent tables. None of that is checked at boot, so a new
// board with one property too many in a group would only show up as a monopoly
// nobody can complete, halfway through somebody's game. Cheaper to check here.
const { BOARDS, BOARD_LIST, geometryOf, makeTiles, boardMeta } = require('../game/board');
const { CHANCE, CHEST } = require('../game/cards');
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

for (const board of Object.values(BOARDS)) {
    const id = board.id;
    const layout = board.layout;
    const { per, size } = geometryOf(board);

    ok(`${id}: four equal sides`, size % 4 === 0, String(size));
    for (const [label, index] of [
        ['start', 0],
        ['jail', per],
        ['vacation', per * 2],
        ['go to jail', per * 3],
    ]) {
        ok(`${id}: ${label} is a corner`, layout[index][1] === 'corner', layout[index][0]);
    }
    ok(
        `${id}: nothing else is`,
        layout.filter((t) => t[1] === 'corner').length === 4,
        String(layout.filter((t) => t[1] === 'corner').length),
    );

    // A group's declared size is what the engine counts a monopoly against.
    const counted = {};
    for (const t of layout) {
        if (t[1] !== 'property') continue;
        counted[t[2]] = (counted[t[2]] || 0) + 1;
    }
    ok(
        `${id}: every group is on the board`,
        Object.keys(board.groups).every((g) => counted[g]),
        Object.keys(board.groups).filter((g) => !counted[g]).join(', '),
    );
    ok(
        `${id}: every property has a group`,
        Object.keys(counted).every((g) => board.groups[g]),
        Object.keys(counted).filter((g) => !board.groups[g]).join(', '),
    );
    for (const [g, meta] of Object.entries(board.groups)) {
        ok(`${id}: ${g} declares ${meta.size}`, counted[g] === meta.size, `has ${counted[g]}`);
    }

    // The rent tables are how many of each you have to hold for the top rate.
    const airports = layout.filter((t) => t[1] === 'airport').length;
    const utilities = layout.filter((t) => t[1] === 'utility').length;
    ok(`${id}: the airport table fits the airports`, board.airportRent.length === airports, `${board.airportRent.length} vs ${airports}`);
    ok(`${id}: the utility table fits the utilities`, board.utilityMultiplier.length === utilities, `${board.utilityMultiplier.length} vs ${utilities}`);

    // A property with no rent row, or a short one, is a crash on landing.
    const badRent = layout.filter((t) => t[1] === 'property' && (!Array.isArray(t[4]) || t[4].length !== 6));
    ok(`${id}: every property has six rents`, !badRent.length, badRent.map((t) => t[0]).join(', '));
    const unpriced = layout.filter((t) => ['property', 'airport', 'utility'].includes(t[1]) && !(t[3] > 0));
    ok(`${id}: everything buyable has a price`, !unpriced.length, unpriced.map((t) => t[0]).join(', '));

    // Two tiles with the same name make a card's destination ambiguous, and the
    // decks resolve destinations by name.
    // Card and exchange squares repeat by design; everything a card can be
    // sent to has to be findable by name.
    const named = layout.filter((t) => !['chest', 'chance', 'exchange'].includes(t[1])).map((t) => t[0]);
    ok(`${id}: names are unique`, new Set(named).size === named.length, String(named.length - new Set(named).size));

    // Cards name their destinations, and a name that isn't here quietly becomes
    // Start — which is a card that does the wrong thing rather than an error.
    const missing = [...CHANCE, ...CHEST].filter(
        (c) => c.effect.kind === 'move' && !named.includes(c.effect.to),
    );
    ok(`${id}: every card destination exists`, !missing.length, missing.map((c) => c.effect.to).join(', '));

    ok(`${id}: makeTiles agrees on the length`, makeTiles(board).length === size);
    ok(`${id}: the meta carries its geometry`, boardMeta(board).grid === per + 1);
    ok(
        `${id}: the lobby lists it`,
        BOARD_LIST.some((b) => b.id === id && b.size === size),
    );
}

/* ------------------------------------------- and a game can be played on one */
{
    for (const id of Object.keys(BOARDS)) {
        const r = e.createRoom(`B${id.slice(0, 4).toUpperCase()}`);
        const ada = e.addPlayer(r, { name: 'Ada', playerId: 'pid-ada' }).player;
        e.addPlayer(r, { name: 'Bo', playerId: 'pid-bo' });
        e.updateSettings(r, ada.id, { board: id });
        const started = e.startGame(r, ada.id);
        ok(`${id}: a room starts on it`, !started.error, started.error);
        ok(`${id}: with the right ring`, r.tiles.length === BOARDS[id].layout.length);
        // Every tax tile has to name a real charge: `extra` is free-form in
        // the layout tuple, so a typo there is a tax that asks for NaN.
        const taxes = r.tiles.filter((t) => t.type === 'tax');
        ok(`${id}: it has taxes`, taxes.length > 0);
        const bad = taxes.filter((t) => !Number.isFinite(e.taxFor(r, ada, t)) || e.taxFor(r, ada, t) <= 0);
        ok(`${id}: every tax charges something`, !bad.length, bad.map((t) => t.name).join(', '));
        // And the client is told what it's drawing.
        const meta = e.publicState(r).board;
        ok(`${id}: the state carries the board`, meta.id === id && meta.size === r.tiles.length, JSON.stringify(meta?.id));
    }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
