// Vote-kick: who may call one, what counts as a majority, what a kick does to
// the estate, and that the person removed can't simply walk back in.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

// A table where a vote is allowed to be called at all: an hour into the game.
// The opening minutes are their own rule, tested on their own below — every
// block that isn't about them wants them out of the way.
function mk(names, { start = true, open = true } = {}) {
    const r = e.createRoom('VOTE');
    // Room for the twelve-player tables the thresholds are checked against.
    r.settings.maxPlayers = 99;
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n }).player;
    if (start) e.startGame(r, p[names[0]].id);
    if (start && open) r.stats.startedAt = Date.now() - 60 * 60_000;
    return { r, p };
}

/* ---------------------------------------------------------- the thresholds */
{
    // The table the rule was specified as: everyone else up to four, or
    // two-thirds of them, whichever is more — so a small table stays unanimous
    // and a big one cannot be run by four friends.
    for (const [players, need] of [[3, 2], [4, 3], [5, 4], [6, 4], [7, 4], [8, 5], [10, 6], [12, 8]]) {
        const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi', 'Gu', 'Ha', 'Ia', 'Jo', 'Ki', 'Lu'].slice(0, players);
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
    ok('and it is locked off the market', r.tiles[tile.id].lockedUntil > r.stats.turnCount, String(r.tiles[tile.id].lockedUntil));
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
    // No cooldown on either end any more: the table can try again straight
    // away, and the majority is still what decides.
    ok('the same player can be voted on again', !e.startVoteKick(r, p.Di.id, p.Bo.id).error);
}

/* ------------------------------------------------------ no rules left to trip */
{
    // Once the game is five minutes in and there are three players, a vote can
    // be called on anyone still at the table — whether or not the clock has
    // ever played for them, and however recently the caller called one.
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev']);
    ok('a player taking their turns can be voted on', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    e.castVote(r, p.Cy.id, false);
    ok('the vote is over', r.vote === null && !p.Bo.bankrupt);
    ok('the caller can call the next one straight away', !e.startVoteKick(r, p.Ada.id, p.Cy.id).error);
    ok('and the publicState no longer carries cooldowns', !('voteCooldown' in e.publicState(r)));

    // Someone who has gone is still a countdown, not a ballot.
    const { r: r3, p: p3 } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    p3.Bo.connected = false;
    ok('a player who dropped out gets a countdown', !e.startVoteKick(r3, p3.Ada.id, p3.Bo.id).error && r3.vote?.mode === 'abandon');
    ok('of two minutes', r3.vote.endsAt - r3.vote.startedAt === 2 * 60_000, String(r3.vote.endsAt - r3.vote.startedAt));
}

/* ------------------------------------ only voters who can answer are counted */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi', 'Gu', 'Ha']);
    // Eight players is seven voters and a bar of five — with two tabs closed,
    // five who can answer and a bar of four.
    p.Gu.connected = false;
    p.Ha.connected = false;
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    ok('a closed tab is not counted towards the bar', r.vote.needed === 4, String(r.vote.needed));
    e.castVote(r, p.Cy.id, true);
    p.Cy.connected = false;
    e.castVote(r, p.Di.id, false);
    ok('a voter who drops after voting is still counted', r.vote?.needed === 4, JSON.stringify(r.vote));
}

/* --------------------------------------------- four friends are not a big table */
{
    const names = ['Ada', 'Bo', 'Cy', 'Di', 'Ev', 'Fi', 'Gu', 'Ha', 'Ia', 'Jo', 'Ki', 'Lu'];
    const { r, p } = mk(names);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    for (const n of ['Cy', 'Di', 'Ev']) e.castVote(r, p[n].id, true);
    ok('four yeses do not remove anyone from twelve', r.vote !== null && !p.Bo.bankrupt, JSON.stringify(r.vote));
    for (const n of ['Fi', 'Gu', 'Ha', 'Ia']) e.castVote(r, p[n].id, true);
    ok('eight do', r.vote === null && p.Bo.bankrupt);
}

/* ------------------------------------------ a kick locks the estate for a while */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Bo.id;
    p.Bo.properties.push(tile.id);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.castVote(r, p.Cy.id, true);
    e.castVote(r, p.Di.id, true);
    ok('voted out', p.Bo.bankrupt);
    ok('the estate is locked', tile.lockedUntil > r.stats.turnCount);
    ok(
        'for five rounds of whoever is left',
        tile.lockedUntil - r.stats.turnCount === 5 * 3,
        String(tile.lockedUntil - r.stats.turnCount),
    );
    ok('and the feed says so', r.log.some((l) => /locked for 5 rounds/.test(l.text)));

    // Nobody can take it at auction.
    e.startAuction(r, tile.id);
    ok('a locked tile cannot be auctioned', r.auction === null);

    // Landing on it: no offer to buy, and rent to the bank.
    const lander = p.Cy;
    lander.cash = 1000;
    lander.position = tile.id;
    r.pendingAction = null;
    e.resolveLanding(r, lander, [3, 4]);
    ok('landing offers nothing to buy', r.pendingAction === null && r.auction === null, JSON.stringify(r.pendingAction));
    ok('but charges its rent', lander.cash === 1000 - tile.rent[0], String(lander.cash));
    ok('paid to the bank', r.lastPayment?.toId === null && r.lastPayment?.amount === tile.rent[0], JSON.stringify(r.lastPayment));

    // Once the rounds are up it is an ordinary tile again.
    r.stats.turnCount = tile.lockedUntil;
    lander.cash = 1000;
    e.resolveLanding(r, lander, [3, 4]);
    ok('after the lock it can be bought', r.pendingAction?.type === 'buy' && r.pendingAction.tileId === tile.id, JSON.stringify(r.pendingAction));
    ok('with no rent charged', lander.cash === 1000, String(lander.cash));
}

