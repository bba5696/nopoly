// notan, headless: the island, the setup snake, the dice, the robber, building,
// trading, development cards, the two awards, and whole games played at random
// with the books checked after every turn.
const e = require('../game/engine');
const n = require('../game/notan/rules');
const { RESOURCES, SIZES, makeMap } = require('../game/notan/board');
const { rulesFor } = require('../game/rules');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function room(names) {
    const r = e.createRoom('ISLE', { game: 'notan' });
    const p = {};
    for (const name of names) p[name] = e.addPlayer(r, { name }).player;
    return { r, p };
}
/** Run setup on everyone's behalf at the suggested spots. */
function settle(r) {
    while (r.step === 'setup') n.playIdleTurn(r, r.players[r.turnIndex]);
}
const give = (pl, res) => Object.assign(pl.resources, res);
const bankTotal = (r, res) => r.bank[res] + r.players.reduce((a, q) => a + q.resources[res], 0);

/* ----------------------------------------------------------- the island */
{
    const small = makeMap(4);
    const large = makeMap(6);
    ok('four players get 19 hexes', small.hexes.length === 19);
    ok('and the standard 54 corners and 72 edges', small.vertices.length === 54 && small.edges.length === 72);
    ok('five or six get 30', large.hexes.length === 30 && large.size === 'large');
    ok('nine harbours on the small island', small.harbors.length === 9);
    ok('eleven on the large', large.harbors.length === 11);
    ok('no two harbours share a corner', small.vertices.filter((v) => v.harbor).length === 18);
    ok('the robber starts on a desert', small.hexes[small.robber].resource === 'desert');
    for (let i = 0; i < 30; i++) {
        const m = makeMap(4);
        const red = (h) => h.number === 6 || h.number === 8;
        if (m.hexes.some((h) => red(h) && h.adj.some((a) => red(m.hexes[a])))) {
            ok('no two red numbers touch', false);
            break;
        }
    }
    ok('rules are registered', rulesFor({ game: 'notan' }).id === 'notan');
}

/* -------------------------------------------------------------- setup */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    ok('starts', !e.startGame(r, p.Ada.id).error);
    ok('in setup, Ada first', r.step === 'setup' && r.players[r.turnIndex].id === p.Ada.id);
    ok('a road before a settlement is refused', !!n.build(r, p.Ada.id, { kind: 'road', at: 0 }).error);
    ok('someone else cannot place', !!n.build(r, p.Bo.id, { kind: 'settlement', at: 0 }).error);
    const at = n.suggestSettlement(r, p.Ada.id, { setup: true });
    ok('settlement placed', !n.build(r, p.Ada.id, { kind: 'settlement', at }).error);
    const near = r.map.vertices[at].adj[0];
    ok('the road must touch it', !!n.build(r, p.Ada.id, { kind: 'road', at: r.map.vertices[near].edges.find((x) => !r.map.vertices[at].edges.includes(x)) }).error);
    n.build(r, p.Ada.id, { kind: 'road', at: n.suggestRoad(r, p.Ada.id) });
    ok('then Bo', r.players[r.turnIndex].id === p.Bo.id);
    ok('the distance rule', !n.legalSettlements(r, p.Bo.id, { setup: true }).includes(near));
    // Bo and Cy, then Cy again — the snake.
    n.playIdleTurn(r, r.players[r.turnIndex]);
    ok('Cy places', r.players[r.turnIndex].id === p.Cy.id);
    const cyBefore = Object.values(p.Cy.resources).reduce((a, b) => a + b, 0);
    n.playIdleTurn(r, p.Cy);
    ok('Cy goes twice running', r.players[r.turnIndex].id === p.Bo.id);
    ok('and the second settlement paid out', Object.values(p.Cy.resources).reduce((a, b) => a + b, 0) > cyBefore);
    settle(r);
    ok('everyone has two settlements and two roads',
        r.players.every((q) => q.pieces.settlements === 3 && q.pieces.roads === 13));
    ok('then Ada rolls first', r.step === 'roll' && r.players[r.turnIndex].id === p.Ada.id);
}

