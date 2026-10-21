// notan — the island game, as a rules module.
//
// Settle an island, roll for what it grows, build roads and towns and cities
// out of it, and be first to ten points. The rules are the ones the box has
// always had, with the fiddly parts taken off the table rather than changed:
// the server works out every legal spot and every trade rate and sends them to
// the one player they are for, so nobody has to count corners or remember what
// a city costs.
//
// What a hand holds is secret — resources and development cards go down the
// private channel, like a nouno hand, and the room is told counts.

const { RESOURCES, SIZES, pips, makeMap, makeDevDeck } = require('./board');

const COSTS = {
    road: { brick: 1, lumber: 1 },
    settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
    dev: { wool: 1, grain: 1, ore: 1 },
};
const PIECES = { roads: 15, settlements: 5, cities: 4 };
const TARGET = 10;
/** How long the table waits on a discard before it is made for them. */
const DISCARD_MS = 60_000;
const DEV_NAMES = {
    knight: 'Knight',
    point: 'Victory Point',
    roads: 'Road Building',
    plenty: 'Year of Plenty',
    monopoly: 'Monopoly',
};

const engine = () => require('../engine');
const log = (room, text) => engine().log(room, text);
const findPlayer = (room, id) => room.players.find((p) => p.id === id) || null;
const inPlay = (room) => room.players.filter((p) => !p.resigned && !p.out);
const current = (room) => room.players[room.turnIndex] || null;
const isCurrent = (room, id) => current(room)?.id === id;
const emptyHand = () => Object.fromEntries(RESOURCES.map((r) => [r, 0]));
const count = (res) => RESOURCES.reduce((n, r) => n + (res?.[r] || 0), 0);
const isResource = (r) => RESOURCES.includes(r);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `{ brick: 1, wool: 2 }` as "1 brick, 2 wool", for the feed. */
function describe(res) {
    const parts = RESOURCES.filter((r) => res?.[r] > 0).map((r) => `${res[r]} ${r}`);
    return parts.length ? parts.join(', ') : 'nothing';
}

/** A trade or a discard as sent by a client: only resources, only whole positive counts. */
function clean(res) {
    const out = emptyHand();
    for (const r of RESOURCES) {
        const n = Math.floor(Number(res?.[r]) || 0);
        out[r] = Math.max(0, Math.min(n, 99));
    }
    return out;
}

const has = (player, res) => RESOURCES.every((r) => (player.resources[r] || 0) >= (res[r] || 0));
function pay(room, player, res) {
    for (const r of RESOURCES) {
        player.resources[r] -= res[r] || 0;
        room.bank[r] += res[r] || 0;
    }
}
function take(room, player, res) {
    for (const r of RESOURCES) {
        player.resources[r] += res[r] || 0;
        room.bank[r] -= res[r] || 0;
    }
}

/* ------------------------------------------------------------- the board */

const building = (room, v) => room.buildings[v] || null;
const vertexOf = (room, v) => room.map.vertices[v];
const edgeOf = (room, e) => room.map.edges[e];

/** Nothing on it and nothing on a neighbouring corner — the distance rule. */
function spacious(room, v) {
    if (building(room, v)) return false;
    return vertexOf(room, v).adj.every((n) => !building(room, n));
}

function touchesOwnRoad(room, pid, v) {
    return vertexOf(room, v).edges.some((e) => room.roads[e] === pid);
}

/** A road may go here: free, and joined to something of yours that is not cut off. */
function roadFits(room, pid, e) {
    if (room.roads[e] != null) return false;
    const edge = edgeOf(room, e);
    return [edge.a, edge.b].some((v) => {
        const b = building(room, v);
        if (b) return b.playerId === pid;
        // Through an empty corner, from a road of your own.
        return touchesOwnRoad(room, pid, v);
    });
}

function legalSettlements(room, pid, { setup = false } = {}) {
    return room.map.vertices
        .filter((v) => spacious(room, v.id) && (setup || touchesOwnRoad(room, pid, v.id)))
        .map((v) => v.id);
}
function legalRoads(room, pid) {
    if (room.step === 'setup') {
        const at = room.setup?.vertex;
        if (at == null) return [];
        return vertexOf(room, at).edges.filter((e) => room.roads[e] == null);
    }
    return room.map.edges.filter((e) => roadFits(room, pid, e.id)).map((e) => e.id);
}
function legalCities(room, pid) {
    return Object.entries(room.buildings)
        .filter(([, b]) => b.playerId === pid && b.kind === 'settlement')
        .map(([v]) => Number(v));
}

/** How good a corner is to start on: the dice it pays on, and how many kinds. */
function cornerScore(room, v) {
    const vert = vertexOf(room, v);
    const kinds = new Set();
    let dots = 0;
    for (const h of vert.hexes) {
        const hex = room.map.hexes[h];
        if (hex.resource === 'desert') continue;
        dots += pips(hex.number);
        kinds.add(hex.resource);
    }
    return dots + kinds.size * 0.75 + (vert.harbor ? 0.5 : 0);
}

