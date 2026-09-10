// nouno: the deck, the rules, and the seam holding it to a room.
//
// The rules are worth pinning down because they are the parts everybody at the
// table already has an opinion about — what a Turn does with two players, what
// happens when the stock runs out, whether you may play the card you just
// drew. The seam is worth pinning down because it is new: a room is now two
// halves, and the half that isn't the game has to work the same either way.
const e = require('../game/engine');
const nouno = require('../game/nouno/rules');
const { makeDeck, playable, nameOf, scoreOf, SUIT_IDS } = require('../game/nouno/deck');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names = ['Ada', 'Bo', 'Cy']) {
    const r = e.createRoom('NUNO', { game: 'nouno' });
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    return { r, p };
}

function started(names) {
    const { r, p } = mk(names);
    e.startGame(r, p[names ? names[0] : 'Ada'].id);
    return { r, p };
}

/** Deal a known hand and a known pile, so a rule can be asked one question. */
function stage(r, player, hand, top, active) {
    player.hand = hand;
    r.pile = [top];
    r.active = active ?? top.suit;
    r.turnIndex = r.players.indexOf(player);
    r.drawnThisTurn = false;
    r.choosing = null;
}
const card = (suit, kind, value = null) => ({ id: `${suit}-${kind}-${value}-x`, suit, kind, value });
const num = (suit, value) => card(suit, 'num', value);

/* --------------------------------------------------------------- the deck */
{
    const deck = makeDeck();
    ok('a hundred and eight cards', deck.length === 108, String(deck.length));
    const of = (fn) => deck.filter(fn).length;
    ok('twenty-five to a suit', SUIT_IDS.every((s) => of((c) => c.suit === s) === 25));
    ok('one nought each', SUIT_IDS.every((s) => of((c) => c.suit === s && c.kind === 'num' && c.value === 0) === 1));
    ok('two of every other number', SUIT_IDS.every((s) => of((c) => c.suit === s && c.kind === 'num' && c.value === 7) === 2));
    ok('two Halts a suit', of((c) => c.kind === 'halt') === 8);
    ok('two Turns a suit', of((c) => c.kind === 'turn') === 8);
    ok('two Plus Twos a suit', of((c) => c.kind === 'plus2') === 8);
    ok('four Any and four Any Plus Four', of((c) => c.kind === 'any') === 4 && of((c) => c.kind === 'any4') === 4);
    ok('every card has its own id', new Set(deck.map((c) => c.id)).size === 108);
    ok('the wilds carry no suit', deck.filter((c) => c.suit === null).length === 8);

    // Two decks are two decks: one game's cards can't be another's.
    const second = makeDeck();
    ok('a fresh deck each time', second !== deck && second[0] !== deck[0]);
    ok('and shuffled', second.map((c) => c.id).join() !== deck.map((c) => c.id).join());

    ok('a number is worth its face', scoreOf(num('ember', 7)) === 7);
    ok('an action is worth twenty', scoreOf(card('ember', 'halt')) === 20);
    ok('a wild is worth fifty', scoreOf(card(null, 'any4')) === 50);
    ok('and it reads as a name', nameOf(num('ember', 7)) === 'Ember 7', nameOf(num('ember', 7)));
}

/* -------------------------------------------------------------- playability */
{
    const top = num('ember', 5);
    ok('same suit plays', playable(num('ember', 9), top, 'ember'));
    ok('same number plays', playable(num('tide', 5), top, 'ember'));
    ok('neither does not', !playable(num('tide', 9), top, 'ember'));
    ok('a wild always plays', playable(card(null, 'any'), top, 'ember'));
    ok('an action follows its suit', playable(card('ember', 'halt'), top, 'ember'));
    ok('and follows its own kind', playable(card('tide', 'halt'), card('ember', 'halt'), 'ember'));
    // A wild changes what is being followed without changing what is lying there.
    ok('the named suit is what counts', playable(num('tide', 2), card(null, 'any'), 'tide'));
    ok('not the card underneath', !playable(num('ember', 2), card(null, 'any'), 'tide'));
}

/* ------------------------------------------------------------ dealing */
{
    const { r, p } = started();
    ok('seven each', r.players.every((x) => x.hand.length === 7), r.players.map((x) => x.hand.length).join());
    ok('a card starts the pile', r.pile.length === 1);
    ok('and it is not a wild', r.pile[0].suit !== null, nameOf(r.pile[0]));
    ok('the suit being followed is its own', r.active === r.pile[0].suit);
    ok('every card is somewhere', r.stock.length + r.pile.length + r.players.reduce((n, x) => n + x.hand.length, 0) === 108);
    ok('it is somebody s turn', r.phase === 'playing' && r.turnIndex === 0);
    ok('the seam dealt it, not startGame', typeof p.Ada.hand[0].id === 'string');
}