/* ------------------------------------------------- dice, robber, discard */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    e.startGame(r, p.Ada.id);
    settle(r);
    ok('building before rolling is refused', !!n.build(r, p.Ada.id, { kind: 'dev' }).error);
    ok('ending before rolling is refused', !!n.endTurn(r, p.Ada.id).error);

    const orig = Math.random;
    Math.random = () => 0.999; // 6 + 6
    n.roll(r, p.Ada.id);
    Math.random = orig;
    ok('a twelve rolled', r.dice[0] + r.dice[1] === 12 && r.step === 'main');
    ok('cannot roll twice', !!n.roll(r, p.Ada.id).error);
    n.endTurn(r, p.Ada.id);

    // A seven with a fat hand.
    give(p.Ada, { brick: 3, lumber: 3, wool: 3, grain: 3, ore: 0 });
    for (const res of RESOURCES) r.bank[res] = SIZES.small.bank - bankTotal(r, res) + r.bank[res];
    Math.random = (() => { const seq = [0.0, 0.999]; let i = 0; return () => seq[i++ % 2]; })(); // 1 + 6
    n.roll(r, p.Bo.id);
    Math.random = orig;
    const held = Object.values(p.Ada.resources).reduce((a, b) => a + b, 0);
    ok('a seven asks the full hand to discard', r.step === 'discard' && r.discards[p.Ada.id] === Math.floor(held / 2), JSON.stringify(r.discards));
    ok('the wrong count is refused', !!n.discard(r, p.Ada.id, { cards: { brick: 1 } }).error);
    ok('robber cannot move yet', !!n.moveRobber(r, p.Bo.id, { hexId: 0 }).error);
    const dump = { brick: 3, lumber: 3 };
    ok('discarding six', !n.discard(r, p.Ada.id, { cards: dump }).error);
    ok('then the robber', r.step === 'robber');
    ok('it must move', !!n.moveRobber(r, p.Bo.id, { hexId: r.robber }).error);
    // Onto a hex next to Ada's town, so there is someone to rob.
    const adaTown = Object.entries(r.buildings).find(([, b]) => b.playerId === p.Ada.id)[0];
    const hex = r.map.vertices[adaTown].hexes.find((h) => h !== r.robber);
    const boBefore = Object.values(p.Bo.resources).reduce((a, b) => a + b, 0);
    n.moveRobber(r, p.Bo.id, { hexId: hex });
    if (r.step === 'steal') n.pickVictim(r, p.Bo.id, { victimId: p.Ada.id });
    ok('Bo stole one', Object.values(p.Bo.resources).reduce((a, b) => a + b, 0) === boBefore + 1);
    ok('back to building', r.step === 'main');
    for (const res of RESOURCES) ok(`${res} is all accounted for`, bankTotal(r, res) === SIZES.small.bank);
}

/* ----------------------------------------------- building and trading */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    e.startGame(r, p.Ada.id);
    settle(r);
    n.roll(r, p.Ada.id);
    if (r.step !== 'main') n.playIdleTurn(r, p.Ada); // a seven: let the robber resolve
    if (r.players[r.turnIndex].id !== p.Ada.id) { n.roll(r, r.players[r.turnIndex].id); }
    const me = r.players[r.turnIndex];
    if (r.step !== 'main') n.playIdleTurn(r, me);
    if (r.step === 'main' && r.players[r.turnIndex].id === me.id) {
        for (const res of RESOURCES) { r.bank[res] += me.resources[res]; me.resources[res] = 0; }
        ok('no road without brick', !!n.build(r, me.id, { kind: 'road', at: n.legalRoads(r, me.id)[0] }).error);
        give(me, { brick: 1, lumber: 1 }); r.bank.brick -= 1; r.bank.lumber -= 1;
        const road = n.legalRoads(r, me.id)[0];
        ok('a road', !n.build(r, me.id, { kind: 'road', at: road }).error && r.roads[road] === me.id);
        ok('paid for', me.resources.brick === 0 && me.resources.lumber === 0);

        give(me, { wool: 4 }); r.bank.wool -= 4;
        ok('4:1 with the bank', !n.bankTrade(r, me.id, { give: 'wool', get: 'ore' }).error && me.resources.ore === 1 && me.resources.wool === 0);
        ok('not without the cards', !!n.bankTrade(r, me.id, { give: 'wool', get: 'ore' }).error);

        const other = r.players.find((q) => q.id !== me.id);
        for (const res of RESOURCES) { r.bank[res] += other.resources[res]; other.resources[res] = 0; }
        give(other, { grain: 1 }); r.bank.grain -= 1;
        ok('an offer', !n.offer(r, me.id, { give: { ore: 1 }, get: { grain: 1 } }).error && r.offer);
        ok('only the current player offers', !!n.offer(r, other.id, { give: { grain: 1 }, get: { ore: 1 } }).error);
        ok('accepted', !n.acceptOffer(r, other.id, { offerId: r.offer.id }).error);
        ok('and swapped', me.resources.grain === 1 && other.resources.ore === 1 && !r.offer);

        give(me, { wool: 1, ore: 1 }); r.bank.wool -= 1; r.bank.ore -= 1;
        const res = n.build(r, me.id, { kind: 'dev' });
        ok('a development card', !res.error && me.dev.length === 1, JSON.stringify(res));
        if (me.dev[0].kind !== 'point') ok('not playable the turn it is bought', !!n.playDev(r, me.id, { cardId: me.dev[0].id }).error);
        for (const res2 of RESOURCES) ok(`${res2} balances after trading`, bankTotal(r, res2) === SIZES.small.bank);
    } else ok('reached a main step to build in', false);
}