/** The best corner on offer — the hint in setup, and the idle turn's choice. */
function suggestSettlement(room, pid, opts) {
    const spots = legalSettlements(room, pid, opts);
    let best = null;
    let bestScore = -1;
    for (const v of spots) {
        const s = cornerScore(room, v);
        if (s > bestScore) [best, bestScore] = [v, s];
    }
    return best;
}

/** A road heading somewhere: toward the best corner it could later settle. */
function suggestRoad(room, pid) {
    const roads = legalRoads(room, pid);
    let best = roads[0] ?? null;
    let bestScore = -1;
    for (const e of roads) {
        const edge = edgeOf(room, e);
        const score = Math.max(
            ...[edge.a, edge.b].map((v) => (spacious(room, v) ? cornerScore(room, v) : 0)),
        );
        if (score > bestScore) [best, bestScore] = [e, score];
    }
    return best;
}

/** What you pay the bank for one of something: 4, or less at a harbour. */
function ratesFor(room, pid) {
    const rates = Object.fromEntries(RESOURCES.map((r) => [r, 4]));
    for (const [v, b] of Object.entries(room.buildings)) {
        if (b.playerId !== pid) continue;
        const harbor = vertexOf(room, Number(v)).harbor;
        if (harbor === 'any') for (const r of RESOURCES) rates[r] = Math.min(rates[r], 3);
        else if (harbor) rates[harbor] = 2;
    }
    return rates;
}

/* ------------------------------------------------------------ the points */

/**
 * Longest unbroken run of one player's roads. A trail, not a path — it may
 * come back through a corner, but never along the same road twice — and an
 * opponent's town on a corner cuts it there.
 */
function roadLength(room, pid) {
    let best = 0;
    const blocked = (v) => {
        const b = building(room, v);
        return b && b.playerId !== pid;
    };
    const walk = (v, used, len) => {
        if (len > best) best = len;
        if (blocked(v)) return;
        for (const e of vertexOf(room, v).edges) {
            if (room.roads[e] !== pid || used.has(e)) continue;
            used.add(e);
            const edge = edgeOf(room, e);
            walk(edge.a === v ? edge.b : edge.a, used, len + 1);
            used.delete(e);
        }
    };
    for (const [e, owner] of Object.entries(room.roads)) {
        if (owner !== pid) continue;
        const edge = edgeOf(room, Number(e));
        walk(edge.a, new Set([Number(e)]), 1);
        walk(edge.b, new Set([Number(e)]), 1);
    }
    return best;
}

/**
 * Who holds the longest road. Five to qualify; the holder keeps it on a tie;
 * if theirs is cut and two others tie for longest, nobody holds it.
 */
function updateLongest(room) {
    const lengths = {};
    for (const p of inPlay(room)) lengths[p.id] = roadLength(room, p.id);
    room.roadLengths = lengths;
    const max = Math.max(0, ...Object.values(lengths));
    const was = room.longestRoad?.playerId || null;
    let now = null;
    if (max >= 5) {
        if (was && lengths[was] === max) now = was;
        else {
            const top = Object.keys(lengths).filter((id) => lengths[id] === max);
            if (top.length === 1) now = top[0];
        }
    }
    room.longestRoad = now ? { playerId: now, length: lengths[now] } : null;
    if (now !== was) {
        const p = findPlayer(room, now);
        if (p) log(room, `${p.name} takes the longest road (${lengths[now]})`);
        else log(room, 'Nobody holds the longest road now');
    }
}

function updateArmy(room, player) {
    if (player.knights < 3) return;
    const held = room.largestArmy;
    if (held?.playerId === player.id) {
        held.size = player.knights;
        return;
    }
    if (held && held.size >= player.knights) return;
    room.largestArmy = { playerId: player.id, size: player.knights };
    log(room, `${player.name} takes the largest army (${player.knights} knights)`);
}

/** The points everyone can see. Victory Point cards stay in the hand until the end. */
function publicPoints(room, pid) {
    let n = 0;
    for (const b of Object.values(room.buildings)) if (b.playerId === pid) n += b.kind === 'city' ? 2 : 1;
    if (room.longestRoad?.playerId === pid) n += 2;
    if (room.largestArmy?.playerId === pid) n += 2;
    return n;
}
const hiddenPoints = (player) => (player.dev || []).filter((c) => c.kind === 'point').length;
const totalPoints = (room, player) => publicPoints(room, player.id) + hiddenPoints(player);

/** Points over the game, for the end screen's chart. */
function snapshotPoints(room) {
    const values = {};
    for (const p of room.players) values[p.id] = totalPoints(room, p);
    room.stats.netWorth.push({ turn: room.stats.turnCount || 0, values });
}

/** Only on your own turn — reaching ten on somebody else's waits for yours. */
function checkWin(room) {
    const player = current(room);
    if (!player || room.phase !== 'playing') return false;
    if (totalPoints(room, player) < room.target) return false;
    finish(room, player);
    return true;
}

