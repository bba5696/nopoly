// Profiles: the letters, the colour, and what happens when two people want the
// same one.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { start = false } = {}) {
    const r = e.createRoom('LOOK');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    if (start) e.startGame(r, p[names[0]].id);
    return { r, p };
}

/** Perceptual-ish distance, enough to say "these read as different colours". */
function apart(a, b) {
    const rgb = (hex) => {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [x, y] = [rgb(a), rgb(b)];
    return Math.sqrt(x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0));
}

/* --------------------------------------------------------------- initials */
{
    const { r, p } = mk(['Ada', 'Bo']);
    ok('nothing set by default', p.Ada.initials === null);
    e.setProfile(r, p.Ada.id, { initials: 'zzz' });
    ok('three letters, upper-cased', p.Ada.initials === 'ZZZ', String(p.Ada.initials));
    e.setProfile(r, p.Ada.id, { initials: 'abcdef' });
    ok('longer is trimmed to three', p.Ada.initials === 'ABC', String(p.Ada.initials));
    e.setProfile(r, p.Ada.id, { initials: 'x' });
    ok('one is allowed', p.Ada.initials === 'X');
    e.setProfile(r, p.Ada.id, { initials: '<script>' });
    ok('punctuation is dropped', p.Ada.initials === 'SCR', String(p.Ada.initials));
    e.setProfile(r, p.Ada.id, { initials: '!!!' });
    ok('nothing usable falls back to the name', p.Ada.initials === null);
    e.setProfile(r, p.Ada.id, { initials: '' });
    ok('emptying clears it', p.Ada.initials === null);
    ok('digits are fine', !e.setProfile(r, p.Bo.id, { initials: 'B2' }).error && p.Bo.initials === 'B2');
}

/* ------------------------------------------------------------ picking a colour */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    ok('everyone starts on a different colour',
        new Set(r.players.map((q) => q.color)).size === 3,
        JSON.stringify(r.players.map((q) => q.color)));

    const target = r.players.find((q) => q.id !== p.Ada.id).baseColor;
    ok('an off-palette colour is refused', !!e.setProfile(r, p.Ada.id, { color: '#123456' }).error);
    ok('so is a nonsense one', !!e.setProfile(r, p.Ada.id, { color: 'red' }).error);
    ok('a palette colour is taken', !e.setProfile(r, p.Ada.id, { color: target }).error);
    ok('and remembered as the pick', p.Ada.baseColor === target);
}

/* -------------------------------------------------------- sharing a colour */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    const shared = p.Ada.baseColor;
    e.setProfile(r, p.Bo.id, { color: shared });

    ok('both keep the pick they made', p.Ada.baseColor === shared && p.Bo.baseColor === shared);
    ok('but they are not drawn the same', p.Ada.color !== p.Bo.color,
        `${p.Ada.color} / ${p.Bo.color}`);
    ok('and the difference is obvious', apart(p.Ada.color, p.Bo.color) > 60,
        String(Math.round(apart(p.Ada.color, p.Bo.color))));
    ok('the third is untouched', p.Cy.color === p.Cy.baseColor);

    // A third on the same colour still has to be told apart from both.
    e.setProfile(r, p.Cy.id, { color: shared });
    const shades = [p.Ada.color, p.Bo.color, p.Cy.color];
    ok('three shades, all distinct', new Set(shades).size === 3, JSON.stringify(shades));
    ok('each pair still reads apart',
        apart(shades[0], shades[1]) > 25 && apart(shades[1], shades[2]) > 25 && apart(shades[0], shades[2]) > 25,
        JSON.stringify(shades.map((_, i) => Math.round(apart(shades[i], shades[(i + 1) % 3])))));

    // And going back to something of their own leaves two on the shared one.
    e.setProfile(r, p.Cy.id, { color: '#4cc9f0' });
    ok('the ones left keep being told apart', new Set([p.Ada.color, p.Bo.color]).size === 2);
    ok('and the leaver wears what they picked', p.Cy.color === '#4cc9f0', p.Cy.color);
}