/* ----------------------------------------------------- longest road */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    e.startGame(r, p.Ada.id);
    settle(r);
    // Lay a fresh line of six roads for Ada along an open path.
    r.roads = {};
    r.buildings = {};
    // A simple path of six edges, found by search rather than a greedy walk
    // that can corner itself on the coast.
    const find = (v, seen, path) => {
        if (path.length === 6) return path;
        for (const ed of r.map.vertices[v].edges) {
            const edge = r.map.edges[ed];
            const w = edge.a === v ? edge.b : edge.a;
            if (seen.has(w)) continue;
            const got = find(w, new Set([...seen, w]), [...path, { edge: ed, from: v, to: w }]);
            if (got) return got;
        }
        return null;
    };
    const path = find(20, new Set([20]), []);
    for (const step of path) r.roads[step.edge] = p.Ada.id;
    ok('a run of six measures six', n.roadLength(r, p.Ada.id) === 6, String(n.roadLength(r, p.Ada.id)));
    r.buildings[path[2].to] = { playerId: p.Bo.id, kind: 'settlement' };
    ok('a rival town cuts it', n.roadLength(r, p.Ada.id) === 3, String(n.roadLength(r, p.Ada.id)));
}

/* ------------------------------------------------- what stays private */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    e.startGame(r, p.Ada.id);
    settle(r);
    const view = JSON.stringify(e.publicState(r));
    ok('no resources in the broadcast', !/"resources"/.test(view));
    ok('no dev cards in the broadcast', e.publicState(r).players.every((q) => !('dev' in q)));
    ok('but the count is there', e.publicState(r).players.every((q) => typeof q.cardCount === 'number'));
    ok('legal spots only for whoever is up', n.privateFor(r, p.Bo.id).hand.legal.road.length === 0);
}

/* -------------------------------------------- leaving, and the rematch */
{
    const { r, p } = room(['Ada', 'Bo', 'Cy']);
    e.startGame(r, p.Ada.id);
    settle(r);
    rulesFor(r).removeFromPlay(r, p.Bo);
    ok('their pieces come off', !Object.values(r.buildings).some((b) => b.playerId === p.Bo.id) && !Object.values(r.roads).includes(p.Bo.id));
    rulesFor(r).removeFromPlay(r, p.Cy);
    ok('the last one standing wins', r.phase === 'ended' && r.winnerId === p.Ada.id);
    e.resetForRematch(r);
    ok('a rematch is a clean lobby', r.phase === 'waiting' && !r.map && r.players.every((q) => q.pieces?.roads === 15));
}

/* ------------------------------------------- whole games, at random */
function play(count) {
    const { r } = room(Array.from({ length: count }, (_, i) => `P${i}`));
    e.startGame(r, r.players[0].id);
    const size = () => SIZES[r.map.size].bank;
    let steps = 0;
    while (r.phase === 'playing' && steps++ < 5000) {
        const cur = r.players[r.turnIndex];
        if (r.step !== 'main') {
            const knight = cur.dev.find((c) => c.kind === 'knight' && c.boughtOn !== r.stats.turnCount);
            if (r.step === 'roll' && knight && !r.devPlayed && Math.random() < 0.5) n.playDev(r, cur.id, { cardId: knight.id });
            else if (r.step === 'roll') n.roll(r, cur.id);
            else n.playIdleTurn(r, cur);
            continue;
        }
        const mine = n.privateFor(r, cur.id).hand;
        const tries = [
            () => mine.legal.city.length && n.build(r, cur.id, { kind: 'city', at: pick(mine.legal.city) }),
            () => mine.legal.settlement.length && n.build(r, cur.id, { kind: 'settlement', at: pick(mine.legal.settlement) }),
            () => mine.legal.road.length && n.build(r, cur.id, { kind: 'road', at: pick(mine.legal.road) }),
            () => n.build(r, cur.id, { kind: 'dev' }),
            () => n.bankTrade(r, cur.id, { give: pick(RESOURCES), get: pick(RESOURCES) }),
            () => {
                const c = mine.dev.find((d) => d.playable);
                if (c) n.playDev(r, cur.id, { cardId: c.id, resource: pick(RESOURCES), resources: [pick(RESOURCES), pick(RESOURCES)] });
            },
        ];
        for (let k = 0; k < 6 && r.phase === 'playing'; k++) pick(tries)();
        if (r.phase === 'playing' && r.step === 'main' && r.players[r.turnIndex] === cur) n.endTurn(r, cur.id);
        for (const res of RESOURCES) {
            if (bankTotal(r, res) !== size()) return { error: `${res} totals ${bankTotal(r, res)}` };
            if (r.bank[res] < 0 || r.players.some((q) => q.resources[res] < 0)) return { error: `negative ${res}` };
        }
    }
    const w = r.players.find((q) => q.id === r.winnerId);
    return { ended: r.phase === 'ended', points: w && n.totalPoints(r, w) };
}
for (const count of [3, 4, 5, 6]) {
    for (let i = 0; i < 3; i++) {
        const res = play(count);
        ok(`a ${count}-player game balances its books`, !res.error, res.error);
        ok(`a ${count}-player game ends with a winner on ten`, res.ended && res.points >= 10, JSON.stringify(res));
    }
}

