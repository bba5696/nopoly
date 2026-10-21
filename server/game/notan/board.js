// The island notan is played on.
//
// Hexes in rows, pointy side up: 3-4-5-4-3 for up to four players, and the
// longer 3-4-5-6-5-4-3 for five or six. Everything a rule needs to ask — which
// corners a hex has, which corners neighbour each other, which edges join them,
// which edges are the coast — is worked out once here from plain geometry and
// stored as ids, so the rules never do trigonometry and a snapshot is just JSON.
//
// The counts are the ones the box has always had. The resource names are the
// plain words for the things, because nobody owns "wool".

const { shuffle } = require('../cards');

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const SIZES = {
    small: {
        rows: [3, 4, 5, 4, 3],
        tiles: { brick: 3, lumber: 4, wool: 4, grain: 4, ore: 3, desert: 1 },
        numbers: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
        harbors: ['any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'grain', 'ore'],
        bank: 19,
        dev: { knight: 14, point: 5, roads: 2, plenty: 2, monopoly: 2 },
    },
    large: {
        rows: [3, 4, 5, 6, 5, 4, 3],
        tiles: { brick: 5, lumber: 6, wool: 6, grain: 6, ore: 5, desert: 2 },
        numbers: [
            2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
            8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
        ],
        harbors: ['any', 'any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'wool', 'grain', 'ore'],
        bank: 24,
        dev: { knight: 20, point: 5, roads: 3, plenty: 3, monopoly: 3 },
    },
};

/** Five or more need the bigger island; four fit on the small one. */
const sizeFor = (players) => (players > 4 ? 'large' : 'small');

/** How likely a number is to come up, out of 36 — the dots under it. */
const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

const SQRT3 = Math.sqrt(3);
const keyOf = (x, y) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;

/**
 * The bare shape: hex centres, every corner and every edge, joined up.
 * Unit circumradius, so a client draws it by multiplying.
 */
function geometry(rows) {
    const hexes = [];
    const vertices = [];
    const edges = [];
    const vertexAt = new Map();
    const edgeAt = new Map();

    const vertex = (x, y) => {
        const k = keyOf(x, y);
        if (!vertexAt.has(k)) {
            vertexAt.set(k, vertices.length);
            vertices.push({ id: vertices.length, x: round(x), y: round(y), hexes: [], adj: [], edges: [], harbor: null });
        }
        return vertexAt.get(k);
    };
    const edge = (a, b) => {
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!edgeAt.has(k)) {
            edgeAt.set(k, edges.length);
            edges.push({ id: edges.length, a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
            vertices[a].adj.push(b);
            vertices[b].adj.push(a);
            vertices[a].edges.push(edges.length - 1);
            vertices[b].edges.push(edges.length - 1);
        }
        return edgeAt.get(k);
    };

    const mid = (rows.length - 1) / 2;
    rows.forEach((count, r) => {
        for (let c = 0; c < count; c++) {
            const x = (c - (count - 1) / 2) * SQRT3;
            const y = (r - mid) * 1.5;
            const id = hexes.length;
            // Top corner first, then clockwise.
            const corners = [];
            for (let k = 0; k < 6; k++) {
                const a = ((60 * k - 90) * Math.PI) / 180;
                corners.push(vertex(x + Math.cos(a), y + Math.sin(a)));
            }
            const sides = corners.map((v, k) => edge(v, corners[(k + 1) % 6]));
            for (const v of corners) vertices[v].hexes.push(id);
            for (const e of sides) edges[e].hexes.push(id);
            hexes.push({ id, x: round(x), y: round(y), vertices: corners, edges: sides, adj: [] });
        }
    });
    // Neighbours are hexes that share a side.
    for (const e of edges) {
        if (e.hexes.length !== 2) continue;
        const [h1, h2] = e.hexes;
        hexes[h1].adj.push(h2);
        hexes[h2].adj.push(h1);
    }
    return { hexes, vertices, edges };
}

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * The coast, in order round the island. Sorted by angle from the middle, which
 * is enough for a shape this round.
 */
function coastline({ edges, vertices }) {
    const coast = edges.filter((e) => e.hexes.length === 1);
    const angle = (e) => {
        const x = (vertices[e.a].x + vertices[e.b].x) / 2;
        const y = (vertices[e.a].y + vertices[e.b].y) / 2;
        return Math.atan2(y, x);
    };
    return coast.sort((p, q) => angle(p) - angle(q));
}

/**
 * Number tokens on the land, re-dealt until no two red numbers (6 and 8) touch.
 * That is the one placement rule everyone agrees on: two neighbouring sixes make
 * one corner of the island the whole game.
 */
function dealNumbers(hexes, numbers) {
    const land = hexes.filter((h) => h.resource !== 'desert');
    for (let attempt = 0; attempt < 2000; attempt++) {
        const dealt = shuffle(numbers);
        land.forEach((h, i) => (h.number = dealt[i]));
        const red = (h) => h.number === 6 || h.number === 8;
        const clash = land.some((h) => red(h) && h.adj.some((n) => red(hexes[n])));
        if (!clash) return;
    }
    // Two thousand deals without a clean one does not happen with these counts,
    // and a clash is a worse board, not a broken one.
}

/** A fresh island for this many players. */
function makeMap(playerCount) {
    const size = sizeFor(playerCount);
    const spec = SIZES[size];
    const { hexes, vertices, edges } = geometry(spec.rows);

    const deck = shuffle(Object.entries(spec.tiles).flatMap(([r, n]) => Array(n).fill(r)));
    hexes.forEach((h, i) => {
        h.resource = deck[i];
        h.number = null;
    });
    dealNumbers(hexes, spec.numbers);

    // Harbours spaced evenly round the coast, starting somewhere different each
    // game. Even spacing keeps two of them from sharing a corner.
    const coast = coastline({ edges, vertices });
    const types = shuffle(spec.harbors);
    const step = coast.length / types.length;
    const offset = Math.floor(Math.random() * step);
    const harbors = types.map((type, i) => {
        const e = coast[Math.floor(offset + i * step) % coast.length];
        const hex = hexes[e.hexes[0]];
        const mx = (vertices[e.a].x + vertices[e.b].x) / 2;
        const my = (vertices[e.a].y + vertices[e.b].y) / 2;
        // Pushed out to sea, for the client to draw the jetty at.
        const x = round(hex.x + (mx - hex.x) * 1.55);
        const y = round(hex.y + (my - hex.y) * 1.55);
        vertices[e.a].harbor = type;
        vertices[e.b].harbor = type;
        return { edgeId: e.id, type, x, y, a: e.a, b: e.b };
    });

    const desert = hexes.find((h) => h.resource === 'desert');
    return { size, hexes, vertices, edges, harbors, robber: desert ? desert.id : 0 };
}

function makeDevDeck(size) {
    const spec = SIZES[size].dev;
    return shuffle(Object.entries(spec).flatMap(([kind, n]) => Array(n).fill(kind)));
}

module.exports = { RESOURCES, SIZES, sizeFor, pips, makeMap, makeDevDeck, geometry };