/* ------------------------------------------ shades stay inside the visible range */
{
    // The lightest and the darkest colours in the palette are the ones a naive
    // offset would push into white or black.
    for (const colour of ['#a3e635', '#7c5cff']) {
        const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
        for (const q of Object.values(p)) e.setProfile(r, q.id, { color: colour });
        const shades = r.players.map((q) => q.color);
        ok(`four on ${colour} are all distinct`, new Set(shades).size === 4, JSON.stringify(shades));
        const lum = (h) => {
            const n = parseInt(h.replace('#', ''), 16);
            return (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
        };
        ok(`none of them is black or white on ${colour}`,
            shades.every((s) => lum(s) > 25 && lum(s) < 240), JSON.stringify(shades.map((s) => Math.round(lum(s)))));
    }
}

/* --------------------------------------------------------- freeing a colour */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    const shared = p.Ada.baseColor;
    e.setProfile(r, p.Bo.id, { color: shared });
    ok('sharing moved them both off it', p.Ada.color !== shared);
    e.removePlayer(r, p.Bo.id);
    ok('and leaving gives it back plain', p.Ada.color === shared, p.Ada.color);
}

/* --------------------------------------------------- locked once it matters */
{
    const { r, p } = mk(['Ada', 'Bo'], { start: true });
    const was = p.Ada.color;
    ok('colours are locked mid-game', !!e.setProfile(r, p.Ada.id, { color: '#4cc9f0' }).error);
    ok('and nothing moved', p.Ada.color === was);
    ok('initials still change', !e.setProfile(r, p.Ada.id, { initials: 'ADL' }).error && p.Ada.initials === 'ADL');
}

/* -------------------------------------------------------------- with teams */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.updateSettings(r, p.Ada.id, { teams: true });
    const teamColour = p.Ada.color;
    ok('teams hand out the colours', !!e.setProfile(r, p.Ada.id, { color: '#4cc9f0' }).error);
    ok('so the team colour stands', p.Ada.color === teamColour);

    // Turning teams off gives everyone their own pick back rather than
    // reassigning from the top of the palette.
    e.setProfile(r, p.Ada.id, { initials: 'AD' });
    e.updateSettings(r, p.Ada.id, { teams: false });
    ok('their own colour comes back', p.Ada.color === p.Ada.baseColor, `${p.Ada.color} / ${p.Ada.baseColor}`);
    ok('and the initials survived', p.Ada.initials === 'AD');
}

/* --------------------------------------------- arriving with a profile already */
{
    const r = e.createRoom('LOOK');
    const first = e.addPlayer(r, { name: 'Ada', initials: 'ADL', color: '#3ddc97' }).player;
    ok('a new player can bring one', first.initials === 'ADL' && first.baseColor === '#3ddc97');
    const junk = e.addPlayer(r, { name: 'Bo', initials: '', color: 'nope' }).player;
    ok('junk falls back to a free colour', /^#[0-9a-f]{6}$/.test(junk.baseColor), junk.baseColor);
    ok('and to no initials', junk.initials === null);

    // A refresh carries it back in.
    e.markDisconnected(r, first.id);
    e.addPlayer(r, { name: 'Ada', playerId: first.id, initials: 'XYZ', color: '#ffb648' });
    ok('a rejoin can update it', first.initials === 'XYZ' && first.baseColor === '#ffb648');
}

/* ----------------------------------------------------- an old saved room */
{
    const { r, p } = mk(['Ada', 'Bo']);
    // Rooms written before picks existed only carry a rendered colour.
    for (const q of r.players) delete q.baseColor;
    e.removePlayer(r, p.Bo.id);
    ok('a room from before this still recolours', /^#[0-9a-f]{6}$/.test(p.Ada.color), p.Ada.color);
    ok('and gains a pick to call its own', p.Ada.baseColor === p.Ada.color);
}

/* ------------------------------------------------------------ it is broadcast */
{
    const { r, p } = mk(['Ada', 'Bo']);
    e.setProfile(r, p.Ada.id, { initials: 'ADL' });
    const st = e.publicState(r);
    const mine = st.players.find((q) => q.id === p.Ada.id);
    ok('initials go out', mine.initials === 'ADL');
    ok('so does the pick behind the colour', !!mine.baseColor);
    ok('and the palette to choose from', Array.isArray(st.playerColors) && st.playerColors.length > 4);
    ok('it round-trips as JSON', JSON.parse(JSON.stringify(st)).players[0].initials === 'ADL');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
