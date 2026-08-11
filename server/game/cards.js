// Surprise (chance) and Treasure (community chest) decks.
//
// Effect kinds:
//   cash      { amount }                  — gain (+) or lose (-) from the bank
//   collect   { amount }                  — collect `amount` from every other player
//   pay       { amount }                  — pay `amount` to every other player
//   move      { to, collectStart }        — move to a named tile; `to` is the
//                                           tile's name and is resolved to an
//                                           id per board in makeDecks(), since
//                                           boards differ in length. A name
//                                           that isn't on the board falls back
//                                           to Start.
//   step      { by }                      — move relative (may be negative)
//   jail      {}                          — go straight to jail
//   jailfree  {}                          — keep a get-out-of-jail card
//   repairs   { perHouse, perHotel }      — pay per building owned

const CHANCE = [
    { id: 'c1', text: 'Advance to Start. Collect $200.', effect: { kind: 'move', to: 'Start', collectStart: true } },
    { id: 'c2', text: 'Fly to New York. If you pass Start, collect $200.', effect: { kind: 'move', to: 'New York', collectStart: true } },
    { id: 'c3', text: 'Take a trip to Berlin. If you pass Start, collect $200.', effect: { kind: 'move', to: 'Berlin', collectStart: true } },
    { id: 'c4', text: 'Advance to Rome. If you pass Start, collect $200.', effect: { kind: 'move', to: 'Rome', collectStart: true } },
    { id: 'c5', text: 'Go back three spaces.', effect: { kind: 'step', by: -3 } },
    { id: 'c6', text: 'Go to jail. Do not pass Start.', effect: { kind: 'jail' } },
    { id: 'c7', text: 'Bank pays you a dividend of $50.', effect: { kind: 'cash', amount: 50 } },
    { id: 'c8', text: 'Your building loan matures. Collect $150.', effect: { kind: 'cash', amount: 150 } },
    { id: 'c9', text: 'Speeding fine. Pay $15.', effect: { kind: 'cash', amount: -15 } },
    { id: 'c10', text: 'Pay school fees of $50.', effect: { kind: 'cash', amount: -50 } },
    { id: 'c11', text: 'You have been elected chairman. Pay each player $50.', effect: { kind: 'pay', amount: 50 } },
    { id: 'c12', text: 'Get out of jail free — keep this card.', effect: { kind: 'jailfree' } },
    { id: 'c13', text: 'General repairs: pay $25 per house and $100 per hotel.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
    { id: 'c14', text: 'Advance to the nearest airport.', effect: { kind: 'nearestAirport' } },
];

const CHEST = [
    { id: 'h1', text: 'Bank error in your favour. Collect $200.', effect: { kind: 'cash', amount: 200 } },
    { id: 'h2', text: "Doctor's fee. Pay $50.", effect: { kind: 'cash', amount: -50 } },
    { id: 'h3', text: 'From a sale of stock you get $50.', effect: { kind: 'cash', amount: 50 } },
    { id: 'h4', text: 'Get out of jail free — keep this card.', effect: { kind: 'jailfree' } },
    { id: 'h5', text: 'Go to jail. Do not pass Start.', effect: { kind: 'jail' } },
    { id: 'h6', text: "It's your birthday. Collect $20 from every player.", effect: { kind: 'collect', amount: 20 } },
    { id: 'h7', text: 'Annuity matures. Collect $100.', effect: { kind: 'cash', amount: 100 } },
    { id: 'h8', text: 'Income tax refund. Collect $20.', effect: { kind: 'cash', amount: 20 } },
    { id: 'h9', text: 'Life insurance matures. Collect $100.', effect: { kind: 'cash', amount: 100 } },
    { id: 'h10', text: 'Hospital fees. Pay $100.', effect: { kind: 'cash', amount: -100 } },
    { id: 'h11', text: 'School fees. Pay $50.', effect: { kind: 'cash', amount: -50 } },
    { id: 'h12', text: 'Consultancy fee. Collect $25.', effect: { kind: 'cash', amount: 25 } },
    { id: 'h13', text: 'Street repairs: pay $40 per house and $115 per hotel.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
    { id: 'h14', text: 'Advance to Start. Collect $200.', effect: { kind: 'move', to: 'Start', collectStart: true } },
];

function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * Bind a deck to a board, turning the `move` destinations from tile names into
 * ids. Done once per game rather than per draw, and on copies, so the module's
 * card definitions stay shared and immutable.
 */
function bind(cards, board) {
    const idOf = new Map();
    board.layout.forEach(([name], id) => {
        if (!idOf.has(name)) idOf.set(name, id);
    });
    return cards.map((card) => {
        if (card.effect.kind !== 'move') return card;
        // A board without the named tile sends the player to Start instead of
        // somewhere arbitrary.
        const to = idOf.get(card.effect.to) ?? 0;
        return { ...card, effect: { ...card.effect, to } };
    });
}

/** Fresh shuffled decks + discard piles for a new game on `board`. */
function makeDecks(board) {
    return {
        chance: { draw: shuffle(bind(CHANCE, board)), discard: [] },
        chest: { draw: shuffle(bind(CHEST, board)), discard: [] },
    };
}

function drawCard(deck) {
    if (deck.draw.length === 0) {
        deck.draw = shuffle(deck.discard);
        deck.discard = [];
    }
    const card = deck.draw.shift();
    // Jail-free cards leave the deck until they're spent.
    if (card.effect.kind !== 'jailfree') deck.discard.push(card);
    return card;
}

module.exports = { CHANCE, CHEST, makeDecks, drawCard, shuffle };
