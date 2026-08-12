// `quiet` suppresses the banner dotenv otherwise prints on every boot.
require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');

const engine = require('./game/engine');
const auth = require('./auth');
const persist = require('./persist');

const app = express();

// Every host worth deploying to sits behind a reverse proxy, and without this
// `req.ip` is the proxy's address for everyone — which would let one bad guess
// streak lock the whole friend group out of the login rate limiter.
app.set('trust proxy', 1);

const PRODUCTION = process.env.NODE_ENV === 'production';

// In production the client is served from this same process, so the browser
// never makes a cross-origin request and nothing needs to be allowed — set
// CLIENT_ORIGIN only if you host the frontend somewhere else. Outside
// production the Vite dev server is on another port, so it's allowed through.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
const ORIGINS = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .concat(PRODUCTION ? [] : DEV_ORIGINS);
const corsOptions = { origin: ORIGINS.length ? ORIGINS : false };

app.use(cors(corsOptions));
// Nothing posted here is bigger than a password.
app.use(express.json({ limit: '16kb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

/** roomCode -> room state (in-memory only for the MVP). */
const rooms = new Map();
/** playerId -> timeout handle for the disconnect grace period. */
const graceTimers = new Map();
/** roomCode -> timeout handle closing the running auction. */
const auctionTimers = new Map();
/** roomCode -> timeout handle closing the running vote-kick. */
const voteTimers = new Map();

const DISCONNECT_GRACE_MS = 45_000;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;

app.get('/health', (req, res) => {
    res.json({ ok: true, rooms: rooms.size, ...presence() });
});

/* ------------------------------------------------------------------ version */

// What the browser should be running. Derived from the built index.html, whose
// script tag carries a content hash, so it changes on exactly the deploys that
// need a reload and on no others. Clients poll this and refresh themselves.
//
// Read from disk with an mtime check rather than cached at boot: rebuilding
// client/dist does not restart this process, and a client-only deploy is the
// one that costs nothing.
let versionCache = { mtime: 0, value: 'dev' };

function currentVersion() {
    if (!hasBuild) return 'dev';
    const file = path.join(CLIENT_DIST, 'index.html');
    try {
        const { mtimeMs } = fs.statSync(file);
        if (mtimeMs !== versionCache.mtime) {
            const html = fs.readFileSync(file, 'utf8');
            // The hashed bundle name is the whole point — it is the identity of
            // the build. Fall back to the mtime if the shape ever changes.
            const asset = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
            versionCache = { mtime: mtimeMs, value: asset ? asset[0] : String(mtimeMs) };
        }
    } catch {
        /* mid-deploy the file can vanish for an instant — keep the last value */
    }
    return versionCache.value;
}

app.get('/version', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ version: currentVersion() });
});

/* ------------------------------------------------------------------- access */

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/** Lets the client know whether to show the password screen at all. */
app.get('/auth/required', (req, res) => {
    res.json({ required: auth.enabled() });
});

// Everything the client needs before it has a room to get it from — which right
// now is the colour palette, for the profile editor on the home screen. Served
// rather than duplicated in the client, so the list the picker draws and the
// list the server validates against can't drift apart.
app.get('/meta', (req, res) => {
    res.json({ playerColors: engine.PLAYER_COLORS });
});

app.post('/auth/login', (req, res) => {
    if (!auth.enabled()) return res.json({ token: 'open' });

    const ip = clientIp(req);
    if (auth.tooManyAttempts(ip)) {
        return res.status(429).json({ error: 'Too many attempts — try again later' });
    }
    if (!auth.sameSecret(req.body?.password || '', auth.password())) {
        auth.noteFailure(ip);
        return res.status(401).json({ error: 'Wrong password' });
    }
    auth.clearAttempts(ip);
    res.json({ token: auth.issueToken() });
});

/* ------------------------------------------------------------------- client */

// One service serves both the API and the built app, which is why there's no
// cross-origin config to get wrong. Registered after the routes above so the
// single-page fallback can't swallow /health or /auth.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const hasBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

if (hasBuild) {
    // Filenames are content-hashed, so assets cache hard; index.html must not,
    // or a deploy leaves everyone on the previous bundle.
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1y' }));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
        res.set('Cache-Control', 'no-cache').sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
} else {
    // Saying so beats 404ing every route, which is a confusing way to find out.
    app.get('/', (req, res) => {
        res.status(503).send('Nopoly server is running, but the client is not built. Run: npm run build');
    });
}

// The handshake is the real gate — the login screen only mints the token this
// checks, and without this a client could talk to the game server directly.
io.use((socket, next) => {
    if (auth.verifyToken(socket.handshake.auth?.token)) return next();
    const err = new Error('unauthorized');
    err.data = { reason: 'unauthorized' };
    next(err);
});

