// The 64-tile loop: 17x17, corners every 16 tiles.
//
// Built for a full table. Sixteen countries and forty deeds mean twelve people
// can each hold something worth trading, where a forty-tile board runs out of
// property long before it runs out of players.
//
// Mostly pairs, and deliberately: ten sets of two, four of three and two of
// four. A pair completes quickly, which is the point when the deeds are spread
// across twelve people — a table this size rarely assembles a set of three by
// luck, and a board where nobody ever builds is a board where nothing happens.
// The two fours (Italy, China) are the ones worth fighting over.
//
// Sixteen a side is past what a window can show at a readable size; the board
// is drawn at the size its tiles need and the viewport pans instead — see
// client/src/components/board/BoardViewport.jsx.
//
// A lap is more than half again as long as the classic one, which is the point
// and also the cost: rents land less often, so games take longer. Two of the
// three taxes take a share of net worth rather than a flat fee, to keep a
// runaway leader paying for the lead.
//
// Layout tuple: [name, type, groupId, price, rent[], houseCost, extra]

const GROUPS = {
    mexico: { name: 'Mexico', color: '#ef4444', size: 2 },
    lebanon: { name: 'Lebanon', color: '#22c55e', size: 2 },
    brazil: { name: 'Brazil', color: '#eab308', size: 3 },
    egypt: { name: 'Egypt', color: '#f97316', size: 3 },
    palestine: { name: 'Palestine', color: '#14b8a6', size: 3 },
    bangladesh: { name: 'Bangladesh', color: '#a3e635', size: 2 },
    pakistan: { name: 'Pakistan', color: '#10b981', size: 2 },
    india: { name: 'India', color: '#f472b6', size: 3 },
    italy: { name: 'Italy', color: '#38bdf8', size: 4 },
    germany: { name: 'Germany', color: '#6366f1', size: 2 },
    china: { name: 'China', color: '#a855f7', size: 4 },
    france: { name: 'France', color: '#3b82f6', size: 2 },
    indonesia: { name: 'Indonesia', color: '#fb7185', size: 2 },
    japan: { name: 'Japan', color: '#d946ef', size: 2 },
    australia: { name: 'Australia', color: '#06b6d4', size: 2 },
    usa: { name: 'USA', color: '#e2e8f0', size: 2 },
};

const LAYOUT = [
    // top-left corner, then the top row left to right
    ['Start', 'corner', null, 0, null, 0],
    ['Cancún', 'property', 'mexico', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Mexico City', 'property', 'mexico', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Income Tax', 'tax', null, 0, null, 0, { percent: 10, max: 200 }],
    ['Tripoli', 'property', 'lebanon', 80, [4, 20, 60, 180, 320, 450], 50],
    ['Beirut', 'property', 'lebanon', 80, [4, 20, 60, 180, 320, 450], 50],
    ['CAI Airport', 'airport', 'airport', 200, null, 0],
    ['Salvador', 'property', 'brazil', 100, [8, 40, 100, 300, 450, 600], 50],
    ['Recife', 'property', 'brazil', 100, [8, 40, 100, 300, 450, 600], 50],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Rio', 'property', 'brazil', 110, [8, 40, 100, 300, 450, 600], 50],
    ['Solar Company', 'utility', 'utility', 150, null, 0],
    ['Luxor', 'property', 'egypt', 120, [9, 45, 125, 375, 540, 675], 50],
    ['Giza', 'property', 'egypt', 120, [9, 45, 125, 375, 540, 675], 50],
    ['Cairo', 'property', 'egypt', 130, [10, 50, 150, 450, 625, 750], 100],
    // top-right corner, then the right column top to bottom
    ['In Jail / Just Visiting', 'corner', null, 0, null, 0],
    ['Gaza', 'property', 'palestine', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Ramallah', 'property', 'palestine', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Jerusalem', 'property', 'palestine', 150, [11, 55, 165, 475, 660, 800], 100],
    ['DEL Airport', 'airport', 'airport', 200, null, 0],
    ['Chittagong', 'property', 'bangladesh', 160, [12, 60, 180, 500, 700, 900], 100],
    ['Dhaka', 'property', 'bangladesh', 160, [12, 60, 180, 500, 700, 900], 100],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Lahore', 'property', 'pakistan', 170, [13, 65, 190, 525, 725, 925], 100],
    ['Karachi', 'property', 'pakistan', 170, [13, 65, 190, 525, 725, 925], 100],
    ['Water Company', 'utility', 'utility', 150, null, 0],
    ['Jaipur', 'property', 'india', 180, [14, 70, 200, 550, 750, 950], 100],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Mumbai', 'property', 'india', 190, [15, 75, 210, 575, 775, 975], 100],
    ['Delhi', 'property', 'india', 200, [16, 80, 220, 600, 800, 1000], 100],
    // bottom-right corner, then the bottom row right to left
    ['Vacation', 'corner', null, 0, null, 0],
    ['Venice', 'property', 'italy', 210, [17, 85, 235, 650, 840, 1025], 150],
    ['Bologna', 'property', 'italy', 210, [17, 85, 235, 650, 840, 1025], 150],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Milan', 'property', 'italy', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Rome', 'property', 'italy', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['MUC Airport', 'airport', 'airport', 200, null, 0],
    ['Munich', 'property', 'germany', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['Berlin', 'property', 'germany', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['Earnings Tax', 'tax', null, 0, null, 0, { percent: 10 }],
    ['Gas Company', 'utility', 'utility', 150, null, 0],
    ['Shenzhen', 'property', 'china', 250, [21, 105, 315, 775, 950, 1125], 150],
    ['Guangzhou', 'property', 'china', 250, [21, 105, 315, 775, 950, 1125], 150],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Beijing', 'property', 'china', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Shanghai', 'property', 'china', 260, [22, 110, 330, 800, 975, 1150], 150],
    // bottom-left corner, then the left column bottom to top
    ['Go to Jail', 'corner', null, 0, null, 0],
    ['Lyon', 'property', 'france', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Paris', 'property', 'france', 280, [24, 120, 360, 850, 1025, 1200], 150],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Bandung', 'property', 'indonesia', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Jakarta', 'property', 'indonesia', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['JFK Airport', 'airport', 'airport', 200, null, 0],
    ['Yokohama', 'property', 'japan', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['Tokyo', 'property', 'japan', 320, [28, 150, 450, 1000, 1200, 1400], 200],
    ['Power Company', 'utility', 'utility', 150, null, 0],
    ['Melbourne', 'property', 'australia', 350, [35, 175, 500, 1100, 1300, 1500], 200],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Sydney', 'property', 'australia', 350, [35, 175, 500, 1100, 1300, 1500], 200],
    ['Premium Tax', 'tax', null, 0, null, 0, { percent: 5, max: 150 }],
    ['San Francisco', 'property', 'usa', 400, [50, 200, 600, 1400, 1700, 2000], 250],
    ['New York', 'property', 'usa', 450, [60, 240, 700, 1600, 1950, 2250], 250],
];

module.exports = {
    id: 'grand',
    name: 'Grand Tour',
    tagline: 'Sixteen countries and forty deeds — enough to go round a full table.',
    groups: GROUPS,
    layout: LAYOUT,
    airportRent: [30, 70, 150, 300],
    utilityMultiplier: [4, 10, 16, 22],
};
