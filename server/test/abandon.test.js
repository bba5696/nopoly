// Calling a kick on someone who has already dropped out: a clock instead of a
// ballot, and the only way out of it is coming back.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { start = true } = {}) {
    const r = e.createRoom('GONE');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    if (start) e.startGame(r, p[names[0]].id);
    // Old enough for a vote, with everyone recently played for by the clock.
    // Both are rules of their own, covered in vote.test.js; here they'd only
    // stand between these tests and the thing they're actually about.
    if (start) {
        r.stats.startedAt = Date.now() - 60 * 60_000;
        for (const q of r.players) q.lastStallAt = Date.now();
    }
    return { r, p };
}

/* ------------------------------------------------------- a clock, not a vote */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.markDisconnected(r, p.Bo.id);
    ok('a kick on someone away starts', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    ok('it is a countdown', r.vote.mode === 'abandon', JSON.stringify(r.vote));
    ok('nobody has voted', r.vote.yes.length === 0 && r.vote.no.length === 0);
    ok('and nothing is needed', r.vote.needed === 0);
    ok('it runs for two minutes', Math.round((r.vote.endsAt - r.vote.startedAt) / 1000) === 120,
        String(r.vote.endsAt - r.vote.startedAt));
    ok('votes are refused', !!e.castVote(r, p.Cy.id, true).error);
    ok('the target is still in', !p.Bo.bankrupt);
    ok('no second vote alongside it', !!e.startVoteKick(r, p.Cy.id, p.Di.id).error);
}

/* --------------------------------------------------------- coming back wins */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Bo.id;
    p.Bo.properties.push(tile.id);

    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('the clock is running', r.vote?.mode === 'abandon');
    e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id });
    ok('reconnecting drops it', r.vote === null);
    ok('they keep everything', !p.Bo.bankrupt && r.tiles[tile.id].ownerId === p.Bo.id);
    ok('and no cooldown was set', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    ok('now connected, it is a ballot', r.vote.mode === 'ballot', JSON.stringify(r.vote));
}

/* ------------------------------------------------- running out of the clock */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Bo.id;
    tile.houses = 3;
    p.Bo.properties.push(tile.id);

    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.expireVote(r);
    ok('still gone means out', p.Bo.bankrupt);
    ok('their estate went back to the bank', r.tiles[tile.id].ownerId === null && r.tiles[tile.id].houses === 0);
    ok('the clock is cleared', r.vote === null);
    ok('and they cannot rejoin', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
    ok('the game carries on', r.phase !== 'ended', r.phase);
}

/* ------------------------------------- back on the last second, not too late */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    // Straight back in, then the timer fires anyway — the check is made when
    // the clock runs out, not when it started.
    p.Bo.connected = true;
    e.expireVote(r);
    ok('a late reconnect still saves them', !p.Bo.bankrupt);
    ok('and the clock is gone', r.vote === null);
}

/* ---------------------------------------------------------- two-player games */
{
    const { r, p } = mk(['Ada', 'Bo']);
    ok('two players cannot hold a ballot', !!e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    e.markDisconnected(r, p.Bo.id);
    ok('but can start a countdown', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    ok('which is what unsticks the game', r.vote?.mode === 'abandon');
    e.expireVote(r);
    ok('and it ends the game', p.Bo.bankrupt && r.phase === 'ended', r.phase);
}

/* ------------------------------------------ a countdown in the lobby */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy'], { start: false });
    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.expireVote(r);
    ok('the seat is freed rather than bankrupted', r.players.length === 2);
    ok('they are gone from the roster', !r.players.some((q) => q.id === p.Bo.id));
    ok('and banned', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
}

/* ------------------------------- a countdown on someone who exits some other way */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    // They resign from another tab, or lose everything paying rent.
    e.declareBankruptcy(r, p.Bo.id);
    ok('the countdown does not outlive its target', r.vote === null, JSON.stringify(r.vote));
    ok('so it cannot block the next vote', !e.startVoteKick(r, p.Ada.id, p.Cy.id).error);
}

/* ------------------------------------------------ surviving a redeploy */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    // A restart hands everyone back disconnected, moments before the deadline.
    r.vote.endsAt = Date.now() + 200;
    for (const q of r.players) q.connected = false;
    e.refreshAbandonDeadline(r);
    ok('the clock starts over after a restart', r.vote.endsAt - Date.now() > 110_000,
        String(r.vote.endsAt - Date.now()));
    ok('so the restart itself kicks nobody', !p.Bo.bankrupt);
}

/* -------------------------------------------------------- state is public */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.markDisconnected(r, p.Bo.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    const st = e.publicState(r);
    ok('the countdown is broadcast', st.vote?.mode === 'abandon', JSON.stringify(st.vote));
    ok('with both ends of its window', st.vote.startedAt < st.vote.endsAt);
    ok('and it round-trips as JSON', JSON.parse(JSON.stringify(st)).vote.mode === 'abandon');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