function broadcast(room) {
    io.to(room.roomCode).emit('state', engine.publicState(room));
}

/* ----------------------------------------------------------------- presence */

/**
 * Who's on the server right now. Counted by person rather than by socket — a
 * second tab is the same someone, and half the group plays with the board open
 * on a laptop and their phone.
 *
 * Deliberately just numbers: room codes are the only thing keeping a game
 * private, so nothing here can be used to find one.
 */

// How long a tab has to sit in the background before the person behind it stops
// counting. A socket stays open for hours on a tab nobody has looked at since
// lunch, and counting those is how "3 online" comes to mean nothing.
// Overridable only so a test doesn't have to sit here for three minutes.
const AWAY_MS = Number(process.env.NOPOLY_AWAY_MS) || 3 * 60_000;

const isAway = (socket) => socket.data.hiddenAt != null && Date.now() - socket.data.hiddenAt > AWAY_MS;

function presence() {
    const sockets = [...io.sockets.sockets.values()];

    // Two tabs of one browser can disagree about who they are: the one that
    // joined knows its seat, the one still on the menu only knows the id the
    // browser had stored. Resolve the stored id to the seat it became, or the
    // pair counts as two people.
    const seatOf = new Map();
    for (const s of sockets) {
        if (s.handshake.auth?.pid && s.data.playerId) seatOf.set(s.handshake.auth.pid, s.data.playerId);
    }
    const who = (s) =>
        s.data.playerId || seatOf.get(s.handshake.auth?.pid) || s.handshake.auth?.pid || s.id;

    // One entry per person, not per tab. You're here if any one of your tabs is
    // in front of you, so the laptop left open in the background doesn't keep
    // you on the board and doesn't take you off it either.
    const here = new Set();
    const playing = new Set();
    for (const s of sockets) {
        if (isAway(s)) continue;
        here.add(who(s));
        if (s.data.roomCode && rooms.has(s.data.roomCode)) playing.add(who(s));
    }

    let games = 0;
    for (const room of rooms.values()) if (room.players.some((p) => p.connected)) games += 1;
    return { online: here.size, playing: playing.size, games };
}

// Coalesced and diffed: a reconnect storm after a redeploy would otherwise be
// one broadcast per socket, all saying the same thing.
let lastPresence = '';
let presenceQueued = false;

function pushPresence() {
    if (presenceQueued) return;
    presenceQueued = true;
    setTimeout(() => {
        presenceQueued = false;
        const next = presence();
        const key = JSON.stringify(next);
        if (key === lastPresence) return;
        lastPresence = key;
        io.emit('presence', next);
    }, 150).unref();
}

// Tabbing out crosses the away line without anyone doing anything, so the count
// can't only be recomputed on events. A few checks per away-window is enough to
// keep the number honest, and the diff above means a quiet server sends nothing.
setInterval(pushPresence, Math.max(2_000, Math.round(AWAY_MS / 6))).unref();

function getRoom(code) {
    return rooms.get(String(code || '').toUpperCase().trim());
}

/**
 * Keeps the room's auction timer in sync with `room.auction.endsAt`. Bids push
 * the deadline back, so this is re-armed after every action.
 */
function scheduleAuction(room) {
    clearTimeout(auctionTimers.get(room.roomCode));
    auctionTimers.delete(room.roomCode);
    if (!room.auction) return;
    const delay = Math.max(room.auction.endsAt - Date.now(), 0);
    auctionTimers.set(
        room.roomCode,
        setTimeout(() => {
            auctionTimers.delete(room.roomCode);
            engine.resolveAuction(room);
            broadcast(room);
        }, delay),
    );
}

/** Same idea for the vote-kick clock, which resolves on its own if ignored. */
function scheduleVote(room) {
    clearTimeout(voteTimers.get(room.roomCode));
    voteTimers.delete(room.roomCode);
    if (!room.vote) return;
    const delay = Math.max(room.vote.endsAt - Date.now(), 0);
    voteTimers.set(
        room.roomCode,
        setTimeout(() => {
            voteTimers.delete(room.roomCode);
            engine.expireVote(room);
            broadcast(room);
        }, delay),
    );
}

/** Run an engine action for a socket's room, then broadcast the new state. */
function act(socket, fn) {
    const room = getRoom(socket.data.roomCode);
    if (!room) return socket.emit('error:game', 'Room not found');
    const result = fn(room, socket.data.playerId) || {};
    if (result.error) socket.emit('error:game', result.error);
    broadcast(room);
    scheduleAuction(room);
    scheduleVote(room);
    return result;
}

