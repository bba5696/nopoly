// A paused game stays exactly as it was until it resumes.
//
// A pause is how a table says "we'll finish this later", which means everyone
// is about to leave. So what is under test is everything that acts on a table
// on its own — the turn clock, skipping an absent player, the countdown to
// remove somebody who has gone — and that none of it touches a paused game.
const e = require('../game/engine');
const nouno = require('../game/nouno/rules');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(game) {
    const r = e.createRoom('PAUS', game ? { game } : {});
    const p = {};
    for (const n of ['Ada', 'Bo', 'Cy']) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    e.startGame(r, p.Ada.id);
    return { r, p };
}

/* ------------------------------------------------------------ the clocks stop */
{
    const { r, p } = mk();
    e.armIdle(r);
    ok('a running game has a turn clock', !!r.idle);

    const before = Date.now();
    ok('pausing works', !e.adminPause(r, true).error);
    ok('and says when it started', r.pausedAt >= before);
    ok('the turn clock stops', r.idle === null);
    e.armIdle(r);
    ok('and cannot be re-armed while paused', r.idle === null);

    const st = e.publicState(r);
    ok('the table is told how long it is kept', st.pausedUntil === r.pausedAt + e.PAUSED_ROOM_MS, String(st.pausedUntil));

    // A clock armed just before the pause, coming due during it.
    const current = r.players[r.turnIndex];
    r.idle = { playerId: current.id, endsAt: Date.now() };
    const stalls = current.stalls || 0;
    const turn = r.turnIndex;
    const feed = r.log.length;
    e.expireIdle(r);
    ok('a clock that comes due during a pause counts no stall', (current.stalls || 0) === stalls);
    ok('plays no turn', r.turnIndex === turn);
    ok('and writes nothing to the feed', r.log.length === feed, r.log.slice(feed).map((l) => l.text).join(' / '));

    // Whoever is up leaves the paused game.
    e.markDisconnected(r, current.id);
    ok('an absent player s turn is not skipped', e.skipIfStillGone(r, current.id) === false && r.turnIndex === turn);

    ok('resuming works', !e.adminPause(r, false).error);
    ok('and clears when it was paused', r.pausedAt === null && e.publicState(r).pausedUntil === null);
    ok('the turn clock comes back', !!r.idle);
    ok('for whoever is up', r.idle?.playerId === r.players[r.turnIndex].id);
}

/* ------------------------------------------------------ nobody is voted out */
{
    const { r, p } = mk();
    e.markDisconnected(r, p.Cy.id);
    ok('a countdown on somebody gone can start', !e.startVoteKick(r, p.Ada.id, p.Cy.id).error);
    e.adminPause(r, true);
    ok('pausing calls it off', r.vote === null);
    ok('and the feed says why', r.log.some((l) => /vote on Cy was called off — the game is paused/.test(l.text)));
    const again = e.startVoteKick(r, p.Ada.id, p.Cy.id);
    ok('no new vote while paused', /paused/.test(again.error || ''), again.error);
    ok('so the absent player is still in the game', !p.Cy.resigned && !r.banned.includes(p.Cy.id));
}

/* --------------------------------------------- resuming gives the room time */
{
    const { r } = mk();
    e.adminPause(r, true);
    // An hour away: everyone gone, nothing sent.
    r.emptySince = Date.now() - 60 * 60 * 1000;
    r.lastActionAt = Date.now() - 60 * 60 * 1000;
    const before = Date.now();
    e.adminPause(r, false);
    ok('resuming restarts the empty window', r.emptySince === null);
    ok('and the quiet one', r.lastActionAt >= before);
}

/* ------------------------------------------------------------ the card game */
{
    const { r } = mk('nouno');
    const current = r.players[r.turnIndex];
    e.adminPause(r, true);
    r.drawnThisTurn = true;
    ok('no passing in a paused card game', /paused/.test(nouno.pass(r, current.id).error || ''));
    r.choosing = { playerId: current.id, cardId: 'x' };
    ok('no naming a suit either', /paused/.test(nouno.chooseSuit(r, current.id, { suit: 'tide' }).error || ''));
    ok('no drawing', /paused/.test(nouno.drawCard(r, current.id).error || ''));
}

/* ------------------------------------------------------------- a rematch */
{
    const { r, p } = mk();
    e.adminPause(r, true);
    r.phase = 'ended';
    e.resetForRematch(r, p.Ada.id);
    ok('a rematch starts unpaused', !r.paused && r.pausedAt === null);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