/* ------------------------------------------------------------- playing */
{
    const { r, p } = started();
    stage(r, p.Ada, [num('ember', 5), num('tide', 9)], num('ember', 2));

    ok('not your turn is refused', !!nouno.playCard(r, p.Bo.id, { cardId: p.Bo.hand[0]?.id }).error);
    ok('a card you do not hold is refused', !!nouno.playCard(r, p.Ada.id, { cardId: 'nope' }).error);
    ok('an unplayable card is refused', /cannot play/.test(nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[1].id }).error || ''));

    nouno.sayLast(r, p.Ada.id);
    const res = nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('a playable one goes down', !res.error, res.error);
    ok('it is on the pile', nouno.topOf(r).value === 5);
    ok('and out of the hand', p.Ada.hand.length === 1, String(p.Ada.hand.length));
    ok('play moved on', r.players[r.turnIndex].id === p.Bo.id);
    ok('the feed says so', r.log.some((l) => /Ada played the Ember 5/.test(l.text)));
}

/* ---------------------------------------------------------- Halt and Turn */
{
    const { r, p } = started();
    stage(r, p.Ada, [card('ember', 'halt'), num('tide', 1)], num('ember', 2));
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('a Halt skips the next player', r.players[r.turnIndex].id === p.Cy.id, r.players[r.turnIndex].name);
}
{
    const { r, p } = started();
    stage(r, p.Ada, [card('ember', 'turn'), num('tide', 1)], num('ember', 2));
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('a Turn reverses the order', r.players[r.turnIndex].id === p.Cy.id, r.players[r.turnIndex].name);
    ok('and the direction is kept', r.direction === -1);
}
{
    // The rule everybody forgets: with two left, turning play around comes
    // straight back to you, which is what a Halt does.
    const { r, p } = started(['Ada', 'Bo']);
    stage(r, p.Ada, [card('ember', 'turn'), num('tide', 1)], num('ember', 2));
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('with two players a Turn is a Halt', r.players[r.turnIndex].id === p.Ada.id, r.players[r.turnIndex].name);
}

/* ------------------------------------------------------------ the draws */
{
    const { r, p } = started();
    stage(r, p.Ada, [card('ember', 'plus2'), num('tide', 1)], num('ember', 2));
    const before = p.Bo.hand.length;
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('a Plus Two costs the next player two', p.Bo.hand.length === before + 2, String(p.Bo.hand.length - before));
    ok('and their turn', r.players[r.turnIndex].id === p.Cy.id);
}

/* ------------------------------------------------------------ the wilds */
{
    const { r, p } = started();
    stage(r, p.Ada, [card(null, 'any'), num('tide', 1)], num('ember', 2));
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('a wild waits to be named', !!r.choosing && r.choosing.playerId === p.Ada.id);
    ok('and play has not moved on', r.players[r.turnIndex].id === p.Ada.id);
    ok('nobody else may name it', !!nouno.chooseSuit(r, p.Bo.id, { suit: 'tide' }).error);
    ok('nor may anyone play through it', !!nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id }).error);
    ok('a suit that is not one is refused', !!nouno.chooseSuit(r, p.Ada.id, { suit: 'purple' }).error);

    ok('naming it works', !nouno.chooseSuit(r, p.Ada.id, { suit: 'tide' }).error);
    ok('the suit is what carries on', r.active === 'tide');
    ok('and play moves on', r.players[r.turnIndex].id === p.Bo.id);
    ok('the feed names it', r.log.some((l) => /named Tide/.test(l.text)));
}
{
    // Naming it in the same breath, which is what the client does.
    const { r, p } = started();
    stage(r, p.Ada, [card(null, 'any4'), num('tide', 1)], num('ember', 2));
    const before = p.Bo.hand.length;
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id, suit: 'fern' });
    ok('a wild may be named as it is played', r.active === 'fern' && !r.choosing);
    ok('an Any Plus Four costs four', p.Bo.hand.length === before + 4, String(p.Bo.hand.length - before));
    ok('and their turn', r.players[r.turnIndex].id === p.Cy.id);
}