function sweepEmptyRooms() {
    const now = Date.now();
    for (const [code, room] of rooms) {
        const anyoneConnected = room.players.some((p) => p.connected);
        if (anyoneConnected) {
            room.emptySince = null;
            continue;
        }
        if (!room.emptySince) room.emptySince = now;
        else if (now - room.emptySince > EMPTY_ROOM_TTL_MS) {
            clearTimeout(auctionTimers.get(code));
            auctionTimers.delete(code);
            clearTimeout(voteTimers.get(code));
            voteTimers.delete(code);
            rooms.delete(code);
        }
    }
    pushPresence();
}
setInterval(sweepEmptyRooms, 60_000).unref();

io.on('connection', (socket) => {
    pushPresence();

    socket.on('room:create', ({ name, playerId, initials, color } = {}, cb) => {
        let code = engine.makeRoomCode();
        while (rooms.has(code)) code = engine.makeRoomCode();
        const room = engine.createRoom(code);
        rooms.set(code, room);
        joinRoom(socket, room, { name, playerId, initials, color }, cb);
    });

    socket.on('room:join', ({ roomCode, name, playerId, initials, color } = {}, cb) => {
        const room = getRoom(roomCode);
        if (!room) return cb?.({ error: 'No room with that code' });
        joinRoom(socket, room, { name, playerId, initials, color }, cb);
    });

    socket.on('room:leave', () => {
        const room = getRoom(socket.data.roomCode);
        if (room) {
            socket.leave(room.roomCode);
            // Pressing Leave in the lobby gives the seat up for real; mid-game
            // it can only mean "gone for now", and removePlayer knows which.
            engine.removePlayer(room, socket.data.playerId);
            broadcast(room);
        }
        socket.data.roomCode = null;
        pushPresence();
    });

    socket.on('room:profile', (patch = {}) => act(socket, (room, pid) => engine.setProfile(room, pid, patch)));
    socket.on('room:settings', (patch = {}) => act(socket, (room, pid) => engine.updateSettings(room, pid, patch)));
    socket.on('room:team', ({ playerId, teamId } = {}) =>
        act(socket, (room, pid) => engine.setTeam(room, pid, playerId, teamId ?? null)),
    );
    socket.on('auction:bid', ({ amount } = {}) => act(socket, (room, pid) => engine.placeBid(room, pid, amount)));

    socket.on('game:start', () => act(socket, engine.startGame));
    socket.on('game:roll', () => act(socket, engine.rollDice));
    socket.on('game:buy', () => act(socket, engine.buyProperty));
    socket.on('game:decline', () => act(socket, engine.declinePurchase));
    socket.on('game:endTurn', () => act(socket, engine.endTurn));
    socket.on('game:payJail', () => act(socket, engine.payJailFine));
    socket.on('game:useJailCard', () => act(socket, engine.useJailCard));
    // Pause is withdrawn for now: any player could freeze everyone else's game
    // for as long as they liked. `engine.togglePause` is left in place so this
    // is one line to restore once it's gated to the host or time-limited.
    socket.on('game:bankrupt', () => act(socket, engine.declareBankruptcy));
    socket.on('game:sendCash', ({ toId, amount } = {}) =>
        act(socket, (room, pid) => engine.sendCash(room, pid, toId, amount)),
    );
    socket.on('game:bailout', ({ accept } = {}) =>
        act(socket, (room, pid) => engine.respondBailout(room, pid, !!accept)),
    );
    socket.on('vote:start', ({ targetId } = {}) =>
        act(socket, (room, pid) => engine.startVoteKick(room, pid, targetId)),
    );
    socket.on('vote:cast', ({ agree } = {}) => act(socket, (room, pid) => engine.castVote(room, pid, !!agree)));
    socket.on('game:dismissCard', () =>
        act(socket, (room) => {
            room.pendingCard = null;
            return {};
        }),
    );
    socket.on('game:rematch', () =>
        act(socket, (room, playerId) => {
            if (room.hostId !== playerId) return { error: 'Only the host can restart' };
            engine.resetForRematch(room);
            return {};
        }),
    );

    socket.on('game:build', ({ tileId } = {}) => act(socket, (room, pid) => engine.buildHouse(room, pid, tileId)));
    socket.on('game:sell', ({ tileId } = {}) => act(socket, (room, pid) => engine.sellHouse(room, pid, tileId)));
    socket.on('game:sellProperty', ({ tileId } = {}) =>
        act(socket, (room, pid) => engine.sellProperty(room, pid, tileId)),
    );

    socket.on('trade:create', (payload = {}) => act(socket, (room, pid) => engine.createTrade(room, pid, payload)));
    socket.on('trade:respond', ({ tradeId, response } = {}) =>
        act(socket, (room, pid) => engine.respondTrade(room, pid, tradeId, response)),
    );

    // Whether this tab is actually in front of someone. The server holds the
    // clock rather than the client, because a backgrounded tab is exactly where
    // browsers throttle timers — the one place a client-side countdown can't be
    // trusted to fire.
    socket.on('presence:visibility', ({ hidden } = {}) => {
        const was = socket.data.hiddenAt;
        socket.data.hiddenAt = hidden ? was || Date.now() : null;
        pushPresence();
    });

    socket.on('chat:send', ({ text } = {}) => act(socket, (room, pid) => engine.addChat(room, pid, text)));
    socket.on('game:activity', (payload = {}) => act(socket, (room, pid) => engine.setActivity(room, pid, payload)));

    socket.on('disconnect', () => {
        // Before the early return: someone closing the tab on the home screen
        // never had a room, and still just went offline.
        pushPresence();
        const room = getRoom(socket.data.roomCode);
        const playerId = socket.data.playerId;
        if (!room || !playerId) return;
        // Another tab may still hold this player — only mark them gone if not.
        const stillHere = [...io.sockets.sockets.values()].some(
            (s) => s.id !== socket.id && s.data.playerId === playerId && s.data.roomCode === room.roomCode,
        );
        if (stillHere) return;

        engine.markDisconnected(room, playerId);
        broadcast(room);

        clearTimeout(graceTimers.get(playerId));
        graceTimers.set(
            playerId,
            setTimeout(() => {
                graceTimers.delete(playerId);
                // Phase decides which applies: an empty seat in the lobby is
                // freed, a seat mid-game is kept and its turn skipped.
                if (engine.dropIfStillGone(room, playerId) || engine.skipIfStillGone(room, playerId)) {
                    broadcast(room);
                }
            }, DISCONNECT_GRACE_MS),
        );
    });
});

