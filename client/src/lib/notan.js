/**
 * What the client knows about the island game: how each thing looks, and the
 * hint line that says what to do next.
 *
 * Every rule is the server's. Legal spots and trade rates come down the
 * private channel already worked out (see game/notan/rules.js, `privateFor`),
 * so nothing here decides anything — it only reads what it was sent and says
 * it in a sentence.
 */

export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

export const LOOK = {
    brick: { name: 'Brick', icon: '🧱', fill: '#ff7a59', uses: 'roads and settlements' },
    lumber: { name: 'Lumber', icon: '🌲', fill: '#3ddc97', uses: 'roads and settlements' },
    wool: { name: 'Wool', icon: '🐑', fill: '#a3e635', uses: 'settlements and development cards' },
    grain: { name: 'Grain', icon: '🌾', fill: '#ffb648', uses: 'settlements, cities and development cards' },
    ore: { name: 'Ore', icon: '⛰️', fill: '#a8a4c8', uses: 'cities and development cards' },
    desert: { name: 'Desert', icon: '🏜️', fill: '#6b6880' },
    any: { name: 'Any', icon: '?', fill: '#e9e7f2' },
};

export const BUILDS = [
    { kind: 'road', label: 'Road', points: 0, blurb: 'Connects your towns. Five or more in a row can earn Longest Road (+2).' },
    { kind: 'settlement', label: 'Settlement', points: 1, blurb: 'Earns 1 of a hex’s resource when its number is rolled. +1 point. Goes on a corner your road reaches, at least two roads from any other town.' },
    { kind: 'city', label: 'City', points: 2, blurb: 'Upgrade a settlement: earns double. +1 more point.' },
    { kind: 'dev', label: 'Dev card', points: 0, blurb: 'A Knight, a point, or a one-off bonus. Kept hidden until played.' },
];

export const DEV_BLURB = {
    knight: 'Move the robber and steal a card. Three or more knights can earn Largest Army (+2).',
    point: 'Worth 1 point. Stays hidden in your hand and counts automatically.',
    roads: 'Place 2 roads for free.',
    plenty: 'Take any 2 resources from the bank.',
    monopoly: 'Name a resource — everyone gives you all of theirs.',
};

/** Dots under a number: how many of the 36 rolls make it. */
export const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

export const count = (res) => RESOURCES.reduce((n, r) => n + (res?.[r] || 0), 0);
export const canAfford = (res, cost) => RESOURCES.every((r) => (res?.[r] || 0) >= (cost?.[r] || 0));

/** What a cost is missing, as `{ ore: 1 }`. */
export function shortOf(res, cost) {
    const out = {};
    for (const r of RESOURCES) {
        const need = (cost?.[r] || 0) - (res?.[r] || 0);
        if (need > 0) out[r] = need;
    }
    return out;
}

export function describe(res) {
    const parts = RESOURCES.filter((r) => res?.[r] > 0).map((r) => `${res[r]} ${LOOK[r].name.toLowerCase()}`);
    return parts.length ? parts.join(', ') : 'nothing';
}

/** The empty hand the private channel has not filled in yet. */
export const EMPTY_HAND = {
    resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    dev: [],
    rates: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 },
    points: 0,
    discard: 0,
    legal: { settlement: [], road: [], city: [] },
    suggest: null,
};

/**
 * The one sentence over the board: what is happening, and what you could do.
 * Returns `{ text, tone }` where tone is 'you' when it is a call to act.
 */
