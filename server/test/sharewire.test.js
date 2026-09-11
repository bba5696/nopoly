// Shared end screens: one game, one link.
//
// Everyone at a table can share the same game from their own history, and a
// Share pressed twice used to make two links to the same thing. What is under
// test is that the same game hands back the link it already has — with its
// hour started again — and that anything actually different still gets its own.
const URL = process.env.TEST_URL || 'http://localhost:3001';

let pass = 0;
const fails = [];
const ok = (l, c, x) => (c ? pass++ : fails.push(l + (x ? ` — ${x}` : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const game = (over = {}) => ({
    game: 'nopoly',
    nickname: '',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_900_000,
    boardName: 'Classic',
    winnerIds: ['a'],
    players: [
        { id: 'a', name: 'Ada', color: '#ff5c7c', netWorth: 2400 },
        { id: 'b', name: 'Bo', color: '#4cc9f0', netWorth: 0, bankrupt: true },
    ],
    series: [{ turn: 1, values: { a: 1500, b: 1500 } }, { turn: 2, values: { a: 2400, b: 0 } }],
    facts: { turnCount: 40, doubles: 3, trades: 1, chatMessages: 5 },
    ...over,
});

const share = async (body) => {
    const res = await fetch(`${URL}/api/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, ...(await res.json()) };
};

(async () => {
    const first = await share(game());
    ok('a game can be shared', first.status === 200 && !!first.id, JSON.stringify(first));

    await sleep(30);
    const again = await share(game());
    ok('sharing the same game again gives the same link', again.id === first.id, `${first.id} vs ${again.id}`);
    ok('and says it was reused', again.reused === true);
    ok('with its hour started again', again.expiresAt > first.expiresAt, `${first.expiresAt} -> ${again.expiresAt}`);

    // The same game from somebody else's history: identical data, another
    // browser. Nothing on the request says who sent it, so it is the same link.
    const fromAFriend = await share(JSON.parse(JSON.stringify(game())));
    ok('the same game from another player is the same link', fromAFriend.id === first.id);

    const named = await share(game({ nickname: 'The one where Bo gave up' }));
    ok('a game given a name is a different thing to send', named.id !== first.id);
    const namedAgain = await share(game({ nickname: 'The one where Bo gave up' }));
    ok('but the same name again is the same link', namedAgain.id === named.id);

    const other = await share(game({ endedAt: 1_700_000_999_000 }));
    ok('a different game gets its own link', other.id !== first.id);

    const opened = await (await fetch(`${URL}/api/share/${first.id}`)).json();
    ok('the reused link still opens', opened.entry?.players?.[0]?.name === 'Ada');
    ok('and reports the renewed deadline', opened.expiresAt === fromAFriend.expiresAt, `${opened.expiresAt} vs ${fromAFriend.expiresAt}`);

    // Reuse costs nothing, so it never counts against the per-address limit.
    let refused = 0;
    for (let i = 0; i < 30; i++) if ((await share(game())).status !== 200) refused++;
    ok('handing back an existing link is never refused as too many', refused === 0, `${refused} refused`);

    console.log(`\n${pass} passed, ${fails.length} failed`);
    for (const f of fails) console.log('  FAIL ' + f);
    process.exit(fails.length ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
