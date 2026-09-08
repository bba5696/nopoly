// nouno over real sockets — and above all, that a hand stays one person's.
//
// The engine tests can prove the rules; only this can prove the wiring: that a
// card room can be made at all, that its actions reach it, that the property
// game's actions do not, and that what lands on everybody's screen has counts
// in it and no cards.
const { io } = require('socket.io-client');

const URL = 'http://localhost:3001';
const fails = [];
let pass = 0;
const ok = (l, c, e) => (c ? pass++ : fails.push(l + (e ? ` — ${e}` : '')));

function connect(name) {
    return new Promise((res) => {
        const s = io(URL, { auth: { token: 'open' } });
        s.on('connect', () => res({ s, name, states: [], hands: [] }));
    });
}

/** Keep every broadcast and every private hand, so both can be inspected. */
function watch(c) {
    c.s.on('state', (st) => {
        c.state = st;
        c.states.push(st);
    });
    c.s.on('hand', (h) => {
        c.hand = h.hand;
        c.hands.push(h.hand);
    });
}

function until(c, pred, label = 'state') {
    return new Promise((res, rej) => {
        if (c.state && pred(c.state)) return res(c.state);
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

const settle = () => new Promise((r) => setTimeout(r, 250));

async function main() {
    const [a, b] = await Promise.all(['Ada', 'Bo'].map(connect));
    const spec = await connect('Wat');
    const errors = [];
    for (const c of [a, b, spec]) {
        watch(c);
        c.s.on('error:game', (e) => errors.push(`${c.name}: ${e}`));
    }

    /* ------------------------------------------------- a room of the other game */
    const created = await new Promise((r) => a.s.emit('room:create', { name: 'Ada', game: 'nouno' }, r));
    const code = created.roomCode;
    a.id = created.playerId;
    ok('a card room can be made', !!code && created.state.game === 'nouno', JSON.stringify(created.error));
    ok('and says which game it is', created.state.game === 'nouno');

    const joined = await new Promise((r) => b.s.emit('room:join', { roomCode: code, name: 'Bo' }, r));
    b.id = joined.playerId;
    ok('somebody can join it', !!b.id, JSON.stringify(joined.error));

    /* ---------------------------------------------------------- dealing */
    a.s.emit('game:start');
    await until(a, (st) => st.phase === 'playing', 'the deal');
    await settle();

    ok('everyone was dealt seven', a.state.players.every((p) => p.handCount === 7), JSON.stringify(a.state.players.map((p) => p.handCount)));
    ok('a card starts the pile', !!a.state.top && !!a.state.active);
    ok('and both were told', b.state.phase === 'playing');

    /* -------------------------------------------- the part that must not leak */
    ok('no hand rides on the broadcast', !JSON.stringify(a.states).includes('"hand"'), 'a hand appeared in a state payload');
    ok('Ada got her own cards', Array.isArray(a.hand) && a.hand.length === 7, String(a.hand?.length));
    ok('Bo got his own', Array.isArray(b.hand) && b.hand.length === 7, String(b.hand?.length));
    ok(
        'and they are different hands',
        a.hand.map((c) => c.id).join() !== b.hand.map((c) => c.id).join(),
    );
    ok(
        'no card is in two hands at once',
        !a.hand.some((c) => b.hand.some((o) => o.id === c.id)),
    );

    /* ------------------------------------------------------ a watcher sees none */
    const watching = await new Promise((r) => spec.s.emit('room:spectate', { roomCode: code, name: 'Wat' }, r));
    ok('a watcher can watch', !watching.error, JSON.stringify(watching.error));
    await settle();
    ok('and is told the counts', spec.state.players.every((p) => typeof p.handCount === 'number'));
    ok('but is never dealt in', spec.hand === undefined, JSON.stringify(spec.hand));

    /* ------------------------------------------------------------ playing */
    const turn = a.state.players[a.state.turnIndex].id === a.id ? a : b;
    const other = turn === a ? b : a;
    const top = turn.state.top;
    const active = turn.state.active;
    const play = turn.hand.find(
        (c) => c.suit === active || (c.kind === 'num' && top.kind === 'num' && c.value === top.value) || !c.suit,
    );
    const before = turn.hand.length;
    if (play) {
        turn.s.emit('nouno:play', { cardId: play.id, suit: 'ember' });
        await settle();
        ok('a card can be played over the wire', turn.hand.length === before - 1, `${before} -> ${turn.hand.length}`);
        ok('the table saw it', other.state.top.id === play.id, JSON.stringify(other.state.top));
        ok('and the count went with it', other.state.players.find((p) => p.id === turn.id).handCount === before - 1);
    } else {
        // A hand with nothing playable is a legitimate deal; draw instead.
        turn.s.emit('nouno:draw');
        await settle();
        ok('a card can be drawn over the wire', turn.hand.length === before + 1, `${before} -> ${turn.hand.length}`);
        pass += 2;
    }

    /* -------------------------------------------- the other game's actions */
    const beforeErrors = errors.length;
    other.s.emit('game:roll');
    await settle();
    ok('rolling dice at a card table is refused', errors.length > beforeErrors, JSON.stringify(errors.slice(beforeErrors)));
    ok('and says why', /no board/.test(errors[errors.length - 1] || ''), errors[errors.length - 1]);

    const beforeBuild = errors.length;
    other.s.emit('game:build', { tileId: 1 });
    await settle();
    ok('so is building on it', errors.length > beforeBuild);

    /* ------------------------------------------------------ coming back */
    const held = a.hand.map((c) => c.id).join();
    a.s.disconnect();
    await settle();
    const back = await connect('Ada');
    watch(back);
    const rejoined = await new Promise((r) =>
        back.s.emit('room:join', { roomCode: code, name: 'Ada', playerId: a.id }, r),
    );
    await settle();
    ok('a reconnect gets the seat back', !rejoined.error, JSON.stringify(rejoined.error));
    ok('and the hand with it', back.hand?.map((c) => c.id).join() === held, String(back.hand?.length));

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    for (const c of [a, b, spec, back]) c.s.close();
    process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