function finish(room, winner, { quiet = false } = {}) {
    room.phase = 'ended';
    room.winnerId = winner.id;
    room.stats.endedAt = Date.now();
    room.offer = null;
    room.discards = {};
    room.discardEndsAt = null;
    for (const p of room.players) p.points = totalPoints(room, p);
    snapshotPoints(room);
    if (!quiet) log(room, `${winner.name} wins with ${winner.points} points`);
}

/* ------------------------------------------------------------- the turns */

/** Next seat round, skipping anyone who has left. */
function nextSeat(room) {
    const n = room.players.length;
    for (let step = 1; step <= n; step++) {
        const i = (room.turnIndex + step) % n;
        const p = room.players[i];
        if (p && !p.resigned && !p.out) return i;
    }
    return room.turnIndex;
}

function startTurn(room) {
    room.step = 'roll';
    room.rolled = false;
    room.devPlayed = false;
    room.freeRoads = 0;
    room.offer = null;
    room.afterRobber = null;
    room.stats.turnCount = (room.stats.turnCount || 0) + 1;
    snapshotPoints(room);
    engine().armIdle(room);
    checkWin(room);
}

function advance(room) {
    room.turnIndex = nextSeat(room);
    startTurn(room);
}

/* -------------------------------------------------------------- the setup */

/** Everyone once round, then back the other way: last to place goes twice running. */
function setupOrder(room) {
    const ids = inPlay(room).map((p) => p.id);
    return [...ids, ...ids.slice().reverse()];
}

function setupSeat(room) {
    const s = room.setup;
    // Skip anyone who has left since the order was dealt.
    while (s.at < s.order.length && !inPlay(room).some((p) => p.id === s.order[s.at])) s.at += 1;
    if (s.at >= s.order.length) {
        room.setup = null;
        room.turnIndex = room.players.findIndex((p) => p.id === s.order[0]);
        if (room.turnIndex < 0) room.turnIndex = nextSeat(room);
        log(room, 'Everyone is settled — time to roll');
        room.stats.turnCount = 0;
        startTurn(room);
        return;
    }
    room.turnIndex = room.players.findIndex((p) => p.id === s.order[s.at]);
    s.need = 'settlement';
    s.vertex = null;
    engine().armIdle(room);
}

function placeSetup(room, player, kind, at) {
    const s = room.setup;
    if (kind !== s.need) return { error: s.need === 'road' ? 'Place a road next to it' : 'Place a settlement first' };
    if (kind === 'settlement') {
        if (!legalSettlements(room, player.id, { setup: true }).includes(at)) {
            return { error: 'Too close to another settlement' };
        }
        room.buildings[at] = { playerId: player.id, kind: 'settlement' };
        player.pieces.settlements -= 1;
        s.vertex = at;
        s.need = 'road';
        // The second one pays out straight away, one of each thing it touches.
        const second = s.at >= s.order.length / 2;
        if (second) {
            const got = emptyHand();
            for (const h of vertexOf(room, at).hexes) {
                const hex = room.map.hexes[h];
                if (isResource(hex.resource) && room.bank[hex.resource] > 0) got[hex.resource] += 1;
            }
            take(room, player, got);
            log(room, `${player.name} settled and collected ${describe(got)}`);
        } else {
            log(room, `${player.name} placed a settlement`);
        }
        return {};
    }
    if (!legalRoads(room, player.id).includes(at)) return { error: 'The road has to touch the settlement you just placed' };
    room.roads[at] = player.id;
    player.pieces.roads -= 1;
    s.at += 1;
    setupSeat(room);
    return {};
}

/* ---------------------------------------------------------------- dice */

function produce(room, roll) {
    const owed = {}; // resource -> { pid: n }
    for (const hex of room.map.hexes) {
        if (hex.number !== roll || hex.id === room.robber || !isResource(hex.resource)) continue;
        for (const v of hex.vertices) {
            const b = building(room, v);
            if (!b) continue;
            owed[hex.resource] = owed[hex.resource] || {};
            owed[hex.resource][b.playerId] = (owed[hex.resource][b.playerId] || 0) + (b.kind === 'city' ? 2 : 1);
        }
    }
    const gains = {};
    const short = [];
    for (const [r, byPlayer] of Object.entries(owed)) {
        const total = Object.values(byPlayer).reduce((a, b) => a + b, 0);
        const ids = Object.keys(byPlayer);
        // The bank running short pays nobody, unless only one player was owed —
        // then they get what is left.
        if (total > room.bank[r] && ids.length > 1) {
            short.push(r);
            continue;
        }
        for (const id of ids) {
            const n = Math.min(byPlayer[id], room.bank[r]);
            const p = findPlayer(room, id);
            if (!p || n <= 0) continue;
            p.resources[r] += n;
            room.bank[r] -= n;
            gains[id] = gains[id] || {};
            gains[id][r] = (gains[id][r] || 0) + n;
        }
    }
    const lines = Object.entries(gains).map(([id, res]) => `${findPlayer(room, id)?.name} +${describe(res)}`);
    if (lines.length) log(room, lines.join(' · '));
    else log(room, 'Nobody collects anything');
    if (short.length) log(room, `The bank is out of ${short.join(' and ')} — nobody gets any`);
    room.lastProduce = { seq: (room.lastProduce?.seq || 0) + 1, roll, gains };
}

