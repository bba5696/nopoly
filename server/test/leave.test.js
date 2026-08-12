// Leaving a room. The bug: room:leave only flipped a `connected` flag, so a
// lobby leaver kept their seat, their team slot, and — if they were host — the
// ability to start the game, which then belonged to nobody.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

const mk = (names, settings = {}) => {
    const r = e.createRoom('LEAVE');
    Object.assign(r.settings, settings);
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    return { r, p };
};

/* ------------------------------------------------------- lobby: real leave */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    e.removePlayer(r, p.Bo.id);
    ok('leaver is gone from the roster', r.players.length === 2, r.players.map((q) => q.name).join(','));
    ok('the right one left', !r.players.some((q) => q.id === p.Bo.id));
    ok('nobody else is disturbed', r.players.map((q) => q.name).join(',') === 'Ada,Cy');
    ok('the seat is free again', e.publicState(r).players.length === 2);
}

/* ------------------------------------------------------ lobby: host leaves */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    ok('Ada starts as host', r.hostId === p.Ada.id);
    e.removePlayer(r, p.Ada.id);
    ok('the host role passes on', r.hostId === p.Bo.id, r.hostId);
    ok('the new host can change settings', !e.updateSettings(r, p.Bo.id, { startingCash: 800 }).error);
    ok('and can start the game', !e.startGame(r, p.Bo.id).error);
}

/* -------------------------------------------------- lobby: last one leaves */
{
    const { r, p } = mk(['Ada']);
    e.removePlayer(r, p.Ada.id);
    ok('an emptied room survives without a host', r.players.length === 0 && r.hostId === null);
    ok('and can still be joined', !!e.addPlayer(r, { name: 'Zed' }).player && r.players.length === 1);
    ok('the newcomer becomes host', r.hostId === r.players[0].id);
}

/* ---------------------------------------------------- lobby: cap is freed */
{
    const { r, p } = mk(['Ada', 'Bo'], { maxPlayers: 2 });
    ok('room is full', !!e.addPlayer(r, { name: 'Cy' }).error);
    e.removePlayer(r, p.Bo.id);
    ok('leaving frees the seat', !e.addPlayer(r, { name: 'Cy' }).error, 'still full');
}

/* ------------------------------------------------------- lobby with teams */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.updateSettings(r, p.Ada.id, { teams: true });
    const boTeam = p.Bo.teamId;
    ok('Bo has a team', !!boTeam);
    e.removePlayer(r, p.Bo.id);
    ok('the team slot is freed', r.players.filter((q) => q.teamId === boTeam).length === 1);
    ok('a short team blocks the start', !!e.startGame(r, p.Ada.id).error);
    // Someone new can take the empty slot.
    const zed = e.addPlayer(r, { name: 'Zed' }).player;
    e.setTeam(r, p.Ada.id, zed.id, boTeam);
    ok('the replacement fits', !e.startGame(r, p.Ada.id).error, JSON.stringify(e.startGame(r, p.Ada.id)));
}

/* ------------------------------------------ mid-game: the seat is kept */
{
    const { r, p } = mk(['Ada', 'Bo']);
    e.startGame(r, p.Ada.id);
    const res = e.removePlayer(r, p.Bo.id);
    ok('mid-game leaving keeps the seat', r.players.length === 2 && res.kept === true, JSON.stringify(res));
    ok('they are marked away, not deleted', r.players.find((q) => q.id === p.Bo.id).connected === false);
    ok('the host does not change', r.hostId === p.Ada.id);
}

/* --------------------------------------------- grace period after a drop */
{
    const { r, p } = mk(['Ada', 'Bo']);
    e.markDisconnected(r, p.Bo.id);
    ok('a disconnect alone keeps the seat', r.players.length === 2);
    ok('grace expiry frees it in the lobby', e.dropIfStillGone(r, p.Bo.id) && r.players.length === 1);

    const { r: r2, p: p2 } = mk(['Ada', 'Bo']);
    e.markDisconnected(r2, p2.Bo.id);
    // Coming back before the timer fires — a refresh — must keep the seat.
    e.addPlayer(r2, { name: 'Bo', playerId: p2.Bo.id });
    ok('a refresh inside the grace period keeps the seat',
        !e.dropIfStillGone(r2, p2.Bo.id) && r2.players.length === 2);

    const { r: r3, p: p3 } = mk(['Ada', 'Bo']);
    e.startGame(r3, p3.Ada.id);
    e.markDisconnected(r3, p3.Bo.id);
    ok('grace expiry never removes anyone mid-game',
        !e.dropIfStillGone(r3, p3.Bo.id) && r3.players.length === 2);
}

/* ------------------------------------------------------------- bad input */
{
    const { r } = mk(['Ada']);
    ok('unknown player is refused', !!e.removePlayer(r, 'nope').error);
    ok('unknown player is refused by the timer too', !e.dropIfStillGone(r, 'nope'));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
