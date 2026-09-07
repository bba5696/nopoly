// The 52-tile loop: 14x14, corners every 13 tiles.
//
// Built for a full table, and sized by what a person will actually look at:
// sixty-four tiles fit once the board could pan, and were still too much board.
// Thirteen a side is a lap half again as long as Classic's, twelve countries
// against eight, and thirty-one deeds against twenty-eight — enough that
// twelve people each hold something worth trading.
//
// Mostly pairs, deliberately: seven sets of two, three of three and two of
// four. A pair completes quickly, which is the point when the deeds are spread
// across twelve people — a table this size rarely assembles a set of three by
// luck, and a board where nobody ever builds is a board where nothing happens.
// Italy and China are the fours, and the ones worth fighting over.
//
// Four exchange squares, one a side: the market where a share in somebody
// else's country is bought — see the engine's SHARE_CUT and ARCHITECTURE.md.
// They are what the deeds a shorter board cannot carry are traded for.
//
// Layout tuple: [name, type, groupId, price, rent[], houseCost, extra]

const GROUPS = {
    lebanon: { name: 'Lebanon', color: '#ef4444', size: 2 },
    brazil: { name: 'Brazil', color: '#eab308', size: 3 },
    egypt: { name: 'Egypt', color: '#f97316', size: 3 },
    palestine: { name: 'Palestine', color: '#14b8a6', size: 3 },
    bangladesh: { name: 'Bangladesh', color: '#a3e635', size: 2 },
    pakistan: { name: 'Pakistan', color: '#10b981', size: 2 },
    italy: { name: 'Italy', color: '#38bdf8', size: 4 },
    germany: { name: 'Germany', color: '#6366f1', size: 2 },
    china: { name: 'China', color: '#a855f7', size: 4 },
    indonesia: { name: 'Indonesia', color: '#fb7185', size: 2 },
    australia: { name: 'Australia', color: '#06b6d4', size: 2 },
    usa: { name: 'USA', color: '#e2e8f0', size: 2 },
};

const LAYOUT = [
    // top-left corner, then the top row left to right
    ['Start', 'corner', null, 0, null, 0],
    ['Tripoli', 'property', 'lebanon', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Beirut', 'property', 'lebanon', 60, [2, 10, 30, 90, 160, 250], 50],
    ['Income Tax', 'tax', null, 0, null, 0, { percent: 10, max: 200 }],
    ['Salvador', 'property', 'brazil', 80, [4, 20, 60, 180, 320, 450], 50],
    ['Recife', 'property', 'brazil', 80, [4, 20, 60, 180, 320, 450], 50],
    ['CAI Airport', 'airport', 'airport', 200, null, 0],
    ['Rio', 'property', 'brazil', 90, [6, 30, 90, 270, 400, 550], 50],
    ['Solar Company', 'utility', 'utility', 150, null, 0],
    ['Luxor', 'property', 'egypt', 100, [8, 40, 100, 300, 450, 600], 50],
    ['Giza', 'property', 'egypt', 100, [8, 40, 100, 300, 450, 600], 50],
    ['Cairo', 'property', 'egypt', 110, [8, 40, 100, 300, 450, 600], 50],
    // top-right corner, then the right column top to bottom
    ['In Jail / Just Visiting', 'corner', null, 0, null, 0],
    ['Gaza', 'property', 'palestine', 120, [9, 45, 125, 375, 540, 675], 50],
    ['Ramallah', 'property', 'palestine', 120, [9, 45, 125, 375, 540, 675], 50],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Jerusalem', 'property', 'palestine', 130, [10, 50, 150, 450, 625, 750], 100],
    ['DEL Airport', 'airport', 'airport', 200, null, 0],
    ['Chittagong', 'property', 'bangladesh', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Dhaka', 'property', 'bangladesh', 140, [10, 50, 150, 450, 625, 750], 100],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Lahore', 'property', 'pakistan', 150, [11, 55, 165, 475, 660, 800], 100],
    ['Water Company', 'utility', 'utility', 150, null, 0],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Karachi', 'property', 'pakistan', 160, [12, 60, 180, 500, 700, 900], 100],
    // bottom-right corner, then the bottom row right to left
    ['Vacation', 'corner', null, 0, null, 0],
    ['Venice', 'property', 'italy', 170, [13, 65, 190, 525, 725, 925], 100],
    ['Bologna', 'property', 'italy', 170, [13, 65, 190, 525, 725, 925], 100],
    ['Treasure', 'chest', null, 0, null, 0],
    ['Milan', 'property', 'italy', 180, [14, 70, 200, 550, 750, 950], 100],
    ['MUC Airport', 'airport', 'airport', 200, null, 0],
    ['Rome', 'property', 'italy', 190, [15, 75, 210, 575, 775, 975], 100],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Munich', 'property', 'germany', 200, [16, 80, 220, 600, 800, 1000], 100],
    ['Surprise', 'chance', null, 0, null, 0],
    ['Berlin', 'property', 'germany', 210, [17, 85, 235, 650, 840, 1025], 150],
    ['Earnings Tax', 'tax', null, 0, null, 0, { percent: 10 }],
    ['Gas Company', 'utility', 'utility', 150, null, 0],
    // bottom-left corner, then the left column bottom to top
    ['Go to Jail', 'corner', null, 0, null, 0],
    ['Shenzhen', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Guangzhou', 'property', 'china', 220, [18, 90, 250, 700, 875, 1050], 150],
    ['Exchange', 'exchange', null, 0, null, 0],
    ['Beijing', 'property', 'china', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['Shanghai', 'property', 'china', 240, [20, 100, 300, 750, 925, 1100], 150],
    ['JFK Airport', 'airport', 'airport', 200, null, 0],
    ['Bandung', 'property', 'indonesia', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Jakarta', 'property', 'indonesia', 260, [22, 110, 330, 800, 975, 1150], 150],
    ['Melbourne', 'property', 'australia', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['Sydney', 'property', 'australia', 300, [26, 130, 390, 900, 1100, 1275], 200],
    ['San Francisco', 'property', 'usa', 400, [50, 200, 600, 1400, 1700, 2000], 250],
    ['New York', 'property', 'usa', 450, [60, 240, 700, 1600, 1950, 2250], 250],
];

module.exports = {
    id: 'grand',
    name: 'Grand Tour',
    tagline: 'Twelve countries, four exchanges, and deeds enough for a full table.',
    groups: GROUPS,
    layout: LAYOUT,
    airportRent: [30, 70, 150, 300],
    utilityMultiplier: [4, 10, 16],
};