function joinRoom(socket, room, { name, playerId, initials, color }, cb) {
    const result = engine.addPlayer(room, { name, playerId, initials, color });
    if (result.error) return cb?.({ error: result.error });

    socket.data.playerId = result.player.id;
    socket.data.roomCode = room.roomCode;
    socket.join(room.roomCode);
    clearTimeout(graceTimers.get(result.player.id));
    graceTimers.delete(result.player.id);

    // `state.board` carries the board meta on every broadcast — the host can
    // swap boards in the lobby, so it can't be a one-shot handshake value.
    cb?.({
        roomCode: room.roomCode,
        playerId: result.player.id,
        state: engine.publicState(room),
    });
    broadcast(room);
    // Reconnecting can have just called off a countdown, so its timer has to go
    // with it.
    scheduleVote(room);
    pushPresence();
}

// An open server is fine on a laptop and never fine on the internet, and a
// warning in a log nobody reads is how it ships open. Refuse instead.
if (PRODUCTION && !auth.enabled()) {
    console.error('Refusing to start: NOPOLY_PASSWORD is not set, which would leave the game open to anyone.');
    process.exit(1);
}

/**
 * Bring back whatever was running when we last stopped. Everyone's socket died
 * with the old process, so nobody is connected yet — the clients reconnect on
 * their own and `addPlayer` puts them back in their seat by stored id.
 */
function restoreRooms() {
    const saved = persist.load();
    for (const room of saved) {
        for (const p of room.players) {
            p.connected = false;
            p.activity = null;
        }
        rooms.set(room.roomCode, room);
        // Everyone above was just marked disconnected, which is exactly what an
        // abandonment countdown is watching for — so give it its full length
        // back before arming it, or the restart itself kicks someone out.
        engine.refreshAbandonDeadline(room);
        // endsAt is absolute on both, so anything that expired during the
        // restart resolves immediately rather than hanging forever.
        scheduleAuction(room);
        scheduleVote(room);
    }
    // Consumed: if we crash before the next save, replaying a stale snapshot
    // would drop the table back into a game they'd already moved past.
    persist.clear();
    return saved.length;
}

// A hard kill, an OOM or a power cut never runs the shutdown hook, so the
// snapshot can't only be written on the way out. Skipped entirely when there's
// nothing running, so an idle server doesn't touch the disk at all.
const AUTOSAVE_MS = 15_000;
setInterval(() => {
    if (rooms.size) persist.save(rooms);
}, AUTOSAVE_MS).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    const restored = restoreRooms();
    console.log(`Server listening on port ${PORT}`);
    console.log(hasBuild ? 'Client: serving client/dist' : 'Client: no build found (API only)');
    console.log(restored ? `State: resumed ${restored} room(s)` : 'State: no rooms to resume');
    if (auth.enabled()) {
        console.log('Access: password required');
    } else {
        console.warn('Access: OPEN — set NOPOLY_PASSWORD to require a password');
    }
});

// Give in-flight broadcasts a moment to land, then exit, so a redeploy doesn't
// look like a hard disconnect to everyone mid-turn.
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        // Snapshot first, before the sockets go — this is the whole reason a
        // redeploy mid-game is survivable.
        const saved = persist.save(rooms);
        console.log(saved.ok ? `State: saved ${saved.count} room(s)` : `State: save failed — ${saved.error}`);
        io.close();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}
