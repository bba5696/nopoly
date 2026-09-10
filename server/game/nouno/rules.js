// nouno — the card game, as a rules module.
//
// Everything a room does that isn't the rules (codes, seats, reconnecting,
// presence, chat, kick, the turn clock, snapshots, past games) belongs to
// engine.js and is shared with the board game. What is here is only what a
// deck of cards makes different.
//
// The one structural difference from the board game: a hand is secret. A board
// is on the table and one broadcast tells everybody the truth, but a hand is
// true for exactly one person, so the state that goes to the room carries
// counts and the cards go down a private channel — see `view` and `privateFor`,
// and `broadcast` in index.js.

const { SUITS, SUIT_IDS, makeDeck, nameOf, playable, isWild, scoreOf } = require('./deck');

/** How many each player starts with. */
const HAND_SIZE = 7;
/** How many are drawn for a Plus Two and an Any Plus Four. */
const DRAW_FOR = { plus2: 2, any4: 4 };

const log = (room, text) => require('../engine').log(room, text);
const findPlayer = (room, id) => room.players.find((p) => p.id === id) || null;
/** Still holding cards, and still at the table. */
const inPlay = (room) => room.players.filter((p) => !p.resigned && !p.out);
const isCurrent = (room, id) => room.players[room.turnIndex]?.id === id;

/* ------------------------------------------------------------ the mechanics */

/**
 * Take `n` off the stock, turning the pile back over when it runs out.
 *
 * The top card stays where it is — it is the card in play, and shuffling it
 * back in would leave the game following a card nobody can see. If both are
 * empty the draw is simply short, because a table holding every card between
 * them is a game to finish rather than a loop to spin in.
 */
function draw(room, n) {
    const taken = [];
    for (let i = 0; i < n; i++) {
        if (!room.stock.length) {
            const top = room.pile.pop();
            if (!room.pile.length) {
                if (top) room.pile.push(top);
                break;
            }
            room.stock = require('../cards').shuffle(room.pile);
            room.pile = top ? [top] : [];
        }
        taken.push(room.stock.pop());
    }
    return taken;
}

const topOf = (room) => room.pile[room.pile.length - 1] || null;

/**
 * Put cards in a hand, and take back the last-card call if it no longer
 * applies.
 *
 * The call is about the hand you are holding now, not a badge you keep for the
 * rest of the game: draw your way back up and you have to call again on the
 * way down. Every route a card takes into a hand goes through here, because
 * the one that doesn't is the one that grants somebody permanent immunity.
 */
function giveCards(room, player, cards) {
    player.hand.push(...cards);
    if (player.hand.length > 2) room.saidLast = room.saidLast.filter((id) => id !== player.id);
    return cards;
}

/** The seat `steps` along, in the direction of play, skipping anyone out. */
function seatAfter(room, steps = 1) {
    const live = inPlay(room);
    if (!live.length) return room.turnIndex;
    let index = room.turnIndex;
    for (let moved = 0; moved < steps; ) {
        index = (index + room.direction + room.players.length) % room.players.length;
        const player = room.players[index];
        if (player && !player.resigned && !player.out) moved += 1;
    }
    return index;
}

function advance(room, steps = 1) {
    room.turnIndex = seatAfter(room, steps);
    room.drawnThisTurn = false;
    room.stats.turnCount = (room.stats.turnCount || 0) + 1;
    snapshotHands(room);
}

/** Hand sizes over the game, for the end screen's chart. */
function snapshotHands(room) {
    if (!room.stats.hands) room.stats.hands = [];
    const values = {};
    for (const p of room.players) values[p.id] = (p.hand || []).length;
    room.stats.hands.push({ turn: room.stats.turnCount || 0, values });
}

/**
 * Settle up when somebody goes out.
 *
 * Points are what everyone else is still holding, which is the traditional
 * count and the only one that makes a short hand feel like the achievement it
 * is. One round decides it for now; `scores` is kept per player so "first to
 * five hundred" is later a setting rather than a migration.
 */