/* ---------------------------------------------------------------- bots */
{
    const { r, p } = room(['Ada', 'Bo']);
    ok('two cannot start on their own', !!e.startGame(r, p.Ada.id).error);
    ok('only the host fills seats', !!n.actions['notan:bots'](r, p.Bo.id).error);
    ok('the host fills them', !n.actions['notan:bots'](r, p.Ada.id).error);
    ok('up to three, no more', r.players.length === 3 && r.players.filter((q) => q.bot).length === 1);
    ok('then it starts', !e.startGame(r, p.Ada.id).error);

    // Drive the bot clock by hand: whenever a bot is due, run it; whenever a
    // person is up, play for them.
    let guard = 0;
    let botMoves = 0;
    while (r.phase === 'playing' && guard++ < 20000) {
        if (n.bots.work(r)) {
            rulesFor(r).timer(r).resolve(r);
            botMoves += 1;
            continue;
        }
        if (r.step === 'discard') {
            for (const id of Object.keys(r.discards)) n.discardFor(r, r.players.find((q) => q.id === id));
            continue;
        }
        if (r.offer) {
            n.declineOffer(r, r.offer.fromId, { offerId: r.offer.id });
            continue;
        }
        n.playIdleTurn(r, r.players[r.turnIndex]);
    }
    ok('a game with a bot in it finishes', r.phase === 'ended', `step=${r.step} turn=${r.stats.turnCount}`);
    const bot = r.players.find((q) => q.bot);
    ok('the bot played its own moves', botMoves > 20, String(botMoves));
    ok('and built past its setup', bot.pieces.roads < 13 || bot.pieces.settlements < 3 || bot.pieces.cities < 4);
    for (const res of RESOURCES) ok(`${res} balances in a bot game`, bankTotal(r, res) === SIZES.small.bank);
}
{
    // A trade put to a bot gets an answer.
    const { r, p } = room(['Ada']);
    n.actions['notan:bots'](r, p.Ada.id);
    e.startGame(r, p.Ada.id);
    while (r.step === 'setup') {
        if (n.bots.work(r)) rulesFor(r).timer(r).resolve(r);
        else n.playIdleTurn(r, r.players[r.turnIndex]);
    }
    while (r.players[r.turnIndex].id !== p.Ada.id || r.step !== 'main') {
        if (n.bots.work(r)) rulesFor(r).timer(r).resolve(r);
        else if (r.step === 'roll') n.roll(r, r.players[r.turnIndex].id);
        else if (r.step === 'discard') for (const id of Object.keys(r.discards)) n.discardFor(r, r.players.find((q) => q.id === id));
        else n.playIdleTurn(r, r.players[r.turnIndex]);
    }
    give(p.Ada, { ore: 5 });
    r.bank.ore -= 5;
    n.offer(r, p.Ada.id, { give: { ore: 2 }, get: { wool: 1 } });
    for (let i = 0; i < 3 && n.bots.work(r); i++) rulesFor(r).timer(r).resolve(r);
    ok('every bot answered the offer', !r.offer || r.offer.declined.length === 2);
}
{
    // Nobody human at the table: the bots stop rather than play to an empty room.
    const { r, p } = room(['Ada']);
    n.actions['notan:bots'](r, p.Ada.id);
    e.startGame(r, p.Ada.id);
    p.Ada.connected = false;
    ok('bots wait for a person', !n.bots.work(r) && !rulesFor(r).timer(r));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
