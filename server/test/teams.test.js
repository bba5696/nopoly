// Engine-level checks for the teams feature. No sockets, no client — every
// assertion is a direct call into the engine with dice pinned where it matters.
const e = require('../game/engine');

let pass = 0;
const fails = [];
function ok(label, cond, extra) {
    if (cond) { pass++; return; }
    fails.push(label + (extra ? ` — ${extra}` : ''));
}

/** Fresh 2v2 room, already started. */
function room2v2(settings = {}) {
    const r = e.createRoom('TEST');
    Object.assign(r.settings, settings);
    const names = ['Ada', 'Bo', 'Cy', 'Di'];
    const ids = names.map((n) => e.addPlayer(r, { name: n }).player);
    e.updateSettings(r, ids[0].id, { teams: true });
    e.startGame(r, ids[0].id);
    return { r, p: Object.fromEntries(names.map((n, i) => [n, r.players.find((q) => q.name === n)])) };
}

function give(r, player, tileId, houses = 0) {
    const t = r.tiles[tileId];
    t.ownerId = player.id;
    t.houses = houses;
    if (!player.properties.includes(tileId)) player.properties.push(tileId);
}

/** Tile ids of the first colour group with at least 2 tiles. */
function firstGroup(r) {
    const g = {};
    for (const t of r.tiles) if (t.groupId) (g[t.groupId] ||= []).push(t.id);
    return Object.values(g).find((ids) => ids.length >= 2);
}

/* ------------------------------------------------------------- assignment */
{
    const { r, p } = room2v2();
    ok('auto-assign pairs players', p.Ada.teamId === p.Bo.teamId && p.Cy.teamId === p.Di.teamId,
        JSON.stringify(r.players.map((q) => [q.name, q.teamId])));
    ok('teams differ', p.Ada.teamId !== p.Cy.teamId);
    ok('teammates share a hue, not a shade', p.Ada.color !== p.Bo.color);
    ok('turn order interleaves', r.players.map((q) => q.teamId).join('') === 'ABAB',
        r.players.map((q) => `${q.name}:${q.teamId}`).join(' '));
}

/* ------------------------------------------------------ shared ownership */
{
    const { r, p } = room2v2();
    const [a, b] = firstGroup(r);
    const ids = firstGroup(r);
    ids.forEach((id, i) => give(r, i === 0 ? p.Ada : p.Bo, id));
    ok('set split across teammates counts as complete', e.ownsFullGroup(r, p.Ada.id, r.tiles[a].groupId));
    ok('opponent does not own it', !e.ownsFullGroup(r, p.Cy.id, r.tiles[a].groupId));

    // Sharing a set doesn't mean sharing a turn: Bo builds on his own.
    ok('not on someone else\'s turn', !!e.buildHouse(r, p.Bo.id, a).error && r.tiles[a].houses === 0);

    // Bo may build on Ada's deed, paying from his own cash.
    r.turnIndex = r.players.indexOf(p.Bo);
    const cashBefore = p.Bo.cash;
    const res = e.buildHouse(r, p.Bo.id, a);
    ok('teammate can build on your deed', !res.error && r.tiles[a].houses === 1, res.error);
    ok('builder pays for it', p.Bo.cash === cashBefore - r.tiles[a].houseCost);

    // ...but may not sell it back off.
    const sell = e.sellHouse(r, p.Bo.id, a);
    ok('teammate cannot sell off your deed', !!sell.error && r.tiles[a].houses === 1, sell.error);
    ok('owner can sell their own', !e.sellHouse(r, p.Ada.id, a).error);
    void b;
}

