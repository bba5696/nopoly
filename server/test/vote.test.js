// Vote-kick: who may call one, what counts as a majority, what a kick does to
// the estate, and that the person removed can't simply walk back in.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

// A table where a vote is allowed to be called at all: an hour into the game,
// with everyone recently stalled. Both are their own rules, tested on their own
// below — every block that isn't about them wants them out of the way.
function mk(names, { start = true, open = true } = {}) {
    const r = e.createRoom('VOTE');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    if (start) e.startGame(r, p[names[0]].id);
    if (start && open) {
        r.stats.startedAt = Date.now() - 60 * 60_000;
        for (const q of r.players) q.lastStallAt = Date.now();
    }
    return { r, p };
}

/* ---------------------------------------------------------- the thresholds */
{
    // The table the rule was specified as: everyone else has to agree, to a
    // ceiling of four.
    for (const [players, need] of [[3, 2], [4, 3], [5, 4], [6, 4], [8, 4]]) {
        const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi', 'Gu', 'Ha'].slice(0, players);
        const { r, p } = mk(names);
        e.startVoteKick(r, p.Ada.id, p.Bo.id);
        const got = r.vote ? r.vote.needed : 'resolved';
        ok(`${players} players need ${need}`, got === need, String(got));
    }
}

/* ------------------------------------------------------------- who can call */
{
    const { r, p } = mk(['Ada', 'Bo']);
    ok('two players is too few', !!e.startVoteKick(r, p.Ada.id, p.Bo.id).error,
        JSON.stringify(e.startVoteKick(r, p.Ada.id, p.Bo.id)));
}
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    ok('you cannot vote yourself out', !!e.startVoteKick(r, p.Ada.id, p.Ada.id).error);
    ok('unknown target refused', !!e.startVoteKick(r, p.Ada.id, 'nope').error);
    ok('a vote starts', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    ok('the caller has already voted yes', r.vote.yes.length === 1 && r.vote.yes[0] === p.Ada.id);
    ok('4 players need 3', r.vote.needed === 3, String(r.vote.needed));
    ok('only one vote runs at a time', !!e.startVoteKick(r, p.Cy.id, p.Di.id).error);
    ok('the target cannot vote', !!e.castVote(r, p.Bo.id, false).error);
    ok('you cannot vote twice', !!e.castVote(r, p.Ada.id, true).error);
}

/* --------------------------------------------------------- passing a vote */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    // Give Bo something to lose.
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Bo.id;
    tile.houses = 2;
    p.Bo.properties.push(tile.id);

    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('one of three is not enough', r.vote !== null && r.vote.needed === 3);
    e.castVote(r, p.Cy.id, true);
    ok('two of three is still not enough', r.vote !== null && !p.Bo.bankrupt);
    e.castVote(r, p.Di.id, true);
    ok('the last yes ends the vote immediately', r.vote === null);
    ok('the target is out', p.Bo.bankrupt);
    ok('their estate went to the bank', r.tiles[tile.id].ownerId === null && r.tiles[tile.id].houses === 0);
    ok('nobody inherited it', !r.players.some((q) => q.properties.includes(tile.id)));
    ok('and they are banned', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
    ok('the game continues', r.phase !== 'ended', r.phase);
    ok('others are untouched', !p.Cy.bankrupt && !p.Di.bankrupt);
}

/* --------------------------------------------------------- failing a vote */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    // Unanimity means a single no ends it — the bar is already unreachable.
    e.castVote(r, p.Cy.id, false);
    ok('one no ends it early', r.vote === null);
    ok('the target stays', !p.Bo.bankrupt);
    // Two separate cooldowns land here, so this one is read off a caller who
    // hasn't just spent one: Ada's own is what the next block is about.
    ok('a cooldown is set', !!e.startVoteKick(r, p.Di.id, p.Bo.id).error);
    ok('the cooldown names a wait', /try again in/.test(e.startVoteKick(r, p.Di.id, p.Bo.id).error || ''));
    ok('someone else can still be voted on', !e.startVoteKick(r, p.Di.id, p.Cy.id).error);
}

