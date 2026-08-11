// The original 40-tile loop: 11x11, corners every 10 tiles.
//
// Layout tuple: [name, type, groupId, price, rent[], houseCost, extra]
//   `extra` carries type-specific data — currently only tax tiles use it,
//   as { amount } for a flat fee or { percent } for a share of net worth.

const GROUPS = {
    brazil: { name: 'Brazil', color: '#8b5cf6', size: 2 },
    palestine: { name: 'Palestine', color: '#38bdf8', size: 3 },
    italy: { name: 'Italy', color: '#f472b6', size: 3 },
    germany: { name: 'Germany', color: '#fb923c', size: 3 },
    china: { name: 'China', color: '#ef4444', size: 3 },
    france: { name: 'France', color: '#facc15', size: 3 },
    uk: { name: 'UK', color: '#4ade80', size: 3 },
    usa: { name: 'USA', color: '#60a5fa', size: 2 },
};

const LAYOUT = [
    ['Start', 'corner', null, 0, null, 0],
    ['Salvador', 'property', 'brazil', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Rio', 'property', 'brazil', 60, [4, 20, 60, 180, 320, 450], 50],
    ['Income Tax', 'tax', null, 0, null, 0, { amount: 200 }],
    ['GZA Airport', 'airport', 'airport', 200, null, 0],
    ['Gaza', 'property', 'palestine', 100, [6, 30, 90, 270, 400, 550], 50],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Ramallah', 'property', 'palestine', 100, [6, 30, 90, 270, 400, 550], 50],
    ['Jerusalem', 'property', 'palestine', 120, [8, 40, 100, 300, 450, 600], 50],
    ['In Jail / Just Visiting', 'corner', null, 0, null, 0],
    ['Venice', 'property', 'italy', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Electric Company', 'utility', 'utility', 150, null, 0],
    ['Milan', 'property', 'italy', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Rome', 'property', 'italy', 160, [12, 60, 180, 500, 700, 900], 100],
    ['MUC Airport', 'airport', 'airport', 200, null, 0],
    ['Frankfurt', 'property', 'germany', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Munich', 'property', 'germany', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Berlin', 'property', 'germany', 200, [16, 80, 220, 600, 800, 1000], 100],
    ['Vacation', 'corner', null, 0, null, 0],
    ['Shenzhen', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Beijing', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Shanghai', 'property', 'china', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['CDG Airport', 'airport', 'airport', 200, null, 0],
    ['Lyon', 'property', 'france', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Toulouse', 'property', 'france', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Water Company', 'utility', 'utility', 150, null, 0],
    ['Paris', 'property', 'france', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Go to Jail', 'corner', null, 0, null, 0],
    ['Liverpool', 'property', 'uk', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Manchester', 'property', 'uk', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Treasure', 'chest', null, 0, null, 0],
    ['London', 'property', 'uk', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['JFK Airport', 'airport', 'airport', 200, null, 0],
    ['Surprise', 'chance', null, 0, null, 0],
    ['California', 'property', 'usa', 350, [35, 175, 500, 1100, 1300, 1500], 200],
    ['Luxury Tax', 'tax', null, 0, null, 0, { amount: 100 }],
    ['New York', 'property', 'usa', 400, [50, 200, 600, 1400, 1700, 2000], 200],
];

module.exports = {
    id: 'classic',
    name: 'Classic',
    tagline: 'The original loop. A quick lap and a fast squeeze.',
    groups: GROUPS,
    layout: LAYOUT,
    airportRent: [25, 50, 100, 200],
    utilityMultiplier: [4, 10],
};