/* ------------------------------------------------------------- drawing */
{
    const { r, p } = started();
    stage(r, p.Ada, [num('tide', 9)], num('ember', 2));
    // Make sure what comes up cannot be played, so the turn has to pass.
    r.stock = [num('fern', 4)];
    nouno.drawCard(r, p.Ada.id);
    ok('a card is drawn', p.Ada.hand.length === 2);
    ok('and an unplayable one ends the turn', r.players[r.turnIndex].id === p.Bo.id);

    const { r: r2, p: p2 } = started();
    stage(r2, p2.Ada, [num('tide', 9)], num('ember', 2));
    r2.stock = [num('ember', 4)];
    nouno.drawCard(r2, p2.Ada.id);
    ok('a playable one leaves the turn open', r2.players[r2.turnIndex].id === p2.Ada.id);
    ok('drawing twice is refused', /already drawn/.test(nouno.drawCard(r2, p2.Ada.id).error || ''));
    ok('and it can then be played', !nouno.playCard(r2, p2.Ada.id, { cardId: p2.Ada.hand[1].id }).error);

    const { r: r3, p: p3 } = started();
    stage(r3, p3.Ada, [num('tide', 9)], num('ember', 2));
    ok('passing before drawing is refused', /Draw first/.test(nouno.pass(r3, p3.Ada.id).error || ''));
    r3.stock = [num('ember', 4)];
    nouno.drawCard(r3, p3.Ada.id);
    ok('and passing after it works', !nouno.pass(r3, p3.Ada.id).error && r3.players[r3.turnIndex].id === p3.Bo.id);
}

/* -------------------------------------------------- the stock running out */
{
    const { r, p } = started();
    stage(r, p.Ada, [num('tide', 9)], num('ember', 2));
    r.stock = [];
    r.pile = [num('ember', 2), num('fern', 3), num('solar', 4)];
    const total = r.pile.length;
    nouno.drawCard(r, p.Ada.id);
    ok('the pile turns back over', r.stock.length + r.pile.length + 1 === total, `${r.stock.length}/${r.pile.length}`);
    ok('and the card in play stays in play', r.pile.length === 1 && nouno.topOf(r).value === 4, nameOf(nouno.topOf(r)));

    // Nothing anywhere: the draw comes up short rather than spinning forever.
    const { r: r2, p: p2 } = started();
    stage(r2, p2.Ada, [num('tide', 9)], num('ember', 2));
    r2.stock = [];
    r2.pile = [num('ember', 2)];
    ok('an empty table does not loop', nouno.draw(r2, 3).length === 0);
}

/* ---------------------------------------------------------- the last card */
{
    const { r, p } = started();
    stage(r, p.Ada, [num('ember', 5), num('tide', 9)], num('ember', 2));
    ok('you may say it on two', !nouno.sayLast(r, p.Ada.id).error);
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('and nothing is drawn for it', p.Ada.hand.length === 1, String(p.Ada.hand.length));

    // Going quiet is a debt, not an instant fine: it is collected by the next
    // thing that happens, which is the window you get to call it in.
    const { r: r2, p: p2 } = started();
    stage(r2, p2.Ada, [num('ember', 5), num('tide', 9)], num('ember', 2));
    nouno.playCard(r2, p2.Ada.id, { cardId: p2.Ada.hand[0].id });
    ok('going quiet does not cost you on the spot', p2.Ada.hand.length === 1, String(p2.Ada.hand.length));
    ok('but it is owed', r2.pendingLast === p2.Ada.id);
    ok('and the feed says they are on one', r2.log.some((l) => /down to one card, and quiet/.test(l.text)));
    ok('calling it in the window is allowed', !nouno.sayLast(r2, p2.Ada.id).error);
    ok('and clears the debt', r2.pendingLast === null && p2.Ada.hand.length === 1);
    ok('the feed says it was close', r2.log.some((l) => /just in time/.test(l.text)));

    // Say nothing, and the next player's move collects it.
    const { r: r2b, p: p2b } = started();
    stage(r2b, p2b.Ada, [num('ember', 5), num('tide', 9)], num('ember', 2));
    nouno.playCard(r2b, p2b.Ada.id, { cardId: p2b.Ada.hand[0].id });
    nouno.drawCard(r2b, r2b.players[r2b.turnIndex].id);
    ok('saying nothing costs two', p2b.Ada.hand.length === 3, String(p2b.Ada.hand.length));
    ok('and the feed says why', r2b.log.some((l) => /never called it — drew two/.test(l.text)));
    ok('and it is only collected once', r2b.pendingLast === null);

    const { r: r3, p: p3 } = started();
    stage(r3, p3.Ada, [num('ember', 5), num('tide', 9), num('fern', 1)], num('ember', 2));
    const early = nouno.sayLast(r3, p3.Ada.id);
    ok('you cannot say it on three', !!early.error);
    ok('and it says how many you hold', /holding 3/.test(early.error), early.error);

    // The call is about the hand you hold now, not a badge you keep.
    const { r: r4, p: p4 } = started();
    stage(r4, p4.Ada, [num('ember', 5), num('tide', 9)], num('ember', 2));
    nouno.sayLast(r4, p4.Ada.id);
    p4.Ada.hand.push(num('fern', 3), num('fern', 4));
    nouno.drawCard(r4, p4.Ada.id);
    ok('drawing back up takes the call away', !r4.saidLast.includes(p4.Ada.id));
}

