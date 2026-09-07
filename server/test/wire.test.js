// Four real socket.io clients playing a 2v2, to prove the events added for
// teams are actually wired up — the engine tests can't catch a typo in index.js.
const { io } = require('socket.io-client');

const URL = 'http://localhost:3001';
const fails = [];
let pass = 0;
const ok = (l, c, e) => (c ? pass++ : fails.push(l + (e ? ` — ${e}` : '')));

function connect(name) {
    return new Promise((res) => {
        const s = io(URL, { auth: { token: 'open' } });
        s.on('connect', () => res({ s, name }));
    });
}

/**
 * Wait for a broadcast that satisfies `pred`. Joins and settings changes each
 * produce their own broadcast, so taking simply the next one races.
 */
function until(c, pred, label = 'state') {
    return new Promise((res, rej) => {
        const timer = setTimeout(() => {
            c.s.off('state', on);
            rej(new Error(`timed out waiting for ${label}`));
        }, 3000);
        const on = (st) => {
            if (!pred(st)) return;
            clearTimeout(timer);
            c.s.off('state', on);
            res(st);
        };
        c.s.on('state', on);
    });
}

/** Settle: no broadcast for 150ms means everything queued has landed. */
function quiet(c) {
    return new Promise((res) => {
        let last = null;
        const on = (st) => (last = st);
        c.s.on('state', on);
        const tick = setInterval(() => {
            if (!last) return;
            clearInterval(tick);
            c.s.off('state', on);
            res(last);
        }, 150);
    });
}

async function main() {
    const [a, b, cc, d] = await Promise.all(['Ada', 'Bo', 'Cy', 'Di'].map(connect));
    const errors = [];
    for (const c of [a, b, cc, d]) c.s.on('error:game', (e) => errors.push(`${c.name}: ${e}`));

    const created = await new Promise((r) => a.s.emit('room:create', { name: 'Ada' }, r));
    const code = created.roomCode;
    a.id = created.playerId;
    for (const c of [b, cc, d]) {
        const j = await new Promise((r) => c.s.emit('room:join', { roomCode: code, name: c.name }, r));
        c.id = j.playerId;
    }

    // Turn teams on — should auto-pair everyone.
    a.s.emit('room:settings', { teams: true });
    let st = await until(a, (s) => s.settings.teams === true, 'teams on');
    ok('teams flag arrives', st.settings.teams === true);
    ok('everyone is paired', st.players.every((p) => p.teamId), JSON.stringify(st.players.map((p) => p.teamId)));
    ok('teams summary is sent', !!st.teams && Object.keys(st.teams).length === 2, JSON.stringify(st.teams));
    ok('team colours are sent', !!st.teamColors?.A);

    // Move Cy onto Ada's team — a side of three, which teams allow now.
    const adaTeam = st.players.find((p) => p.id === a.id).teamId;
    const cyTeam = st.players.find((p) => p.id === cc.id).teamId;
    a.s.emit('room:team', { playerId: cc.id, teamId: adaTeam });
    st = await until(a, (s) => s.players.find((p) => p.id === cc.id)?.teamId === adaTeam, 'cy moved');
    ok('a side can take a third', st.teams[adaTeam].playerIds.length === 3, JSON.stringify(st.teams));

    // Back where they were, so the start below is the even split it checks.
    a.s.emit('room:team', { playerId: cc.id, teamId: cyTeam });
    st = await until(a, (s) => s.players.find((p) => p.id === cc.id)?.teamId === cyTeam, 'cy back');

    // A non-host cannot pick teams.
    const before2 = errors.length;
    b.s.emit('room:team', { playerId: b.id, teamId: 'C' });
    await quiet(b);
    ok('only the host picks teams', errors.length > before2);

    // A fifth player arrives and the host shows them the door. Worth doing over
    // the wire because the removal is only half of it — their socket has to be
    // taken out of the room and told, or they sit watching a lobby they are not
    // in any more.
    const ev = await connect('Ev');
    ev.s.on('error:game', (e) => errors.push(`Ev: ${e}`));
    const evJoin = await new Promise((r) => ev.s.emit('room:join', { roomCode: code, name: 'Ev' }, r));
    st = await until(a, (s) => s.players.length === 5, 'ev joined');
    let closedText = null;
    ev.s.once('room:closed', (t) => (closedText = t));

    const settle = () => new Promise((r) => setTimeout(r, 200));
    const before1 = errors.length;
    b.s.emit('room:kick', { playerId: cc.id });
    await settle();
    ok('only the host removes anyone', errors.length > before1, JSON.stringify(errors.slice(before1)));

    a.s.emit('room:kick', { playerId: evJoin.playerId });
    st = await until(a, (s) => s.players.length === 4, 'ev gone');
    ok('the kicked player is off the roster', !st.players.some((p) => p.id === evJoin.playerId));
    await settle();
    ok('and is told rather than left there', /removed/.test(closedText || ''), String(closedText));

    a.s.emit('game:start');
    st = await until(a, (s) => s.phase === 'rolling', 'game start');
    ok('game starts', st.phase === 'rolling', st.phase);
    ok('turn order interleaves over the wire',
        st.players.map((p) => p.teamId).join('') === 'ABAB',
        st.players.map((p) => `${p.name}:${p.teamId}`).join(' '));

    // Cash transfer, on and off turn.
    const first = st.players[st.turnIndex];
    const me = [a, b, cc, d].find((c) => c.id === first.id);
    const mate = st.players.find((p) => p.teamId === first.teamId && p.id !== first.id);
    const mateClient = [a, b, cc, d].find((c) => c.id === mate.id);

    const cashOf = (s, id) => s.players.find((p) => p.id === id).cash;

    me.s.emit('game:sendCash', { toId: mate.id, amount: 200 });
    st = await until(me, (s) => cashOf(s, mate.id) !== 1500, 'transfer');
    ok('on-turn transfer is free',
        cashOf(st, first.id) === 1300 && cashOf(st, mate.id) === 1700,
        st.players.map((p) => `${p.name}=${p.cash}`).join(' '));

    mateClient.s.emit('game:sendCash', { toId: first.id, amount: 200 });
    st = await until(mateClient, (s) => cashOf(s, mate.id) !== 1700, 'off-turn transfer');
    ok('off-turn transfer charges the fee', cashOf(st, mate.id) === 1700 - 220, `mate=${cashOf(st, mate.id)}`);

    const before3 = errors.length;
    me.s.emit('game:sendCash', { toId: st.players.find((p) => p.teamId !== first.teamId).id, amount: 50 });
    await quiet(me);
    ok('cannot send to an opponent over the wire', errors.length > before3);

    // Bailout event exists and refuses when there's nothing to answer.
    const before4 = errors.length;
    me.s.emit('game:bailout', { accept: true });
    await quiet(me);
    ok('bailout refuses when nothing is offered', errors.length > before4,
        JSON.stringify(errors.slice(before4)));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const c of [a, b, cc, d, ev]) c.s.close();
    process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