function roll(room, playerId) {
    const player = findPlayer(room, playerId);
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'roll') return { error: room.rolled ? 'Already rolled' : 'Not now' };
    const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    const total = dice[0] + dice[1];
    room.dice = dice;
    room.diceSeq = (room.diceSeq || 0) + 1;
    room.rolled = true;
    room.stats.rolls = room.stats.rolls || {};
    room.stats.rolls[total] = (room.stats.rolls[total] || 0) + 1;
    log(room, `${player.name} rolled ${total}`);
    if (total !== 7) {
        produce(room, total);
        room.step = 'main';
        return {};
    }
    // A seven: anyone over seven cards gives half back, then the robber moves.
    room.discards = {};
    for (const p of inPlay(room)) {
        const n = count(p.resources);
        if (n > 7) room.discards[p.id] = Math.floor(n / 2);
    }
    if (Object.keys(room.discards).length) {
        room.step = 'discard';
        room.discardEndsAt = Date.now() + DISCARD_MS;
        const names = Object.keys(room.discards).map((id) => findPlayer(room, id).name);
        log(room, `Seven! ${names.join(', ')} must discard half`);
    } else {
        room.step = 'robber';
        log(room, 'Seven! Move the robber');
    }
    room.afterRobber = 'main';
    return {};
}

function discard(room, playerId, payload = {}) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    if (room.step !== 'discard' || !room.discards[playerId]) return { error: 'You have nothing to discard' };
    const res = clean(payload.cards);
    if (count(res) !== room.discards[playerId]) return { error: `Pick exactly ${room.discards[playerId]} cards` };
    if (!has(player, res)) return { error: 'You do not have those cards' };
    pay(room, player, res);
    delete room.discards[playerId];
    log(room, `${player.name} discarded ${plural(count(res), 'card')}`);
    if (!Object.keys(room.discards).length) {
        room.step = 'robber';
        room.discardEndsAt = null;
        log(room, `${current(room).name} moves the robber`);
    }
    return {};
}

/** Throw away at random — for whoever the table could not wait for. */
function discardFor(room, player) {
    const need = room.discards[player.id];
    if (!need) return;
    const bag = RESOURCES.flatMap((r) => Array(player.resources[r]).fill(r));
    const res = emptyHand();
    for (let i = 0; i < need && bag.length; i++) {
        const [r] = bag.splice(Math.floor(Math.random() * bag.length), 1);
        res[r] += 1;
    }
    discard(room, player.id, { cards: res });
}

function victimsAt(room, hexId, thiefId) {
    const ids = new Set();
    for (const v of room.map.hexes[hexId].vertices) {
        const b = building(room, v);
        if (b && b.playerId !== thiefId) ids.add(b.playerId);
    }
    return [...ids].filter((id) => {
        const p = findPlayer(room, id);
        return p && !p.out && count(p.resources) > 0;
    });
}

function steal(room, thief, victim) {
    const bag = RESOURCES.flatMap((r) => Array(victim.resources[r]).fill(r));
    if (bag.length) {
        const r = bag[Math.floor(Math.random() * bag.length)];
        victim.resources[r] -= 1;
        thief.resources[r] += 1;
        room.lastSteal = { seq: (room.lastSteal?.seq || 0) + 1, thiefId: thief.id, victimId: victim.id, resource: r };
    }
    log(room, `${thief.name} stole a card from ${victim.name}`);
    room.stealFrom = null;
    room.step = room.afterRobber || 'main';
    room.afterRobber = null;
}

function moveRobber(room, playerId, { hexId, victimId } = {}) {
    const player = findPlayer(room, playerId);
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'robber') return { error: 'The robber is not yours to move right now' };
    const hex = room.map.hexes[Number(hexId)];
    if (!hex) return { error: 'Pick a hex' };
    if (hex.id === room.robber) return { error: 'The robber has to move somewhere new' };
    room.robber = hex.id;
    log(room, `${player.name} moved the robber${hex.number ? ` to a ${hex.number}` : ' to the desert'}`);
    const victims = victimsAt(room, hex.id, playerId);
    if (!victims.length) {
        room.step = room.afterRobber || 'main';
        room.afterRobber = null;
        return {};
    }
    if (victims.length === 1) return steal(room, player, findPlayer(room, victims[0])), {};
    if (victimId && victims.includes(victimId)) return steal(room, player, findPlayer(room, victimId)), {};
    room.step = 'steal';
    room.stealFrom = victims;
    return {};
}

function pickVictim(room, playerId, { victimId } = {}) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'steal' || !room.stealFrom?.includes(victimId)) return { error: 'Pick someone next to the robber' };
    steal(room, findPlayer(room, playerId), findPlayer(room, victimId));
    return {};
}

/* -------------------------------------------------------------- building */