function finish(room, winner) {
    room.phase = 'ended';
    room.winnerId = winner.id;
    room.stats.endedAt = Date.now();
    let points = 0;
    for (const p of room.players) {
        const held = (p.hand || []).reduce((sum, c) => sum + scoreOf(c), 0);
        p.points = held;
        if (p.id !== winner.id) points += held;
    }
    room.scores[winner.id] = (room.scores[winner.id] || 0) + points;
    snapshotHands(room);
    log(room, `${winner.name} went out — ${points} points`);
}

/**
 * Going down to one card without calling it leaves you owing two — but not
 * yet.
 *
 * The penalty used to land inside the same action as the play, which meant
 * there was no moment in which you could be on one card and quiet. Reach for
 * the button a half-second after playing and the cards were already in your
 * hand, and the call came back "Not yet" — the game punishing you for a window
 * it never opened.
 *
 * So the debt is recorded here and collected by the next thing that happens at
 * the table. That is the window everyone reaches for anyway, it is somebody
 * else's move rather than a clock, and it is the same rule the card game has
 * always had: you are safe until you are caught.
 */
function oweLastCard(room, player) {
    if ((player.hand || []).length !== 1 || room.saidLast.includes(player.id)) return;
    room.pendingLast = player.id;
    log(room, `${player.name} is down to one card, and quiet about it`);
}

/** Collect it, if it is still owed. Called before anything else happens. */
function settleLast(room) {
    const owed = room.pendingLast;
    if (!owed) return;
    room.pendingLast = null;
    const player = findPlayer(room, owed);
    // Drawn back up, or called in time, and there is nothing to collect.
    if (!player || (player.hand || []).length !== 1 || room.saidLast.includes(owed)) return;
    giveCards(room, player, draw(room, 2));
    log(room, `${player.name} never called it — drew two`);
}

/** What a played card does to everyone else. */
function applyEffect(room, player, card) {
    if (card.kind === 'turn') {
        // With two left, turning play around comes back to you — which is what
        // a Halt does, so that is what it does.
        if (inPlay(room).length === 2) return advance(room, 2);
        room.direction *= -1;
        log(room, 'Play turns around');
        return advance(room, 1);
    }
    if (card.kind === 'halt') {
        const skipped = room.players[seatAfter(room, 1)];
        if (skipped) log(room, `${skipped.name} misses a turn`);
        return advance(room, 2);
    }
    if (card.kind === 'plus2' || card.kind === 'any4') {
        const victim = room.players[seatAfter(room, 1)];
        const n = DRAW_FOR[card.kind];
        if (victim) {
            giveCards(room, victim, draw(room, n));
            log(room, `${victim.name} draws ${n} and misses a turn`);
        }
        return advance(room, 2);
    }
    return advance(room, 1);
}

/* ---------------------------------------------------------------- actions */

function playCard(room, playerId, { cardId, suit } = {}) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.phase !== 'playing') return { error: 'The game is not running' };
    if (room.paused) return { error: 'Game is paused' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (room.choosing) return { error: 'Name a suit first' };

    settleLast(room);
    const index = (player.hand || []).findIndex((c) => c.id === cardId);
    if (index < 0) return { error: 'You do not hold that card' };
    const card = player.hand[index];
    if (!playable(card, topOf(room), room.active)) return { error: `You cannot play the ${nameOf(card)}` };

    player.hand.splice(index, 1);
    room.pile.push(card);
    room.stats.played = (room.stats.played || 0) + 1;
    log(room, `${player.name} played the ${nameOf(card)}`);

    if (!player.hand.length) return finish(room, player), {};

    if (isWild(card)) {
        room.stats.wilds = (room.stats.wilds || 0) + 1;
        // Two steps rather than one payload: the suit is a decision, and a
        // client that has not made it yet must not be able to skip it. Set
        // before naming, not after — naming is the same call either way, and
        // it refuses when there is nothing to name.
        room.choosing = { playerId, cardId: card.id };
        if (SUIT_IDS.includes(suit)) return chooseSuit(room, playerId, { suit });
        return {};
    }

    room.active = card.suit;
    oweLastCard(room, player);
    applyEffect(room, player, card);
    return {};
}

