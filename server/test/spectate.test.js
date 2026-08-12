// Watching without a seat: who is offered it, what it keeps them out of, and
// that a watcher is nowhere in the machinery that decides the game.
const e = require('../game/engine');

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));

function mk(names, { start = true } = {}) {
    const r = e.createRoom('WATCH');
    const p = {};
    for (const n of names) p[n] = e.addPlayer(r, { name: n, playerId: `pid-${n}` }).player;
    if (start) e.startGame(r, p[names[0]].id);
    return { r, p };
}

/* ------------------------------------------------------- who gets the offer */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    ok('a newcomer mid-game is refused a seat', !!e.addPlayer(r, { name: 'Zed' }).error);
    ok('but is offered a view', !!e.spectateReason(r, 'pid-Zed'), String(e.spectateReason(r, 'pid-Zed')));
    ok('and told why', /already started/.test(e.spectateReason(r, 'pid-Zed')));
}
{
    const { r } = mk(['Ada', 'Bo'], { start: false });
    ok('a lobby with room offers no view', e.spectateReason(r, 'pid-Zed') === null);
    r.settings.maxPlayers = 2;
    ok('a full lobby does', /full/.test(e.spectateReason(r, 'pid-Zed') || ''));
}
{
    // Someone who resigned and closed the tab.
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    e.declareBankruptcy(r, p.Cy.id);
    ok('resigning still bars the seat', !!e.addPlayer(r, { name: 'Cy', playerId: p.Cy.id }).error);
    ok('but they can come back to watch', !!e.spectateReason(r, p.Cy.id));
}
{
    // Going bankrupt on rent isn't resigning — the seat is still theirs.
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    // Out of the game without having chosen to be — what rent does to you.
    p.Cy.cash = 0;
    p.Cy.bankrupt = true;
    ok('rent bankruptcy is not resignation', p.Cy.bankrupt && !p.Cy.resigned);
    ok('so they simply reconnect', !e.addPlayer(r, { name: 'Cy', playerId: p.Cy.id }).error);
    ok('and are not offered a view', e.spectateReason(r, p.Cy.id) === null);
}
{
    // Voted out is the one refusal that stays a refusal.
    const { r, p } = mk(['Ada', 'Bo', 'Cy', 'Di']);
    e.startVoteKick(r, p.Ada.id, p.Bo.id);
    e.castVote(r, p.Cy.id, true);
    e.castVote(r, p.Di.id, true);
    ok('the kick landed', p.Bo.bankrupt);
    ok('and there is no way back in', e.spectateReason(r, p.Bo.id) === null);
    ok('not even as a watcher', !!e.addPlayer(r, { name: 'Bo', playerId: p.Bo.id }).error);
}

/* ------------------------------------------------------------- watching */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    const { spectator } = e.addSpectator(r, { name: 'Zed', playerId: 'pid-Zed' });
    ok('they are in the room', r.spectators.length === 1 && spectator.name === 'Zed');
    ok('and nowhere near the players', r.players.length === 3);
    ok('the table is told', /Zed is watching/.test(r.log.map((l) => l.text).join(' ')));

    // Nothing that decides the game can see them.
    ok('they cannot be voted on', !!e.startVoteKick(r, 'pid-Ada', 'pid-Zed').error);
    ok('they cannot call a vote', !!e.startVoteKick(r, 'pid-Zed', 'pid-Bo').error);
    ok('they cannot roll', !!e.rollDice(r, 'pid-Zed').error);
    ok('they cannot build', !!e.buildHouse(r, 'pid-Zed', 1).error);
    ok('they cannot trade', !!e.createTrade(r, 'pid-Zed', { toId: 'pid-Ada' }).error);
    ok('they cannot start the game', !!e.updateSettings(r, 'pid-Zed', { teams: true }).error);

    // But they can talk.
    ok('they can chat', !e.addChat(r, 'pid-Zed', 'go on then').error);
    ok('and it carries their name', r.chat[r.chat.length - 1].name === 'Zed');
    ok('with a colour to render', !!r.chat[r.chat.length - 1].color);

    // Joining twice is idle, not a duplicate.
    e.addSpectator(r, { name: 'Zed', playerId: 'pid-Zed' });
    ok('watching twice is still one of them', r.spectators.length === 1);

    ok('leaving removes them', e.removeSpectator(r, 'pid-Zed') && r.spectators.length === 0);
    ok('and leaving twice is a no-op', !e.removeSpectator(r, 'pid-Zed'));
}

/* --------------------------------------------- someone already at the table */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    e.declareBankruptcy(r, p.Cy.id);
    const { spectator } = e.addSpectator(r, { name: 'Cy', playerId: p.Cy.id });
    ok('a player who is out is marked as seated', spectator.seated === true);
    ok('and their return is not announced', !/Cy is watching/.test(r.log.map((l) => l.text).join(' ')));
    ok('they are still in the player list', r.players.some((q) => q.id === p.Cy.id));
}

/* -------------------------------------------------- taking a seat afterwards */
{
    const { r, p } = mk(['Ada', 'Bo', 'Cy']);
    e.addSpectator(r, { name: 'Zed', playerId: 'pid-Zed' });
    // A rematch drops the room back to a lobby, where there's a seat going.
    e.resetForRematch(r);
    ok('the lobby is open again', r.phase === 'waiting');
    ok('so no view is offered', e.spectateReason(r, 'pid-Zed') === null);
    ok('and the seat is theirs', !e.addPlayer(r, { name: 'Zed', playerId: 'pid-Zed' }).error);
    ok('they stop being a watcher', r.spectators.length === 0, JSON.stringify(r.spectators));
    void p;
}

/* ------------------------------------------------------------ broadcast */
{
    const { r } = mk(['Ada', 'Bo', 'Cy']);
    ok('none by default', e.publicState(r).spectators.length === 0);
    e.addSpectator(r, { name: 'Zed', playerId: 'pid-Zed' });
    const st = e.publicState(r);
    ok('watchers go out with the state', st.spectators.length === 1 && st.spectators[0].name === 'Zed');
    ok('names only, nothing else', Object.keys(st.spectators[0]).sort().join(',') === 'id,name,seated');
    ok('and it round-trips as JSON', JSON.parse(JSON.stringify(st)).spectators[0].name === 'Zed');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