/* ------------------------------------------------------------- winning */
{
    const { r, p } = started();
    stage(r, p.Ada, [num('ember', 5)], num('ember', 2));
    p.Bo.hand = [num('tide', 9), card('tide', 'halt')];   // 9 + 20
    p.Cy.hand = [card(null, 'any4')];                     // 50
    nouno.playCard(r, p.Ada.id, { cardId: p.Ada.hand[0].id });
    ok('an empty hand ends it', r.phase === 'ended', r.phase);
    ok('and names a winner', r.winnerId === p.Ada.id);
    ok('the points are what everyone else held', r.scores[p.Ada.id] === 79, String(r.scores[p.Ada.id]));
    ok('it is stamped', !!r.stats.endedAt);
    ok('the feed says so', r.log.some((l) => /Ada went out — 79 points/.test(l.text)));
}

/* ------------------------------------------- what the room is told, and not */
{
    const { r, p } = started();
    const state = e.publicState(r, p.Ada.id);
    ok('nobody s cards are in the broadcast', !JSON.stringify(state).includes('"hand"'));
    ok('only how many they hold', state.players.every((x) => x.handCount === 7));
    ok('the card in play is public', !!state.top && state.active === r.active);
    ok('so is the direction and the stock', state.direction === 1 && state.stockCount === r.stock.length);
    ok('and the game says which it is', state.game === 'nouno');

    const mine = nouno.privateFor(r, p.Ada.id);
    ok('your own hand comes down its own channel', mine.hand.length === 7);
    ok('and it is yours', mine.hand[0].id === p.Ada.hand[0].id);
    ok('a stranger gets nothing', nouno.privateFor(r, 'nobody') === null);
}

/* --------------------------------------------- the seam, on a nouno room */
{
    const { r, p } = started();
    ok('no board came with it', !('tiles' in r) && !('decks' in r));
    ok('and no money', !('cash' in p.Ada));

    // The turn clock: draw and pass, never a decision made for them.
    stage(r, p.Ada, [num('tide', 9)], num('ember', 2));
    r.stock = [num('fern', 4)];
    e.armIdle(r);
    const held = p.Ada.hand.length;
    e.expireIdle(r);
    ok('the clock draws for them', p.Ada.hand.length === held + 1, String(p.Ada.hand.length - held));
    ok('and passes', r.players[r.turnIndex].id === p.Bo.id);
    ok('and it is counted against them', p.Ada.stalls === 1);
    ok('the feed says it was played for them', r.log.some((l) => /Ada was away/.test(l.text)));

    // Someone removed mid-game: their cards go back and play carries on.
    const { r: r2, p: p2 } = started();
    const total = () => r2.stock.length + r2.pile.length + r2.players.reduce((n, x) => n + x.hand.length, 0);
    ok('all present and correct', total() === 108, String(total()));
    e.rules; // the property rules exist alongside; this room uses nouno's
    require('../game/rules').rulesFor(r2).removeFromPlay(r2, p2.Bo);
    ok('their hand goes back', p2.Bo.hand.length === 0 && p2.Bo.out === true);
    ok('and no card is lost', total() === 108, String(total()));
    ok('play carries on', r2.phase === 'playing');

    // A rematch deals again rather than resuming.
    const { r: r3, p: p3 } = started();
    e.resetForRematch(r3);
    ok('a rematch empties the hands', r3.players.every((x) => x.hand.length === 0));
    ok('and goes back to the lobby', r3.phase === 'waiting');
    ok('chat is still counted for both games', (e.addChat(r3, p3.Ada.id, 'hi'), r3.stats.chatMessages === 1));
}

/* ----------------------------------------------------- the registry itself */
{
    const { GAMES, HOOKS, rulesFor, gameId } = require('../game/rules');
    ok('both games are registered', Object.keys(GAMES).sort().join() === 'nopoly,nouno');
    ok('an unknown id falls back', gameId('wat') === 'nopoly' && rulesFor({ game: 'wat' }).id === 'nopoly');
    ok('a room with no game is the board game', rulesFor({}).id === 'nopoly');
    for (const [id, mod] of Object.entries(GAMES)) {
        const missing = HOOKS.filter((h) => mod[h] === undefined);
        ok(`${id} implements every hook`, !missing.length, missing.join(', '));
    }

    // The one thing persist.js asks of a room: plain JSON, all the way down.
    const { r } = started();
    const round = JSON.parse(JSON.stringify(r));
    ok('a nouno room survives a snapshot', round.stock.length === r.stock.length && round.players[0].hand.length === 7);
    ok('and comes back as the same game', require('../game/rules').rulesFor(round).id === 'nouno');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