function chooseSuit(room, playerId, { suit } = {}) {
    if (!room.choosing || room.choosing.playerId !== playerId) return { error: 'Nothing to name' };
    if (!SUIT_IDS.includes(suit)) return { error: 'That is not a suit' };
    const player = findPlayer(room, playerId);
    const card = topOf(room);
    room.choosing = null;
    room.active = suit;
    log(room, `${player.name} named ${SUITS[suit].name}`);
    oweLastCard(room, player);
    applyEffect(room, player, card);
    return {};
}

/**
 * Draw one. If it can be played you may play it; otherwise the turn passes.
 * Not draw-until-playable — that is a house rule, and there are none yet.
 */
function drawCard(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    if (room.phase !== 'playing') return { error: 'The game is not running' };
    if (room.paused) return { error: 'Game is paused' };
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (room.choosing) return { error: 'Name a suit first' };
    if (room.drawnThisTurn) return { error: 'You have already drawn' };

    settleLast(room);

    const [card] = draw(room, 1);
    if (!card) {
        log(room, `${player.name} found nothing left to draw`);
        advance(room, 1);
        return {};
    }
    giveCards(room, player, [card]);
    room.drawnThisTurn = true;
    log(room, `${player.name} drew a card`);
    // Nothing to play means nothing to decide.
    if (!playable(card, topOf(room), room.active)) advance(room, 1);
    return {};
}

/** Give up the turn after drawing, rather than play what came up. */
function pass(room, playerId) {
    if (!isCurrent(room, playerId)) return { error: 'Not your turn' };
    if (room.choosing) return { error: 'Name a suit first' };
    if (!room.drawnThisTurn) return { error: 'Draw first' };
    const player = findPlayer(room, playerId);
    settleLast(room);
    oweLastCard(room, player);
    advance(room, 1);
    return {};
}

/**
 * Call it — before you play your second-to-last card, or in the window after,
 * up until somebody else moves.
 */
function sayLast(room, playerId) {
    const player = findPlayer(room, playerId);
    if (!player) return { error: 'Unknown player' };
    const held = (player.hand || []).length;
    const owing = room.pendingLast === playerId;
    if (held > 2 && !owing)
        return { error: `Only on your last two cards — you are holding ${held}` };
    if (room.saidLast.includes(playerId)) return {};
    room.saidLast.push(playerId);
    if (owing) {
        room.pendingLast = null;
        log(room, `${player.name}: last card! — just in time`);
    } else {
        log(room, `${player.name}: last card!`);
    }
    return {};
}

/* ------------------------------------------------------------- the module */

