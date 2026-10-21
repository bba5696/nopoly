// Bots for notan: seats the server plays, so three can start a game two
// people want to play.
//
// A bot is an ordinary player with `bot: true`, always connected and never
// holding a socket. It acts through the same rule functions a person's clicks
// reach, one move at a time on the room's game clock, so the table watches it
// roll, build and end its turn rather than seeing a turn appear all at once.
//
// It plays plainly, not well: build the most valuable thing it can afford,
// trade with the bank toward whatever it is one card short of, take a fair
// trade offered to it, and hand the turn on. Good enough to be a real
// opponent for a new player; nobody's idea of a strategist.

const NAMES = ['Maple', 'Juniper', 'Pebble', 'Clover', 'Bramble', 'Willow', 'Thistle', 'Fennel'];
/** How long a bot takes over each move — slow enough to follow. */
const BOT_MS = 1100;
/** A turn that has not ended after this many moves is ended. */
const MAX_MOVES = 14;

module.exports = function makeBots(api) {
    const {
        RESOURCES, COSTS, log, findPlayer, inPlay, current, has, count,
        legalSettlements, legalRoads, legalCities, suggestSettlement, suggestRoad,
        ratesFor, robberSpot, discardFor, cornerScore,
        build, roll, moveRobber, pickVictim, bankTrade, acceptOffer, declineOffer, playDev, endTurn,
    } = api;

    const isBot = (p) => !!p?.bot;
    const people = (room) => room.players.some((p) => !p.bot && p.connected && !p.out);

    /** Is a bot holding the table up right now? */
    function work(room) {
        if (room.phase !== 'playing' || room.paused) return false;
        // Nobody human left to play for: stop, rather than keep a room busy.
        if (!people(room)) return false;
        if (room.step === 'discard') return Object.keys(room.discards || {}).some((id) => isBot(findPlayer(room, id)));
        const o = room.offer;
        if (o && room.players.some((p) => isBot(p) && !p.out && p.id !== o.fromId && !o.declined.includes(p.id))) return true;
        const up = current(room);
        return isBot(up) && !up.out;
    }

    /** What it is saving for, in order of worth. */
    function goal(room, bot) {
        if (bot.pieces.cities && legalCities(room, bot.id).length) return COSTS.city;
        if (bot.pieces.settlements && legalSettlements(room, bot.id).length) return COSTS.settlement;
        if (bot.pieces.roads && legalRoads(room, bot.id).length) return COSTS.road;
        return COSTS.dev;
    }
    const missing = (bot, cost) => RESOURCES.filter((r) => (bot.resources[r] || 0) < (cost[r] || 0));

    /** One bank trade toward the goal, giving only what the goal does not need. */
    function tradeToward(room, bot, cost) {
        const short = missing(bot, cost);
        if (short.length !== 1) return false;
        const rates = ratesFor(room, bot.id);
        const spare = RESOURCES.find((r) => r !== short[0] && (bot.resources[r] || 0) - (cost[r] || 0) >= rates[r]);
        if (!spare || room.bank[short[0]] < 1) return false;
        return !bankTrade(room, bot.id, { give: spare, get: short[0] }).error;
    }

    function playCard(room, bot) {
        if (room.devPlayed) return false;
        const ready = bot.dev.filter((c) => c.kind !== 'point' && c.boughtOn !== room.stats.turnCount);
        const want = goal(room, bot);
        for (const card of ready) {
            if (card.kind === 'roads' && legalRoads(room, bot.id).length) return !playDev(room, bot.id, { cardId: card.id }).error;
            if (card.kind === 'plenty') {
                const need = missing(bot, want);
                const picks = [need[0] || 'ore', need[1] || need[0] || 'grain'];
                if (!playDev(room, bot.id, { cardId: card.id, resources: picks }).error) return true;
            }
            if (card.kind === 'monopoly') {
                const need = missing(bot, want)[0] || 'ore';
                return !playDev(room, bot.id, { cardId: card.id, resource: need }).error;
            }
            if (card.kind === 'knight' && Math.random() < 0.5) return !playDev(room, bot.id, { cardId: card.id }).error;
        }
        return false;
    }

    /** One move of its own turn. */
    function turnMove(room, bot) {
        bot.botMoves = (bot.botMoves || 0) + 1;
        if (room.step === 'setup') {
            if (room.setup.need === 'settlement') {
                build(room, bot.id, { kind: 'settlement', at: suggestSettlement(room, bot.id, { setup: true }) });
            } else build(room, bot.id, { kind: 'road', at: suggestRoad(room, bot.id) });
            return;
        }
        if (room.step === 'roll') {
            bot.botMoves = 0;
            // The robber on its own land is worth a knight before the dice.
            const blocked = room.map.hexes[room.robber].vertices.some((v) => room.buildings[v]?.playerId === bot.id);
            const knight = bot.dev.find((c) => c.kind === 'knight' && c.boughtOn !== room.stats.turnCount);
            if (blocked && knight && !room.devPlayed && !playDev(room, bot.id, { cardId: knight.id }).error) return;
            if (room.freeRoads > 0 && legalRoads(room, bot.id).length) {
                build(room, bot.id, { kind: 'road', at: suggestRoad(room, bot.id) });
                return;
            }
            roll(room, bot.id);
            return;
        }
        if (room.step === 'robber') {
            moveRobber(room, bot.id, { hexId: robberSpot(room, bot.id) });
            return;
        }
        if (room.step === 'steal') {
            // Whoever is holding the most is the likeliest to have something good.
            const victim = room.stealFrom
                .map((id) => findPlayer(room, id))
                .sort((a, b) => count(b.resources) - count(a.resources))[0];
            pickVictim(room, bot.id, { victimId: victim.id });
            return;
        }
        if (room.step !== 'main') return;
        if (bot.botMoves > MAX_MOVES) return void endTurn(room, bot.id);

        if (room.freeRoads > 0 && legalRoads(room, bot.id).length) {
            build(room, bot.id, { kind: 'road', at: suggestRoad(room, bot.id) });
            return;
        }
        const cities = legalCities(room, bot.id);
        if (bot.pieces.cities && cities.length && has(bot, COSTS.city)) {
            const best = cities.sort((a, b) => cornerScore(room, b) - cornerScore(room, a))[0];
            if (!build(room, bot.id, { kind: 'city', at: best }).error) return;
        }
        if (bot.pieces.settlements && has(bot, COSTS.settlement) && legalSettlements(room, bot.id).length) {
            if (!build(room, bot.id, { kind: 'settlement', at: suggestSettlement(room, bot.id) }).error) return;
        }
        if (playCard(room, bot)) return;
        // A road when there is nowhere left to settle, or now and then anyway.
        const roadUseful = !legalSettlements(room, bot.id).length || Math.random() < 0.3;
        if (bot.pieces.roads && roadUseful && has(bot, COSTS.road) && legalRoads(room, bot.id).length) {
            if (!build(room, bot.id, { kind: 'road', at: suggestRoad(room, bot.id) }).error) return;
        }
        if (has(bot, COSTS.dev) && room.devDeck.length && goal(room, bot) === COSTS.dev) {
            if (!build(room, bot.id, { kind: 'dev' }).error) return;
        }
        if (tradeToward(room, bot, goal(room, bot))) return;
        endTurn(room, bot.id);
    }

    /** A trade put to the table: take it if it is fair and it helps. */
    function answer(room, bot) {
        const o = room.offer;
        const helps = RESOURCES.some((r) => o.give[r] && missing(bot, goal(room, bot)).includes(r));
        const fair = count(o.give) >= count(o.get);
        if (has(bot, o.get) && helps && fair) acceptOffer(room, bot.id, { offerId: o.id });
        else declineOffer(room, bot.id, { offerId: o.id });
    }

    /** One bot move, whichever bot is due. */
    function act(room) {
        if (!work(room)) return;
        if (room.step === 'discard') {
            for (const id of Object.keys(room.discards)) {
                const p = findPlayer(room, id);
                if (isBot(p)) discardFor(room, p);
            }
            return;
        }
        const o = room.offer;
        if (o) {
            const asked = room.players.find((p) => isBot(p) && !p.out && p.id !== o.fromId && !o.declined.includes(p.id));
            if (asked) return answer(room, asked);
        }
        const up = current(room);
        if (isBot(up)) turnMove(room, up);
    }

    /** The clock entry that runs it: one move every BOT_MS while a bot is due. */
    function due(room) {
        if (!work(room)) {
            room.botAt = null;
            return null;
        }
        if (!room.botAt) room.botAt = Date.now() + BOT_MS;
        return {
            endsAt: room.botAt,
            resolve: (r) => {
                r.botAt = null;
                act(r);
            },
        };
    }

    /** Fill the empty seats up to `upTo` with bots. Host-only, lobby-only. */
    function fill(room, playerId, upTo) {
        if (room.hostId !== playerId) return { error: 'Only the host can add bots' };
        if (room.phase !== 'waiting') return { error: 'Bots join before the game starts' };
        const taken = new Set(room.players.map((p) => p.name));
        const names = NAMES.filter((n) => !taken.has(n));
        const engine = require('../engine');
        while (room.players.length < upTo && names.length) {
            const res = engine.addPlayer(room, { name: names.shift() });
            if (res.error) return res;
            res.player.bot = true;
        }
        log(room, 'Bots took the empty seats');
        return {};
    }

    return { work, act, due, fill, isBot };
};
