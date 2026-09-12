// Who may bid, and on what.
//
// The rule with teeth: turning a tile down and then winning it at auction for
// less than the asking price was the cheapest way to buy anything on the board.
// Landing on something you cannot afford is not the same thing, and is not
// punished — see startAuction.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { teams = false } = {}) {
    const r = e.createRoom('AUCT');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    if (teams) e.updateSettings(r, p[names[0]].id, { teams: true });
    e.startGame(r, p[names[0]].id);
    return { r, p };
}

/** Whoever the engine says is up. */
const upNow = (r) => r.players[r.turnIndex];

/* ------------------------------------ you cannot bid on what you turned down */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const up = upNow(r);
    const other = r.players.find((q) => q.id !== up.id);
    const tile = r.tiles.find((t) => t.type === 'property' && t.ownerId === null);

    // Landing on it with the money, and saying no.
    r.pendingAction = { type: 'buy', playerId: up.id, tileId: tile.id };
    e.declinePurchase(r, up.id);
    ok('declining opens an auction', !!r.auction, JSON.stringify(r.auction));
    ok('and remembers who passed', r.auction.barredId === up.id);

    const refused = e.placeBid(r, up.id, r.auction.nextBid);
    ok('the one who passed cannot bid', !!refused.error, JSON.stringify(refused));
    ok('and no bid was recorded', r.auction.bidderId === null);
    ok('everybody else still can', !e.placeBid(r, other.id, r.auction.nextBid).error);

    // The feed has to say why, or it reads as a broken button.
    ok('the feed says they passed', r.log.some((l) => /passed and cannot bid/.test(l.text)));
}

/* ------------------------------- but an auction you never asked for is fair game */
{
    const { r } = mk(['Ada', 'Bo']);
    const up = upNow(r);
    const tile = r.tiles.find((t) => t.type === 'property' && t.ownerId === null);

    // Nobody declined anything: this is the auction that happens when the
    // player who landed cannot afford the asking price.
    e.startAuction(r, tile.id);
    ok('an auction nobody declined bars nobody', r.auction.barredId === null);
    up.cash = 5000;
    ok('and the player who landed may bid', !e.placeBid(r, up.id, r.auction.nextBid).error);
}

/* ------------------------------------------ with teams, the bar is the whole side */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Dee'], { teams: true });
    const ada = r.players.find((q) => q.id === p.Ada.id);
    const mate = r.players.find((q) => q.teamId === ada.teamId && q.id !== ada.id);
    const rival = r.players.find((q) => q.teamId !== ada.teamId);
    const tile = r.tiles.find((t) => t.type === 'property' && t.ownerId === null);

    r.pendingAction = { type: 'buy', playerId: ada.id, tileId: tile.id };
    e.declinePurchase(r, ada.id);
    ok('a teammate cannot bid on what your side passed on', !!e.placeBid(r, mate.id, r.auction.nextBid).error);
    ok('the other side can', !e.placeBid(r, rival.id, r.auction.nextBid).error);
}

console.log(`
${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