/* ------------------------------------------------- the cooldown on a caller */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.castVote(r, p.Cy.id, false);
    ok('the vote is over', r.vote === null && !p.Bo.bankrupt);
    const again = e.startVoteKick(r, p.Ada.id, p.Cy.id).error || '';
    ok('the caller cannot move straight on to the next name', !!again, again);
    ok('and is told how long', /before starting another/.test(again), again);
    ok('somebody else can call one', !e.startVoteKick(r, p.Di.id, p.Cy.id).error);

    // Winning is not a way round it — three kicks back to back is the same
    // harassment whether or not the table went along with them.
    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev']);
    e.startVoteKick(r2, p2.Ada.id, p2.Bo.id);
    e.castVote(r2, p2.Cy.id, true);
    e.castVote(r2, p2.Di.id, true);
    e.castVote(r2, p2.Ev.id, true);
    ok('the kick landed', p2.Bo.bankrupt);
    ok('the winner waits too', !!e.startVoteKick(r2, p2.Ada.id, p2.Cy.id).error);
}

/* ------------------------------------------- only someone the clock played for */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { open: false });
    r.stats.startedAt = Date.now() - 60 * 60_000;
    const why = e.startVoteKick(r, p.Ada.id, p.Bo.id).error || '';
    ok('a player taking their turns cannot be voted on', !!why, why);
    ok('and the refusal says so', /taking their turns/.test(why), why);

    p.Bo.lastStallAt = Date.now();
    ok('a stalled turn opens it', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);

    // Long enough ago and it stops counting, or one blip at minute ten leaves
    // you kickable for the rest of the game.
    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy', 'Di'], { open: false });
    r2.stats.startedAt = Date.now() - 60 * 60_000;
    p2.Bo.lastStallAt = Date.now() - 11 * 60_000;
    ok('a stall from half an hour ago is not grounds', !!e.startVoteKick(r2, p2.Ada.id, p2.Bo.id).error);

    // Someone who has gone is a countdown, which none of this applies to.
    const { r: r3, p: p3 } = mk(['Ada', 'Bo', 'Cy', 'Di'], { open: false });
    r3.stats.startedAt = Date.now() - 60 * 60_000;
    p3.Bo.connected = false;
    ok('a player who dropped out needs no stall', !e.startVoteKick(r3, p3.Ada.id, p3.Bo.id).error);
    ok('and it is a countdown', r3.vote?.mode === 'abandon');
}

/* ------------------------------------------------------ the opening minutes */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { open: false });
    for (const q of r.players) q.lastStallAt = Date.now();
    const why = e.startVoteKick(r, p.Ada.id, p.Bo.id).error || '';
    ok('nobody can be kicked in the first minutes', !!why, why);
    ok('and the refusal says when it opens', /kicking opens/.test(why), why);

    // Two minutes, plus one per player — six for this table.
    ok('the window is broadcast', e.publicState(r).voteOpensAt === r.stats.startedAt + 6 * 60_000);
    r.stats.startedAt = Date.now() - 6 * 60_000;
    ok('past it, the vote runs', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);

    // The lobby has no turns to be slow about, and a stranger in the room is
    // the one thing a vote is for there.
    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy'], { start: false });
    ok('the lobby is exempt', !e.startVoteKick(r2, p2.Ada.id, p2.Bo.id).error);
    ok('with no window to wait for', e.publicState(r2).voteOpensAt === null);
}

/* ------------------------------------------------------- the log names names */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    p.Bo.stalls = 3;
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    const started = r.log.at(-1).text;
    ok('the caller is named', /Ada started a vote to kick Bo/.test(started), started);
    ok('with the grounds', /played 3 of their turns/.test(started), started);
    e.castVote(r, p.Cy.id, false);
    const done = r.log.at(-1).text;
    ok('the voters are named', /yes: Ada/.test(done) && /no: Cy/.test(done), done);
}