function turnGuard(room, playerId) {
    if (!findPlayer(room, playerId)) return { error: 'Unknown player' };
    if (room.phase !== 'playing') return { error: 'The game is not running' };
    if (room.paused) return { error: 'Game is paused' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    return null;
}

function build(room, playerId, { kind, at } = {}) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    const player = findPlayer(room, playerId);
    at = Number(at);
    if (room.step === 'setup') return placeSetup(room, player, kind, at);

    // A free road from Road Building can go down before the roll, like the
    // card that gave it.
    const freeRoad = kind === 'road' && room.freeRoads > 0;
    if (room.step !== 'main' && !(freeRoad && room.step === 'roll')) {
        return { error: room.step === 'roll' ? 'Roll first' : 'Finish with the robber first' };
    }

    if (kind === 'dev') {
        if (!room.devDeck.length) return { error: 'No development cards left' };
        if (!has(player, COSTS.dev)) return { error: 'A development card costs wool, grain and ore' };
        pay(room, player, COSTS.dev);
        const card = { id: `d${room.devSeq++}`, kind: room.devDeck.pop(), boughtOn: room.stats.turnCount };
        player.dev.push(card);
        log(room, `${player.name} bought a development card`);
        checkWin(room);
        return { card };
    }

    if (kind === 'road') {
        if (player.pieces.roads <= 0) return { error: 'You have no roads left' };
        if (!roadFits(room, playerId, at)) return { error: 'A road has to join one of yours' };
        if (freeRoad) room.freeRoads -= 1;
        else {
            if (!has(player, COSTS.road)) return { error: 'A road costs brick and lumber' };
            pay(room, player, COSTS.road);
        }
        room.roads[at] = playerId;
        player.pieces.roads -= 1;
        if (!player.pieces.roads) room.freeRoads = 0;
        log(room, `${player.name} built a road`);
        updateLongest(room);
        checkWin(room);
        return {};
    }

    if (kind === 'settlement') {
        if (player.pieces.settlements <= 0) return { error: 'You have no settlements left — upgrade one to a city' };
        if (!legalSettlements(room, playerId).includes(at)) {
            return { error: 'A settlement needs your road, and no town on a corner next to it' };
        }
        if (!has(player, COSTS.settlement)) return { error: 'A settlement costs brick, lumber, wool and grain' };
        pay(room, player, COSTS.settlement);
        room.buildings[at] = { playerId, kind: 'settlement' };
        player.pieces.settlements -= 1;
        log(room, `${player.name} built a settlement`);
        updateLongest(room); // a town can cut somebody's road in two
        checkWin(room);
        return {};
    }

    if (kind === 'city') {
        if (player.pieces.cities <= 0) return { error: 'You have no cities left' };
        const b = building(room, at);
        if (!b || b.playerId !== playerId || b.kind !== 'settlement') return { error: 'Upgrade one of your settlements' };
        if (!has(player, COSTS.city)) return { error: 'A city costs 2 grain and 3 ore' };
        pay(room, player, COSTS.city);
        b.kind = 'city';
        player.pieces.cities -= 1;
        player.pieces.settlements += 1;
        log(room, `${player.name} built a city`);
        checkWin(room);
        return {};
    }
    return { error: 'Build what?' };
}

/* --------------------------------------------------------------- trading */

function bankTrade(room, playerId, { give, get } = {}) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'main') return { error: room.step === 'roll' ? 'Roll first' : 'Not now' };
    if (!isResource(give) || !isResource(get) || give === get) return { error: 'Pick two different resources' };
    const player = findPlayer(room, playerId);
    const rate = ratesFor(room, playerId)[give];
    if (player.resources[give] < rate) return { error: `You need ${rate} ${give}` };
    if (room.bank[get] < 1) return { error: `The bank has no ${get} left` };
    player.resources[give] -= rate;
    room.bank[give] += rate;
    player.resources[get] += 1;
    room.bank[get] -= 1;
    room.stats.trades = (room.stats.trades || 0) + 1;
    log(room, `${player.name} traded ${rate} ${give} for 1 ${get}`);
    return {};
}

/** Put a trade to the table. One open at a time, and only from whoever is up. */
function offer(room, playerId, payload = {}) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'main') return { error: room.step === 'roll' ? 'Roll first' : 'Not now' };
    const give = clean(payload.give);
    const get = clean(payload.get);
    if (!count(give) || !count(get)) return { error: 'A trade gives something and gets something' };
    if (RESOURCES.some((r) => give[r] && get[r])) return { error: 'Do not ask for what you are giving' };
    const player = findPlayer(room, playerId);
    if (!has(player, give)) return { error: 'You do not have what you are offering' };
    room.offerSeq = (room.offerSeq || 0) + 1;
    room.offer = { id: room.offerSeq, fromId: playerId, give, get, declined: [] };
    log(room, `${player.name} offers ${describe(give)} for ${describe(get)}`);
    return {};
}