/* ------------------------------------- a dropout and an admin kick lock nothing */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const tile = r.tiles.find((t) => t.type === 'property');
    tile.ownerId = p.Bo.id;
    p.Bo.properties.push(tile.id);
    p.Bo.connected = false;
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.expireVote(r);
    ok('a dropout is removed', p.Bo.bankrupt);
    ok('and their estate is not locked', !tile.lockedUntil);

    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    const t2 = r2.tiles.find((t) => t.type === 'property');
    t2.ownerId = p2.Bo.id;
    p2.Bo.properties.push(t2.id);
    e.adminKick(r2, p2.Bo.id);
    ok('an admin kick locks nothing either', p2.Bo.bankrupt && !t2.lockedUntil);
}

/* ------------------------------------------------------ the opening minutes */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di'], { open: false });
    const why = e.startVoteKick(r, p.Ada.id, p.Bo.id).error || '';
    ok('nobody can be kicked in the first minutes', !!why, why);
    ok('and the refusal says when it opens', /kicking opens/.test(why), why);

    // Five minutes flat, whatever the size of the table.
    ok('the window is broadcast', e.publicState(r).voteOpensAt === r.stats.startedAt + 5 * 60_000);
    r.stats.startedAt = Date.now() - 4 * 60_000;
    ok('four minutes in, still closed', !!e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    r.stats.startedAt = Date.now() - 5 * 60_000 - 1000;
    ok('past it, the vote runs', !e.startVoteKick(r, p.Ada.id, p.Bo.id).error);
    ok('and the minimum is broadcast too', e.publicState(r).minVoters === 3);

    // The lobby has no turns to be slow about, and a stranger in the room is
    // the one thing a vote is for there.
    const { r: r2, p: p2 } = mk(['Ada', 'Bo', 'Cy'], { start: false });
    ok('the lobby is exempt', !e.startVoteKick(r2, p2.Ada.id, p2.Bo.id).error);
    ok('with no window to wait for', e.publicState(r2).voteOpensAt === null);
}

/* ------------------------------------------------------- the log names names */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    const started = r.log.at(-1).text;
    ok('the caller is named', /Ada started a vote to kick Bo/.test(started), started);
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
    ok('last game\'s stalls do not carry over', r.players.every((q) => !q.lastStallAt));
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