module.exports = {
    id: 'nouno',
    name: 'nouno',
    tagline: 'Shed your hand first. Halt, Turn, and name the suit.',
    minPlayers: 2,
    supportsTeams: false,

    createRoom(room) {
        room.stock = [];
        room.pile = [];
        room.active = null;        // the suit being followed, which a wild changes
        room.direction = 1;
        room.choosing = null;      // { playerId, cardId } while a suit is being named
        room.saidLast = [];        // who has called their last card
        room.pendingLast = null;   // who went quiet to one card, until someone moves
        room.drawnThisTurn = false;
        room.scores = {};
        Object.assign(room.stats, { played: 0, wilds: 0, hands: [] });
    },

    addPlayerFields(room, player) {
        player.hand = [];
        player.points = 0;
        player.out = false;
    },

    startGame(room) {
        room.stock = makeDeck();
        room.pile = [];
        room.direction = 1;
        room.saidLast = [];
        room.pendingLast = null;
        room.choosing = null;
        room.drawnThisTurn = false;
        const size = room.settings.handSize || HAND_SIZE;
        for (const player of room.players) {
            player.hand = draw(room, size);
            player.out = false;
            player.points = 0;
        }
        // Turn one over to start on. A wild on the bottom of the pile would
        // leave nothing being followed, so it goes back and another comes up.
        let first = draw(room, 1)[0];
        while (first && isWild(first)) {
            room.stock.unshift(first);
            first = draw(room, 1)[0];
        }
        room.pile = first ? [first] : [];
        room.active = first?.suit || null;
        room.phase = 'playing';
        log(room, `The ${nameOf(first)} starts the pile`);
        snapshotHands(room);
        return {};
    },

    /**
     * What the room is told. Counts, never cards — this is the payload every
     * player and every spectator receives, so a hand in here is a hand on
     * everybody's screen.
     */
    view(room) {
        return {
            // Built key by key rather than spread-and-delete. A spread with
            // `hand: undefined` happens to survive JSON, but the one line in
            // this project that must never leak should not depend on how an
            // encoder treats undefined.
            players: room.players.map(({ hand, ...rest }) => ({
                ...rest,
                handCount: (hand || []).length,
                netWorth: rest.points || 0,
            })),
            top: topOf(room),
            active: room.active,
            direction: room.direction,
            stockCount: room.stock.length,
            pileCount: room.pile.length,
            choosing: room.choosing,
            saidLast: room.saidLast,
            pendingLast: room.pendingLast,
            drawnThisTurn: room.drawnThisTurn,
            scores: room.scores,
            suits: SUITS,
            handSize: room.settings.handSize || HAND_SIZE,
        };
    },

    /** Your own cards, down a channel only you are on. */
    privateFor(room, playerId) {
        const player = findPlayer(room, playerId);
        if (!player) return null;
        return { hand: player.hand || [] };
    },

    /** Nothing here needs settling before somebody else can act for you. */
    blocksIdle: () => false,

    /** Draw one and pass: never an advantage, never a decision made for them. */
    playIdleTurn(room, player) {
        if (room.choosing?.playerId === player.id) {
            // Name whatever they hold most of, which is the choice they would
            // most likely have made.
            const counts = {};
            for (const c of player.hand) if (c.suit) counts[c.suit] = (counts[c.suit] || 0) + 1;
            const best = SUIT_IDS.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
            chooseSuit(room, player.id, { suit: best });
            return;
        }
        settleLast(room);
        if (!room.drawnThisTurn) drawCard(room, player.id);
        if (isCurrent(room, player.id)) {
            room.drawnThisTurn = true;
            pass(room, player.id);
        }
    },

    skipTurn(room) {
        advance(room, 1);
    },

    /** Their cards go back to the bottom of the stock and play carries on. */
    removeFromPlay(room, player) {
        const wasCurrent = isCurrent(room, player.id);
        room.stock.unshift(...(player.hand || []));
        player.hand = [];
        player.out = true;
        room.saidLast = room.saidLast.filter((id) => id !== player.id);
        if (room.pendingLast === player.id) room.pendingLast = null;
        if (room.choosing?.playerId === player.id) room.choosing = null;
        const left = inPlay(room);
        if (left.length === 1) return finish(room, left[0]);
        if (room.phase === 'playing' && wasCurrent) advance(room, 1);
    },

    resetForRematch(room) {
        this.createRoom(room);
        for (const p of room.players) this.addPlayerFields(room, p);
    },

    /** No clock of its own — the turn clock in engine.js is the only deadline. */
    timer: () => null,

    actions: {
        'nouno:play': (room, playerId, payload) => playCard(room, playerId, payload || {}),
        'nouno:suit': (room, playerId, payload) => chooseSuit(room, playerId, payload || {}),
        'nouno:draw': (room, playerId) => drawCard(room, playerId),
        'nouno:pass': (room, playerId) => pass(room, playerId),
        'nouno:last': (room, playerId) => sayLast(room, playerId),
    },

    // Reached by the tests, which have no socket to go through.
    playCard,
    chooseSuit,
    drawCard,
    pass,
    sayLast,
    settleLast,
    draw,
    topOf,
    HAND_SIZE,
};
