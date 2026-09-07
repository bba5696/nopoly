// A longer 48-tile loop: 13x13, corners every 12 tiles.
//
// Ten countries instead of eight, a third utility, and an Earnings Tax that
// takes a share of net worth rather than a flat fee — so the leader pays the
// most.
//
// One exchange and one landmark, where Grand Tour has three and two: enough
// that a longer game meets both, not so many that this stops being the board
// people already know.
//
// Layout tuple: [name, type, groupId, price, rent[], houseCost, extra]

const GROUPS = {
    brazil: { name: 'Brazil', color: '#8b5cf6', size: 2 },
    palestine: { name: 'Palestine', color: '#38bdf8', size: 3 },
    bangladesh: { name: 'Bangladesh', color: '#22c55e', size: 2 },
    italy: { name: 'Italy', color: '#f472b6', size: 4 },
    germany: { name: 'Germany', color: '#fb923c', size: 3 },
    china: { name: 'China', color: '#ef4444', size: 3 },
    france: { name: 'France', color: '#facc15', size: 2 },
    japan: { name: 'Japan', color: '#14b8a6', size: 2 },
    uk: { name: 'UK', color: '#a3e635', size: 4 },
    usa: { name: 'USA', color: '#60a5fa', size: 3 },
};

const LAYOUT = [
    // top-left corner, then the top row left to right
    ['Start', 'corner', null, 0, null, 0],
    ['Salvador', 'property', 'brazil', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Rio', 'property', 'brazil', 60, [4, 20, 60, 180, 320, 450], 50],
    ['Earnings Tax', 'tax', null, 0, null, 0, { percent: 10 }],
    ['Gaza', 'property', 'palestine', 100, [6, 30, 90, 270, 400, 550], 50],
    ['GZA Airport', 'airport', 'airport', 200, null, 0],
    ['Ramallah', 'property', 'palestine', 100, [6, 30, 90, 270, 400, 550], 50],
    ['Jerusalem', 'property', 'palestine', 110, [7, 35, 95, 285, 425, 575], 50],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Dhaka', 'property', 'bangladesh', 120, [8, 40, 100, 300, 450, 600], 50],
    ['Chittagong', 'property', 'bangladesh', 130, [9, 45, 125, 375, 540, 675], 50],
    // top-right corner, then the right column top to bottom
    ['In Jail / Just Visiting', 'corner', null, 0, null, 0],
    ['Venice', 'property', 'italy', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Bologna', 'property', 'italy', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Power Company', 'utility', 'utility', 150, null, 0],
    ['Milan', 'property', 'italy', 160, [12, 60, 180, 500, 700, 900], 100],
    ['Rome', 'property', 'italy', 160, [12, 60, 180, 500, 700, 900], 100],
    ['MUC Airport', 'airport', 'airport', 200, null, 0],
    ['Frankfurt', 'property', 'germany', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Munich', 'property', 'germany', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Gas Company', 'utility', 'utility', 150, null, 0],
    ['Berlin', 'property', 'germany', 200, [16, 80, 220, 600, 800, 1000], 100],
    // bottom-right corner, then the bottom row right to left
    ['Vacation', 'corner', null, 0, null, 0],
    ['Shenzhen', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Great Wall', 'landmark', null, 0, null, 0, { startBonus: 25 }],
    ['Beijing', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Shanghai', 'property', 'china', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['CDG Airport', 'airport', 'airport', 200, null, 0],
    ['Toulouse', 'property', 'france', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Paris', 'property', 'france', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Water Company', 'utility', 'utility', 150, null, 0],
    ['Yokohama', 'property', 'japan', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Tokyo', 'property', 'japan', 280, [24, 120, 360, 850, 1025, 1200], 150],
    // bottom-left corner, then the left column bottom to top
    ['Go to Jail', 'corner', null, 0, null, 0],
    ['Liverpool', 'property', 'uk', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Manchester', 'property', 'uk', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Birmingham', 'property', 'uk', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['London', 'property', 'uk', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['JFK Airport', 'airport', 'airport', 200, null, 0],
    ['Los Angeles', 'property', 'usa', 350, [35, 175, 500, 1100, 1300, 1500], 200],
    ['Surprise', 'chance', null, 0, null, 0],
    ['San Francisco', 'property', 'usa', 360, [40, 185, 550, 1200, 1450, 1700], 200],
    ['Premium Tax', 'tax', null, 0, null, 0, { percent: 5, max: 75 }],
    ['New York', 'property', 'usa', 400, [50, 200, 600, 1400, 1700, 2000], 200],
];

module.exports = {
    id: 'worldwide',
    name: 'Worldwide',
    tagline: 'A longer lap, a share market, and a tax that scales with your worth.',
    groups: GROUPS,
    layout: LAYOUT,
    airportRent: [25, 50, 100, 200],
    utilityMultiplier: [4, 10, 16],
};