/* -------------------------------------------------------------- no rent */
{
    const { r, p } = room2v2();
    const tileId = firstGroup(r)[0];
    give(r, p.Ada, tileId);
    p.Bo.position = tileId;
    const before = { bo: p.Bo.cash, ada: p.Ada.cash };
    r.turnIndex = r.players.indexOf(p.Bo);
    // resolveLanding is internal; drive it through a roll landing instead.
    const orig = Math.random;
    // Land Cy on it to prove rent still applies to opponents.
    p.Cy.position = tileId - 2;
    r.turnIndex = r.players.indexOf(p.Cy);
    Math.random = () => 0.0; // 1 + 1 = 2
    e.rollDice(r, p.Cy.id);
    Math.random = orig;
    ok('opponent still pays rent', p.Cy.cash < 1500 && p.Ada.cash > before.ada,
        `cy=${p.Cy.cash} ada=${p.Ada.cash}`);

    const adaAfter = p.Ada.cash;
    p.Bo.position = tileId - 2;
    r.turnIndex = r.players.indexOf(p.Bo);
    r.phase = 'rolling';
    r.hasRolled = false;
    Math.random = () => 0.0;
    e.rollDice(r, p.Bo.id);
    Math.random = orig;
    ok('teammate pays no rent', p.Bo.cash === before.bo && p.Ada.cash === adaAfter,
        `bo=${p.Bo.cash} (was ${before.bo}) ada=${p.Ada.cash} (was ${adaAfter})`);
}

/* ------------------------------------------------- airports count as one */
{
    const { r, p } = room2v2();
    const airports = r.tiles.filter((t) => t.type === 'airport').map((t) => t.id);
    give(r, p.Ada, airports[0]);
    give(r, p.Bo, airports[1]);
    p.Cy.position = airports[0] - 2;
    r.turnIndex = r.players.indexOf(p.Cy);
    const orig = Math.random;
    Math.random = () => 0.0;
    e.rollDice(r, p.Cy.id);
    Math.random = orig;
    const paid = 1500 - p.Cy.cash;
    ok('two airports across a team pay the 2-airport rate', paid === r.board.airportRent[1],
        `paid ${paid}, table ${JSON.stringify(r.board.airportRent)}`);
}

/* -------------------------------------------------------------- bailout */
{
    const { r, p } = room2v2();
    const tileId = firstGroup(r)[0];
    give(r, p.Cy, tileId, 4);           // big rent waiting
    p.Ada.cash = 10;
    p.Ada.properties = [];              // nothing to sell
    p.Bo.cash = 5000;
    p.Ada.position = tileId - 2;
    r.turnIndex = r.players.indexOf(p.Ada);
    const orig = Math.random;
    Math.random = () => 0.0;
    e.rollDice(r, p.Ada.id);
    Math.random = orig;

    ok('insolvent player is not bankrupted outright', !p.Ada.bankrupt);
    ok('bailout is offered', p.Ada.debt?.bailout === 'offered', JSON.stringify(p.Ada.debt));
    ok('an opponent cannot answer it', !!e.respondBailout(r, p.Cy.id, true).error);

    const owed = p.Ada.debt.amount;
    const boBefore = p.Bo.cash;
    const cyBefore = p.Cy.cash;
    const res = e.respondBailout(r, p.Bo.id, true);
    ok('teammate can accept', !res.error, res.error);
    ok('debtor is free', !p.Ada.debt && !p.Ada.bankrupt);
    ok('teammate paid the creditor', p.Bo.cash === boBefore - owed && p.Cy.cash === cyBefore + owed,
        `bo ${boBefore}->${p.Bo.cash}, cy ${cyBefore}->${p.Cy.cash}, owed ${owed}`);
    ok('teammate has no leftover debt', !p.Bo.debt);
}