function acceptOffer(room, playerId, { offerId } = {}) {
    const player = findPlayer(room, playerId);
    if (!player || player.out) return { error: 'Unknown player' };
    if (room.paused) return { error: 'Game is paused' };
    const o = room.offer;
    if (!o || o.id !== offerId) return { error: 'That offer is gone' };
    if (o.fromId === playerId) return { error: 'That is your own offer' };
    const from = findPlayer(room, o.fromId);
    if (!has(player, o.get)) return { error: `You need ${describe(o.get)} to take this` };
    if (!has(from, o.give)) {
        room.offer = null;
        return { error: 'They no longer have what they offered' };
    }
    for (const r of RESOURCES) {
        from.resources[r] += o.get[r] - o.give[r];
        player.resources[r] += o.give[r] - o.get[r];
    }
    room.offer = null;
    room.stats.trades = (room.stats.trades || 0) + 1;
    log(room, `${player.name} traded with ${from.name}: ${describe(o.give)} for ${describe(o.get)}`);
    return {};
}

function declineOffer(room, playerId, { offerId } = {}) {
    const o = room.offer;
    if (!o || o.id !== offerId) return {};
    if (o.fromId === playerId) {
        room.offer = null;
        log(room, 'The offer was withdrawn');
        return {};
    }
    if (!o.declined.includes(playerId)) o.declined.push(playerId);
    return {};
}

/* ----------------------------------------------------- development cards */

function playDev(room, playerId, payload = {}) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'roll' && room.step !== 'main') return { error: 'Not now' };
    const player = findPlayer(room, playerId);
    if (room.devPlayed) return { error: 'One development card a turn' };
    const card = player.dev.find((c) => c.id === payload.cardId);
    if (!card) return { error: 'You do not hold that card' };
    if (card.kind === 'point') return { error: 'Victory points count on their own' };
    if (card.boughtOn === room.stats.turnCount) return { error: 'Cards bought this turn wait until your next one' };

    if (card.kind === 'plenty') {
        const picks = Array.isArray(payload.resources) ? payload.resources.slice(0, 2) : [];
        if (picks.length !== 2 || !picks.every(isResource)) return { error: 'Pick two resources' };
        const want = emptyHand();
        for (const r of picks) want[r] += 1;
        if (RESOURCES.some((r) => room.bank[r] < want[r])) return { error: 'The bank does not have those' };
        take(room, player, want);
        log(room, `${player.name} played Year of Plenty: ${describe(want)}`);
    } else if (card.kind === 'monopoly') {
        const r = payload.resource;
        if (!isResource(r)) return { error: 'Pick a resource' };
        let got = 0;
        for (const p of inPlay(room)) {
            if (p.id === playerId) continue;
            got += p.resources[r];
            p.resources[r] = 0;
        }
        player.resources[r] += got;
        log(room, `${player.name} played Monopoly and took every ${r} — ${got} in all`);
    } else if (card.kind === 'roads') {
        if (player.pieces.roads <= 0) return { error: 'You have no roads left to place' };
        room.freeRoads = Math.min(2, player.pieces.roads);
        log(room, `${player.name} played Road Building`);
    } else if (card.kind === 'knight') {
        player.knights += 1;
        log(room, `${player.name} played a Knight`);
        updateArmy(room, player);
        room.afterRobber = room.step;
        room.step = 'robber';
    }
    player.dev = player.dev.filter((c) => c !== card);
    room.devPlayed = true;
    room.stats.devPlayed = (room.stats.devPlayed || 0) + 1;
    checkWin(room);
    return {};
}

function endTurn(room, playerId) {
    const guard = turnGuard(room, playerId);
    if (guard) return guard;
    if (room.step !== 'main') return { error: room.step === 'roll' ? 'Roll first' : 'Finish with the robber first' };
    advance(room);
    return {};
}

/* ------------------------------------------------------- playing for them */

/** The robber's best spot from this player's side: most of everyone else's dots, none of theirs. */
function robberSpot(room, pid) {
    let best = null;
    let bestScore = -Infinity;
    for (const hex of room.map.hexes) {
        if (hex.id === room.robber) continue;
        let score = 0;
        for (const v of hex.vertices) {
            const b = building(room, v);
            if (!b) continue;
            const weight = (b.kind === 'city' ? 2 : 1) * pips(hex.number);
            score += b.playerId === pid ? -weight * 3 : weight;
        }
        if (score > bestScore) [best, bestScore] = [hex.id, score];
    }
    return best;
}

/**
 * Do the least a turn needs and hand it on. Setup is placed at the best spot
 * on offer, because a game cannot start round somebody with no town.
 */
function playFor(room, player) {
    for (let guard = 0; guard < 12 && room.phase === 'playing'; guard++) {
        if (room.step === 'discard') {
            for (const id of Object.keys(room.discards)) discardFor(room, findPlayer(room, id));
            continue;
        }
        if (!isCurrent(room, player.id)) return;
        if (room.step === 'setup') {
            // Their placements only: if this finishes the setup, the first real
            // turn is theirs to play, not the clock's.
            if (room.setup.need === 'road') {
                build(room, player.id, { kind: 'road', at: suggestRoad(room, player.id) });
                if (room.step !== 'setup') return;
                continue;
            }
            build(room, player.id, { kind: 'settlement', at: suggestSettlement(room, player.id, { setup: true }) });
            continue;
        }
        if (room.step === 'roll') roll(room, player.id);
        else if (room.step === 'robber') moveRobber(room, player.id, { hexId: robberSpot(room, player.id) });
        else if (room.step === 'steal') pickVictim(room, player.id, { victimId: room.stealFrom[0] });
        else if (room.step === 'main') return void advance(room);
    }
}

