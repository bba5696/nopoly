// The 56-tile loop: 15x15, corners every 14 tiles.
//
// Built for a full table. Twelve countries and four airports mean twelve people
// can each hold something worth trading, where a forty-tile board runs out of
// deeds before it runs out of players; the longer lap also spaces the tokens
// out, so a crowded board still reads.
//
// Fourteen to a side is as far as this can go. A ring is drawn as a square that
// fits the window, so every tile added takes width off every other one — at
// sixteen a side the names were already breaking mid-word on a laptop, and a
// phone was hopeless. The deeds that would have come from a longer lap are
// bought back by keeping the sets small: twelve countries of two to four,
// rather than eight of three.
//
// A lap is still nearly half again as long as the classic one, which is the
// point and also the cost: rents land less often, so games take longer. Two of
// the three taxes take a share of net worth rather than a flat fee, to keep a
// runaway leader paying for the lead.
//
// Layout tuple: [name, type, groupId, price, rent[], houseCost, extra]

const GROUPS = {
    mexico: { name: 'Mexico', color: '#f87171', size: 2 },
    brazil: { name: 'Brazil', color: '#fb923c', size: 3 },
    egypt: { name: 'Egypt', color: '#facc15', size: 3 },
    palestine: { name: 'Palestine', color: '#2dd4bf', size: 3 },
    india: { name: 'India', color: '#a3e635', size: 3 },
    turkey: { name: 'Turkey', color: '#22c55e', size: 3 },
    italy: { name: 'Italy', color: '#38bdf8', size: 3 },
    germany: { name: 'Germany', color: '#6366f1', size: 3 },
    china: { name: 'China', color: '#a855f7', size: 3 },
    france: { name: 'France', color: '#e879f9', size: 3 },
    japan: { name: 'Japan', color: '#f472b6', size: 2 },
    usa: { name: 'USA', color: '#e2e8f0', size: 4 },
};

const LAYOUT = [
    // top-left corner, then the top row left to right
    ['Start', 'corner', null, 0, null, 0],
    ['Cancún', 'property', 'mexico', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Mexico City', 'property', 'mexico', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Income Tax', 'tax', null, 0, null, 0, { percent: 10, max: 200 }],
    ['Salvador', 'property', 'brazil', 80, [4, 20, 60, 180, 320, 450], 50],
    ['GZA Airport', 'airport', 'airport', 200, null, 0],
    ['Rio', 'property', 'brazil', 90, [6, 30, 90, 270, 400, 550], 50],
    ['São Paulo', 'property', 'brazil', 90, [6, 30, 90, 270, 400, 550], 50],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Luxor', 'property', 'egypt', 100, [8, 40, 100, 300, 450, 600], 50],
    ['Solar Company', 'utility', 'utility', 150, null, 0],
    ['Giza', 'property', 'egypt', 110, [8, 40, 100, 300, 450, 600], 50],
    ['Cairo', 'property', 'egypt', 120, [9, 45, 125, 375, 540, 675], 50],
    // top-right corner, then the right column top to bottom
    ['In Jail / Just Visiting', 'corner', null, 0, null, 0],
    ['Gaza', 'property', 'palestine', 130, [10, 50, 150, 450, 625, 750], 100],
    ['Ramallah', 'property', 'palestine', 130, [10, 50, 150, 450, 625, 750], 100],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Jerusalem', 'property', 'palestine', 140, [10, 50, 150, 450, 625, 750], 100],
    ['DEL Airport', 'airport', 'airport', 200, null, 0],
    ['Jaipur', 'property', 'india', 150, [11, 55, 165, 475, 660, 800], 100],
    ['Mumbai', 'property', 'india', 150, [11, 55, 165, 475, 660, 800], 100],
    ['Water Company', 'utility', 'utility', 150, null, 0],
    ['Delhi', 'property', 'india', 160, [12, 60, 180, 500, 700, 900], 100],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Izmir', 'property', 'turkey', 170, [13, 65, 190, 525, 725, 925], 100],
    ['Ankara', 'property', 'turkey', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Istanbul', 'property', 'turkey', 190, [15, 75, 210, 575, 775, 975], 100],
    // bottom-right corner, then the bottom row right to left
    ['Vacation', 'corner', null, 0, null, 0],
    ['Venice', 'property', 'italy', 200, [16, 80, 220, 600, 800, 1000], 100],
    ['Milan', 'property', 'italy', 200, [16, 80, 220, 600, 800, 1000], 100],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Rome', 'property', 'italy', 210, [17, 85, 235, 650, 840, 1025], 150],
    ['MUC Airport', 'airport', 'airport', 200, null, 0],
    ['Frankfurt', 'property', 'germany', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Munich', 'property', 'germany', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Berlin', 'property', 'germany', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['Earnings Tax', 'tax', null, 0, null, 0, { percent: 10 }],
    ['Gas Company', 'utility', 'utility', 150, null, 0],
    ['Shenzhen', 'property', 'china', 250, [21, 105, 315, 775, 950, 1125], 150],
    ['Beijing', 'property', 'china', 250, [21, 105, 315, 775, 950, 1125], 150],
    ['Shanghai', 'property', 'china', 260, [22, 110, 330, 800, 975, 1150], 150],
    // bottom-left corner, then the left column bottom to top
    ['Go to Jail', 'corner', null, 0, null, 0],
    ['Toulouse', 'property', 'france', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Lyon', 'property', 'france', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Paris', 'property', 'france', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['CDG Airport', 'airport', 'airport', 200, null, 0],
    ['Yokohama', 'property', 'japan', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Tokyo', 'property', 'japan', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Los Angeles', 'property', 'usa', 350, [35, 175, 500, 1100, 1300, 1500], 200],
    ['Chicago', 'property', 'usa', 380, [45, 190, 575, 1300, 1550, 1800], 200],
    ['Premium Tax', 'tax', null, 0, null, 0, { percent: 5, max: 150 }],
    ['San Francisco', 'property', 'usa', 400, [50, 200, 600, 1400, 1700, 2000], 250],
    ['New York', 'property', 'usa', 450, [60, 240, 700, 1600, 1950, 2250], 250],
];

module.exports = {
    id: 'grand',
    name: 'Grand Tour',
    tagline: 'Twelve countries and four airports — deeds enough for a full table.',
    groups: GROUPS,
    layout: LAYOUT,
    airportRent: [30, 70, 150, 300],
    utilityMultiplier: [4, 10, 16],
};