/* ------------------------------------------------ bailout declined = solo */
{
    const { r, p } = room2v2();
    const tileId = firstGroup(r)[0];
    const owned = firstGroup(r)[1];
    give(r, p.Cy, tileId, 4);
    give(r, p.Ada, owned);              // an estate that should go to the bank
    p.Ada.cash = 10;
    p.Bo.cash = 5000;
    p.Ada.position = tileId - 2;
    r.turnIndex = r.players.indexOf(p.Ada);
    const orig = Math.random;
    Math.random = () => 0.0;
    e.rollDice(r, p.Ada.id);
    Math.random = orig;

    ok('bailout offered before the decline', p.Ada.debt?.bailout === 'offered');
    e.respondBailout(r, p.Bo.id, false);
    ok('declining bankrupts the debtor', p.Ada.bankrupt);
    ok('teammate plays on', !p.Bo.bankrupt);
    ok('estate goes to the bank, not the teammate', r.tiles[owned].ownerId === null,
        `owner=${r.tiles[owned].ownerId}`);
    ok('game continues with 3 players', r.phase !== 'ended', r.phase);
}

/* ------------------------------------------- team insolvent = team gone */
{
    const { r, p } = room2v2();
    const tileId = firstGroup(r)[0];
    give(r, p.Cy, tileId, 5);
    p.Ada.cash = 5;
    p.Bo.cash = 5;
    p.Ada.properties = [];
    p.Bo.properties = [];
    p.Ada.position = tileId - 2;
    r.turnIndex = r.players.indexOf(p.Ada);
    const orig = Math.random;
    Math.random = () => 0.0;
    e.rollDice(r, p.Ada.id);
    Math.random = orig;

    ok('both team members are out', p.Ada.bankrupt && p.Bo.bankrupt,
        `ada=${p.Ada.bankrupt} bo=${p.Bo.bankrupt}`);
    ok('no bailout was offered', !p.Ada.debt);
    ok('the surviving team wins', r.phase === 'ended', r.phase);
    ok('winner is on the surviving team', [p.Cy.id, p.Di.id].includes(r.winnerId));
    ok('winning team is recorded', r.winnerTeam === p.Cy.teamId);
}

/* ------------------------------------------------------------ transfers */
{
    const { r, p } = room2v2();
    r.turnIndex = r.players.indexOf(p.Ada);
    let res = e.sendCash(r, p.Ada.id, p.Bo.id, 300);
    ok('free on your own turn', !res.error && p.Ada.cash === 1200 && p.Bo.cash === 1800,
        `${res.error} ada=${p.Ada.cash} bo=${p.Bo.cash}`);

    res = e.sendCash(r, p.Bo.id, p.Ada.id, 300);
    ok('off-turn charges 10%', !res.error && p.Bo.cash === 1800 - 330,
        `${res.error} bo=${p.Bo.cash}`);

    ok('cannot send to an opponent', !!e.sendCash(r, p.Ada.id, p.Cy.id, 100).error);
    ok('cannot send more than you hold', !!e.sendCash(r, p.Ada.id, p.Bo.id, 999999).error);

    // A transfer should settle the recipient's debt on arrival.
    p.Bo.debt = { amount: 200, toId: null, bailout: null };
    p.Ada.cash = 1000;
    r.turnIndex = r.players.indexOf(p.Ada);
    e.sendCash(r, p.Ada.id, p.Bo.id, 250);
    ok('a transfer pays down the recipient debt', !p.Bo.debt, JSON.stringify(p.Bo.debt));
}

/* ----------------------------------------------------- exploit guards */
{
    const { r, p } = room2v2();
    const owned = firstGroup(r)[0];
    give(r, p.Ada, owned);
    p.Ada.debt = { amount: 400, toId: null, bailout: 'offered' };
    const res = e.createTrade(r, p.Ada.id, { toId: p.Bo.id, give: { tiles: [owned], cash: 0 }, get: {} });
    ok('cannot launder the estate to a teammate while in debt', !!res.error, JSON.stringify(res));
    ok('can still trade with an opponent while in debt',
        !e.createTrade(r, p.Ada.id, { toId: p.Cy.id, give: { tiles: [owned], cash: 0 }, get: { cash: 400 } }).error);
    ok('cannot send cash while in debt', !!e.sendCash(r, p.Ada.id, p.Bo.id, 1).error);
}