/* ------------------------------------------------------------------ bots */

const bots = require('./bots')({
    RESOURCES, COSTS, log, findPlayer, inPlay, current, has, count,
    legalSettlements, legalRoads, legalCities, suggestSettlement, suggestRoad,
    ratesFor, robberSpot, discardFor, cornerScore,
    build, roll, moveRobber, pickVictim, bankTrade, acceptOffer, declineOffer, playDev, endTurn,
});
/** The fewest seats a game starts with — bots can fill up to it. */
const MIN_PLAYERS = 3;

/* ------------------------------------------------------------- the module */

function privateFor(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player || !player.resources) return null;
    const mine = isCurrent(room, playerId) && room.phase === 'playing';
    const setup = room.step === 'setup';
    return {
        hand: {
            resources: player.resources,
            dev: (player.dev || []).map((c) => ({
                ...c,
                playable: mine && !room.devPlayed && c.kind !== 'point' && c.boughtOn !== room.stats.turnCount,
            })),
            rates: ratesFor(room, playerId),
            points: totalPoints(room, player),
            discard: room.discards?.[playerId] || 0,
            // The spots you could build on right now, so the board can light
            // them up. Empty when it is not your turn.
            legal: mine
                ? {
                      settlement:
                          setup && room.setup.need === 'settlement'
                              ? legalSettlements(room, playerId, { setup: true })
                              : setup || !player.pieces.settlements ? [] : legalSettlements(room, playerId),
                      road:
                          (setup && room.setup.need === 'road') || (!setup && player.pieces.roads)
                              ? legalRoads(room, playerId)
                              : [],
                      city: setup || !player.pieces.cities ? [] : legalCities(room, playerId),
                  }
                : { settlement: [], road: [], city: [] },
            suggest: mine && setup
                ? room.setup.need === 'settlement'
                    ? { kind: 'settlement', at: suggestSettlement(room, playerId, { setup: true }) }
                    : { kind: 'road', at: suggestRoad(room, playerId) }
                : mine && room.step === 'robber'
                  ? { kind: 'robber', at: robberSpot(room, playerId) }
                  : // Nowhere to settle yet: point at the road that opens a corner up.
                    mine && room.step === 'main' && player.pieces.roads && !legalSettlements(room, playerId).length
                    ? { kind: 'road', at: suggestRoad(room, playerId) }
                    : null,
        },
    };
}