export function hintFor({ state, hand, playerId, spectating }) {
    const me = state.players.find((p) => p.id === playerId);
    const up = state.players[state.turnIndex];
    const mine = !!me && up?.id === playerId && !state.paused;
    const name = up?.name || 'Someone';
    const costs = state.costs || {};
    const res = hand.resources;

    if (state.paused) return { text: 'The game is paused.', tone: 'wait' };
    if (spectating || !me) return { text: `You are watching — ${name} is up.`, tone: 'wait' };

    if (state.step === 'discard') {
        if (hand.discard) return { text: `A seven! You hold more than 7 cards — pick ${hand.discard} to give back.`, tone: 'you' };
        const waiting = Object.keys(state.discards || {})
            .map((id) => state.players.find((p) => p.id === id)?.name)
            .filter(Boolean);
        return { text: `A seven! Waiting for ${waiting.join(', ')} to discard.`, tone: 'wait' };
    }

    if (state.step === 'setup') {
        const second = state.setup?.round === 2;
        if (!mine) return { text: `${name} is placing their ${second ? 'second' : 'first'} settlement and road.`, tone: 'wait' };
        if (state.setup.need === 'settlement') {
            return {
                text: second
                    ? 'Place your second settlement on a glowing corner. It pays you one of each resource it touches, right now. ★ marks the strongest spot.'
                    : 'Place your first settlement on a glowing corner. Corners touching high-dot numbers (6, 8, 5, 9) pay out most. ★ marks the strongest spot.',
                tone: 'you',
            };
        }
        return { text: 'Now place a road on one of the glowing edges next to it.', tone: 'you' };
    }

    if (!mine) {
        const offer = state.offer;
        if (offer && offer.fromId !== playerId && !offer.declined?.includes(playerId)) {
            return { text: `${name} wants to trade — see the offer.`, tone: 'you' };
        }
        if (state.step === 'roll') return { text: `${name} is about to roll.`, tone: 'wait' };
        if (state.step === 'robber' || state.step === 'steal') return { text: `${name} is moving the robber.`, tone: 'wait' };
        return { text: `${name} is building and trading. You can still accept their trades.`, tone: 'wait' };
    }

    const knight = hand.dev.find((c) => c.kind === 'knight' && c.playable);
    if (state.step === 'roll') {
        if (state.freeRoads) return { text: `Place ${state.freeRoads} free road${state.freeRoads === 1 ? '' : 's'}, or roll.`, tone: 'you' };
        return {
            text: knight
                ? 'Roll the dice — or play your Knight first to move the robber off your land.'
                : 'Roll the dice. Every hex with that number pays whoever is built on it.',
            tone: 'you',
        };
    }
    if (state.step === 'robber') {
        return { text: 'Move the robber: click a hex to block it. You steal a card from someone built next to it. ★ hurts others most.', tone: 'you' };
    }
    if (state.step === 'steal') return { text: 'Pick who to steal a card from.', tone: 'you' };

    // Your turn, after the roll: the most useful thing you could do now.
    if (state.freeRoads) return { text: `Place ${state.freeRoads} free road${state.freeRoads === 1 ? '' : 's'} on the glowing edges.`, tone: 'you' };
    const legal = hand.legal;
    if (canAfford(res, costs.city) && legal.city.length) {
        return { text: 'You can upgrade a settlement to a city (+1 point, double resources). Press City.', tone: 'you' };
    }
    if (canAfford(res, costs.settlement) && legal.settlement.length) {
        return { text: 'You can build a settlement (+1 point). Press Settlement and pick a glowing corner.', tone: 'you' };
    }
    if (canAfford(res, costs.settlement) && !legal.settlement.length) {
        const spareBrick = (res.brick || 0) >= 2 && (res.lumber || 0) >= 2;
        return {
            text:
                'You have a settlement’s worth, but there is nowhere to put it: a settlement must sit on your road and at least two roads away from every other town. ' +
                (spareBrick
                    ? 'Build a road out first (the ★ edge under Road), then settle at its end.'
                    : 'Build one more road out first (the ★ edge under Road) — that uses your brick and lumber, so you’ll need another of each before settling at its end.'),
            tone: 'you',
        };
    }
    if (canAfford(res, costs.road) && legal.road.length) {
        return { text: 'You can build a road to reach new corners. Press Road.', tone: 'you' };
    }
    if (canAfford(res, costs.dev) && state.devLeft) {
        return { text: 'You can buy a development card — Knights, points and bonuses.', tone: 'you' };
    }
    // Nothing affordable: is one trade enough?
    const goals = [
        ['city', costs.city, legal.city.length > 0],
        ['settlement', costs.settlement, legal.settlement.length > 0],
        ['road', costs.road, legal.road.length > 0],
        ['dev card', costs.dev, state.devLeft > 0],
    ];
    for (const [label, cost, possible] of goals) {
        if (!possible) continue;
        const short = shortOf(res, cost);
        const missing = count(short);
        if (missing !== 1) continue;
        const spare = RESOURCES.find((r) => (res[r] || 0) - (cost[r] || 0) >= hand.rates[r]);
        if (spare) {
            return {
                text: `One ${LOOK[Object.keys(short)[0]].name.toLowerCase()} short of a ${label}. Trade ${hand.rates[spare]} ${LOOK[spare].name.toLowerCase()} with the bank for it.`,
                tone: 'you',
            };
        }
        return {
            text: `One ${LOOK[Object.keys(short)[0]].name.toLowerCase()} short of a ${label}. Offer a trade to the other players.`,
            tone: 'you',
        };
    }
    return { text: 'Nothing to build this turn. Trade if you like, then End turn.', tone: 'you' };
}