/* ----------------------------------------------------------- the clock */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('a deadline is set', r.vote.endsAt > Date.now());
    e.expireVote(r);
    ok('expiring short of the bar fails it', r.vote === null && !p.Bo.bankrupt);

    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi']);
    e.startVoteKick(r2, p2.Ada.id, p2.Bo.id);
    ok('six players cap at four', r2.vote.needed === 4, String(r2.vote.needed));
    e.castVote(r2, p2.Cy.id, true);
    e.castVote(r2, p2.Di.id, true);
    ok('three of four is not there yet', r2.vote !== null && !p2.Bo.bankrupt);
    e.castVote(r2, p2.Ev.id, true);
    ok('the cap is reached without every voter', r2.vote === null && p2.Bo.bankrupt);
    ok('and one voter never had to answer', !p2.Fi.bankrupt);
}

/* ------------------------------------------- a voter leaving mid-vote */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('needs four of five', r.vote.needed === 4);
    // Two undecided voters resign, leaving three eligible — the bar drops to 3.
    e.declareBankruptcy(r, p.Ev.id);
    e.declareBankruptcy(r, p.Fi.id);
    ok('the bar is recounted downward', r.vote?.needed === 3, JSON.stringify(r.vote));
    ok('but it does not pass on one vote', !p.Bo.bankrupt);
    e.castVote(r, p.Cy.id, true);
    e.castVote(r, p.Di.id, true);
    ok('the recounted bar carries it', r.vote === null && p.Bo.bankrupt);
}

/* ------------------------------------------------------- kicking in a lobby */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy'], { start: false });
    ok('a lobby vote runs', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    // Three players means two eligible voters, so one person can never remove
    // another on their own — the other has to agree.
    ok('the caller alone is not enough', r.vote !== null && r.vote.needed === 2);
    ok('nobody has been removed yet', r.players.length === 3);
    e.castVote(r, p.Cy.id, true);
    ok('the second vote carries it', r.vote === null);
    ok('the seat is freed rather than bankrupted', r.players.length === 2 && !r.players.some((q) => q.id === p.Bo.id));
    ok('and they cannot rejoin', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
    ok('a fresh player still can', !e.addPlayer(r, { name: 'Zed' }).error);
}

/* -------------------------------------------------- bankrupt players silent */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.declareBankruptcy(r, p.Di.id);
    ok('a bankrupt player cannot call a vote', !!e.startVoteKick(r, p.Di.id, p.Bo.id).error);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('two eligible voters need two', r.vote?.needed === 2, JSON.stringify(r.vote));
    ok('a bankrupt player cannot vote', !!e.castVote(r, p.Di.id, true).error);
    ok('you cannot vote on someone already out', !!e.startVoteKick(r, p.Ada.id, p.Di.id).error);
}

/* ------------------------------------------------- survives a rematch reset */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.castVote(r, p.Cy.id, true);
    e.castVote(r, p.Di.id, true);
    ok('the kick landed before the reset', p.Bo.bankrupt);
    e.resetForRematch(r);
    ok('no vote carries over', r.vote === null);
    ok('cooldowns are cleared', Object.keys(r.voteCooldown).length === 0);
    ok('and so are the callers\' own', Object.keys(r.callerCooldown).length === 0);
    ok('last game\'s stalls are not grounds in this one', r.players.every((q) => !q.lastStallAt));
    ok('the ban does carry over', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
}

/* -------------------------------------------------------- state is public */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    ok('no vote by default', e.publicState(r).vote === null);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    const st = e.publicState(r);
    ok('the running vote is broadcast', st.vote?.targetId === p.Bo.id, JSON.stringify(st.vote));
    ok('with its tally and deadline', st.vote.needed === 3 && st.vote.endsAt > Date.now());
    ok('and it round-trips as JSON', JSON.parse(JSON.stringify(st)).vote.targetId === p.Bo.id);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