module.exports = {
    id: 'notan',
    name: 'notan',
    tagline: 'Settle the island, trade what it grows, first to ten points.',
    minPlayers: MIN_PLAYERS,
    maxPlayers: 6,
    supportsTeams: false,

    createRoom(room) {
        room.map = null;
        room.buildings = {};
        room.roads = {};
        room.robber = null;
        room.bank = null;
        room.devDeck = [];
        room.devSeq = 0;
        room.step = null;
        room.setup = null;
        room.dice = null;
        room.diceSeq = 0;
        room.rolled = false;
        room.discards = {};
        room.discardEndsAt = null;
        room.stealFrom = null;
        room.afterRobber = null;
        room.offer = null;
        room.freeRoads = 0;
        room.devPlayed = false;
        room.longestRoad = null;
        room.largestArmy = null;
        room.roadLengths = {};
        room.lastProduce = null;
        room.lastSteal = null;
        room.target = TARGET;
        if (room.settings.maxPlayers > 6) room.settings.maxPlayers = 6;
        Object.assign(room.stats, { trades: 0, devPlayed: 0, rolls: {}, netWorth: [] });
    },

    addPlayerFields(room, player) {
        player.resources = emptyHand();
        player.dev = [];
        player.knights = 0;
        player.points = 0;
        player.out = false;
        player.pieces = { ...PIECES };
    },

    startGame(room) {
        const live = inPlay(room);
        room.map = makeMap(live.length);
        room.robber = room.map.robber;
        room.bank = Object.fromEntries(RESOURCES.map((r) => [r, SIZES[room.map.size].bank]));
        room.devDeck = makeDevDeck(room.map.size);
        room.buildings = {};
        room.roads = {};
        room.phase = 'playing';
        room.step = 'setup';
        room.setup = { order: setupOrder(room), at: 0, need: 'settlement', vertex: null };
        log(room, 'Place a settlement and a road each — then back round the other way');
        setupSeat(room);
        return {};
    },

    view(room) {
        const ended = room.phase === 'ended';
        return {
            players: room.players.map(({ resources, dev, ...rest }) => ({
                ...rest,
                cardCount: count(resources),
                devCount: (dev || []).length,
                points: ended ? totalPoints(room, { ...rest, dev }) : room.map ? publicPoints(room, rest.id) : 0,
                netWorth: ended ? totalPoints(room, { ...rest, dev }) : room.map ? publicPoints(room, rest.id) : 0,
                roadLength: room.roadLengths?.[rest.id] || 0,
            })),
            map: room.map,
            buildings: room.buildings,
            roads: room.roads,
            robber: room.robber,
            bank: room.bank,
            devLeft: room.devDeck.length,
            step: room.step,
            setup: room.setup && { need: room.setup.need, vertex: room.setup.vertex, round: room.setup.at >= room.setup.order.length / 2 ? 2 : 1 },
            dice: room.dice,
            diceSeq: room.diceSeq,
            rolled: room.rolled,
            discards: room.discards,
            discardEndsAt: room.discardEndsAt,
            stealFrom: room.stealFrom,
            offer: room.offer,
            freeRoads: room.freeRoads,
            devPlayed: room.devPlayed,
            longestRoad: room.longestRoad,
            largestArmy: room.largestArmy,
            lastProduce: room.lastProduce,
            lastSteal: room.lastSteal && { ...room.lastSteal, resource: undefined },
            target: room.target,
            costs: COSTS,
            devNames: DEV_NAMES,
        };
    },

    privateFor,

    blocksIdle: () => false,

    playIdleTurn(room, player) {
        playFor(room, player);
    },

    skipTurn(room, player) {
        playFor(room, player);
    },

    /** Their towns and roads come off the island, their cards back to the bank. */
    removeFromPlay(room, player) {
        const wasCurrent = isCurrent(room, player.id);
        player.out = true;
        if (room.bank) for (const r of RESOURCES) room.bank[r] += player.resources[r] || 0;
        player.resources = emptyHand();
        player.dev = [];
        for (const [v, b] of Object.entries(room.buildings)) if (b.playerId === player.id) delete room.buildings[v];
        for (const [e, id] of Object.entries(room.roads)) if (id === player.id) delete room.roads[e];
        if (room.discards?.[player.id]) delete room.discards[player.id];
        if (room.offer?.fromId === player.id) room.offer = null;
        if (room.stealFrom) room.stealFrom = room.stealFrom.filter((id) => id !== player.id);
        if (room.largestArmy?.playerId === player.id) room.largestArmy = null;
        if (room.phase !== 'playing') return;
        if (room.map) updateLongest(room);
        const left = inPlay(room);
        if (left.length === 1) return finish(room, left[0]);
        if (room.step === 'discard' && !Object.keys(room.discards).length) room.step = 'robber';
        if (room.step === 'steal' && !room.stealFrom?.length) {
            room.step = room.afterRobber || 'main';
            room.stealFrom = null;
        }
        if (room.step === 'setup') {
            if (wasCurrent) setupSeat(room);
            return;
        }
        if (wasCurrent) advance(room);
    },

    resetForRematch(room) {
        this.createRoom(room);
        for (const p of room.players) this.addPlayerFields(room, p);
    },

    /**
     * Two deadlines of its own: a bot's next move, which comes round every
     * second or so while one is due, and a seven nobody discards for.
     */
    timer: (room) =>
        bots.due(room) ||
        (room.step === 'discard' && room.discardEndsAt
            ? {
                  endsAt: room.discardEndsAt,
                  resolve: (r) => {
                      for (const id of Object.keys(r.discards || {})) {
                          const p = findPlayer(r, id);
                          if (p) discardFor(r, p);
                      }
                  },
              }
            : null),

    endEarly(room) {
        const leader = inPlay(room)
            .slice()
            .sort((a, b) => totalPoints(room, b) - totalPoints(room, a))[0];
        if (!leader || !room.map) {
            room.phase = 'ended';
            room.stats.endedAt = Date.now();
            return 'nobody was ahead';
        }
        finish(room, leader, { quiet: true });
        return `${leader.name} was ahead on ${plural(leader.points, 'point')}`;
    },

    actions: {
        'notan:build': (room, pid, p) => build(room, pid, p || {}),
        'notan:roll': (room, pid) => roll(room, pid),
        'notan:discard': (room, pid, p) => discard(room, pid, p || {}),
        'notan:robber': (room, pid, p) => moveRobber(room, pid, p || {}),
        'notan:steal': (room, pid, p) => pickVictim(room, pid, p || {}),
        'notan:bank': (room, pid, p) => bankTrade(room, pid, p || {}),
        'notan:offer': (room, pid, p) => offer(room, pid, p || {}),
        'notan:accept': (room, pid, p) => acceptOffer(room, pid, p || {}),
        'notan:decline': (room, pid, p) => declineOffer(room, pid, p || {}),
        'notan:dev': (room, pid, p) => playDev(room, pid, p || {}),
        'notan:end': (room, pid) => endTurn(room, pid),
        'notan:bots': (room, pid) => bots.fill(room, pid, MIN_PLAYERS),
    },

    // Reached by the tests.
    bots,
    discardFor,
    build,
    roll,
    discard,
    moveRobber,
    pickVictim,
    bankTrade,
    offer,
    acceptOffer,
    declineOffer,
    playDev,
    endTurn,
    roadLength,
    totalPoints,
    publicPoints,
    ratesFor,
    legalSettlements,
    legalRoads,
    suggestSettlement,
    suggestRoad,
    privateFor,
    COSTS,
};