/* -------------------------------------------------------- auction guard */
{
    const { r, p } = room2v2();
    const free = r.tiles.find((t) => t.type === 'property' && t.ownerId === null);
    e.startAuction(r, free.id);
    ok('first bid lands', !e.placeBid(r, p.Ada.id, r.auction.nextBid).error);
    ok('teammate cannot bid over you', !!e.placeBid(r, p.Bo.id, r.auction.nextBid).error);
    ok('opponent can', !e.placeBid(r, p.Cy.id, r.auction.nextBid).error);
    ok('and now you can bid again', !e.placeBid(r, p.Ada.id, r.auction.nextBid).error);
}

/* -------------------------------------------------- free-for-all intact */
{
    const r = e.createRoom('SOLO');
    const a = e.addPlayer(r, { name: 'Ada' }).player;
    const b = e.addPlayer(r, { name: 'Bo' }).player;
    e.startGame(r, a.id);
    ok('teams off by default', r.settings.teams === false && !a.teamId);
    ok('no teams payload', e.publicState(r).teams === null);
    const tileId = firstGroup(r)[0];
    give(r, a, tileId, 4);
    b.cash = 5;
    b.properties = [];
    b.position = tileId - 2;
    r.turnIndex = r.players.indexOf(b);
    const orig = Math.random;
    Math.random = () => 0.0;
    e.rollDice(r, b.id);
    Math.random = orig;
    ok('solo player still bankrupts straight away', b.bankrupt && r.phase === 'ended',
        `bankrupt=${b.bankrupt} phase=${r.phase}`);
    ok('solo winner recorded', r.winnerId === a.id && r.winnerTeam === null);
    ok('solo estate returns to the bank', r.tiles[tileId].ownerId === a.id);
    ok('sending cash is refused without teams', !!e.sendCash(r, a.id, b.id, 10).error);
}

/* --------------------------------------------------------- start guards */
{
    // Two against one, which a table that sets it up that way means.
    const r = e.createRoom('ODD');
    const a = e.addPlayer(r, { name: 'Ada' }).player;
    e.addPlayer(r, { name: 'Bo' });
    e.addPlayer(r, { name: 'Cy' });
    e.updateSettings(r, a.id, { teams: true });
    ok('an uneven split starts', !e.startGame(r, a.id).error, JSON.stringify(e.startGame(r, a.id)));

    // Everyone on one side is not a game, whatever the sizes are allowed to be.
    const r2 = e.createRoom('ONE');
    const a2 = e.addPlayer(r2, { name: 'Ada' }).player;
    const b2 = e.addPlayer(r2, { name: 'Bo' }).player;
    e.updateSettings(r2, a2.id, { teams: true });
    e.setTeam(r2, a2.id, b2.id, a2.teamId);
    const res2 = e.startGame(r2, a2.id);
    ok('one side is not a game', !!res2.error, JSON.stringify(res2));
    ok('and it says so', /at least 2 teams/.test(res2.error || ''), res2.error);

    // Five on a side: allowed, and still five tokens you can tell apart.
    const r3 = e.createRoom('BIG');
    const host = e.addPlayer(r3, { name: 'Ada' }).player;
    const rest = ['Bo', 'Cy', 'Di', 'Ev', 'Fi'].map((n) => e.addPlayer(r3, { name: n }).player);
    e.updateSettings(r3, host.id, { teams: true });
    for (const q of rest) e.setTeam(r3, host.id, q.id, 'B');
    e.setTeam(r3, host.id, host.id, 'A');
    ok('five against one starts', !e.startGame(r3, host.id).error, JSON.stringify(e.startGame(r3, host.id)));
    ok('and the five wear five shades of one hue',
        new Set(rest.map((q) => q.color)).size === 5, rest.map((q) => q.color).join(' '));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
