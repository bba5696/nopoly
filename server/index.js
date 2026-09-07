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
//
// How many hops to trust. One is Nginx on the VM. Put a CDN in front of that —
// the Vercel rewrite in vercel.json is the reason this is settable — and it
// becomes two. Only the login limiter reads `req.ip`, so getting it wrong
// costs accuracy there and nothing else: too low and everyone arriving through
// the CDN shares one bucket, too high and the header can be spoofed.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

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
/** roomCode -> timeout handle for the turn clock. */
const idleTimers = new Map();

// Held longer than this by NOPOLY_AWAY_GRACE_MS in the engine, so that the
// shortened turn clock for an absent player can never come due while this grace
// still says a refresh costs nothing.
const DISCONNECT_GRACE_MS = 45_000;

/* ------------------------------------------------------- when a room is over */

// Nothing ever tells the server a game is finished with. People close the tab,
// or they don't; either way the room stays in the Map, and in a process with no
// database and no second instance the Map is the whole world.
//
// Three ways a room ends, because "nobody is using this" has three shapes and
// only one of them is being unplugged:
//
//   empty     nobody's socket is attached. The obvious one.
//   finished  someone won, and the end screen is being left open.
//   stale     sockets are attached and none of them belongs to a person any
//             more — a tab left open on a phone in a pocket. This is the one
//             the old sweep could not see, and the one that lasts forever: the
//             turn clock keeps playing turns for a table nobody is sitting at,
//             so the room stays busy while being entirely abandoned.
//
// Staleness is measured from the last thing a *client asked for*, never from
// anything the server did on its own, or the turn clock would keep the room
// alive by talking to itself.
const EMPTY_ROOM_MS = Number(process.env.NOPOLY_EMPTY_ROOM_MS) || 30 * 60 * 1000;
const ENDED_ROOM_MS = Number(process.env.NOPOLY_ENDED_ROOM_MS) || 30 * 60 * 1000;
const STALE_ROOM_MS = Number(process.env.NOPOLY_STALE_ROOM_MS) || 3 * 60 * 60 * 1000;
const SWEEP_MS = Number(process.env.NOPOLY_SWEEP_MS) || 60_000;

/** A room did something because someone asked it to. */
function touch(room) {
    if (room) room.lastActionAt = Date.now();
}

/* --------------------------------------------------- limits on making rooms */

// Creating a room is the one thing an unknown caller can do that costs the
// server memory, and until the password gate became optional the password was
// the only thing in front of it. Rooms are swept when they have been empty for
// half an hour, which bounds growth over a long period but not over a short
// one: a loop calling room:create can allocate boards far faster than the sweep
// reclaims them, and this process has a gigabyte and no second instance to fall
// back on.
//
// Two limits rather than one, because they fail differently. The global cap is
// the one that actually protects the box — whatever gets past the per-IP limit,
// through a proxy or a botnet, still cannot exhaust memory. The per-IP limit is
// what keeps one script from filling those slots and locking everyone else out,
// which the cap alone would happily allow.
//
// Both are deliberately far above anything a friend group produces. If a real
// game is ever refused, these are too low and are meant to be raised.
const MAX_ROOMS = Number(process.env.NOPOLY_MAX_ROOMS) || 150;
const ROOMS_PER_IP = Number(process.env.NOPOLY_ROOMS_PER_IP) || 10;
const ROOM_WINDOW_MS = 10 * 60 * 1000;

/** ip -> { count, until } — same shape as the login limiter in auth.js. */
const roomsMade = new Map();

// Socket.IO does not go through Express, so `app.set('trust proxy')` does not
// reach it and the handshake address is the proxy's for everyone. Count in from
// the right of X-Forwarded-For by the same hop count Express is configured
// with: the rightmost entries are added by proxies we control, and anything
// further left was supplied by the client and cannot be trusted.
const TRUST_HOPS = Number(process.env.TRUST_PROXY_HOPS) || 1;

function socketIp(socket) {
    const forwarded = socket.handshake?.headers?.['x-forwarded-for'];
    if (forwarded) {
        const chain = String(forwarded).split(',').map((s) => s.trim()).filter(Boolean);
        const picked = chain[chain.length - TRUST_HOPS];
        if (picked) return picked;
    }
    return socket.handshake?.address || 'unknown';
}

function tooManyRooms(ip) {
    const rec = roomsMade.get(ip);
    if (!rec) return false;
    if (Date.now() > rec.until) {
        roomsMade.delete(ip);
        return false;
    }
    return rec.count >= ROOMS_PER_IP;
}

function noteRoom(ip) {
    const rec = roomsMade.get(ip);
    if (!rec || Date.now() > rec.until) {
        roomsMade.set(ip, { count: 1, until: Date.now() + ROOM_WINDOW_MS });
        return;
    }
    rec.count += 1;
}

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
            //
            // `main` as well as `index`: declaring named inputs in vite.config
            // (which the sound bench needs) renames the entry chunk after the
            // key, so a build emits `main-<hash>.js`. Matching only `index-`
            // quietly fell through to the mtime here, and to *null* in the
            // client's loadedBundle() — which disables the reload entirely.
            const asset = html.match(/assets\/(?:index|main)-[A-Za-z0-9_-]+\.js/);
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

/**
 * And the turn clock, which is re-armed on every action rather than only when
 * it runs out — anything the current player does is a sign of life, so the
 * deadline moves and this has to move with it.
 */
function scheduleIdle(room) {
    clearTimeout(idleTimers.get(room.roomCode));
    idleTimers.delete(room.roomCode);
    if (!room.idle) return;
    const delay = Math.max(room.idle.endsAt - Date.now(), 0);
    idleTimers.set(
        room.roomCode,
        setTimeout(() => {
            idleTimers.delete(room.roomCode);
            engine.expireIdle(room);
            broadcast(room);
            scheduleIdle(room);
            // A played-for-them turn can open an auction, and only a player'''s
            // own action used to arm that clock — so an auction started by the
            // turn timer sat at nought seconds forever, with the whole table
            // waiting on a bid nobody had been asked for.
            scheduleAuction(room);
        }, delay),
    );
}

/** Run an engine action for a socket's room, then broadcast the new state. */
function act(socket, fn, { watchers = false } = {}) {
    const room = getRoom(socket.data.roomCode);
    if (!room) return socket.emit('error:game', 'Room not found');
    // Most engine calls would refuse a watcher anyway, since they aren't in
    // `players` and every one of them starts by looking themselves up. One
    // check here is worth more than trusting that to hold for every action
    // added later — and it's the one place to make the exceptions.
    if (socket.data.spectating && !watchers) {
        return socket.emit('error:game', 'You are watching, not playing');
    }
    const result = fn(room, socket.data.playerId) || {};
    if (result.error) socket.emit('error:game', result.error);
    // Even a refused action is a person doing something, so it counts against
    // staleness. What must never count is anything the server starts by itself
    // — the turn clock playing an empty turn would otherwise keep an abandoned
    // room alive for as long as the tab stays open, which is forever.
    touch(room);
    // Doing anything at all is the clearest sign of life there is, so it counts
    // the same as moving the mouse.
    engine.noteActive(room, socket.data.playerId);
    broadcast(room);
    scheduleAuction(room);
    scheduleVote(room);
    scheduleIdle(room);
    return result;
}

/**
 * Take a room out of the world: its timers, its sockets, its entry in the Map.
 * Deleting from `rooms` alone would leave three timers holding the object it
 * was supposed to free, and a handful of clients rendering a board the server
 * has forgotten.
 */
function closeRoom(code, room, notice) {
    clearTimeout(auctionTimers.get(code));
    auctionTimers.delete(code);
    clearTimeout(voteTimers.get(code));
    voteTimers.delete(code);
    clearTimeout(idleTimers.get(code));
    idleTimers.delete(code);
    // A grace timer outlives its room otherwise. The closure captures `room`,
    // so the thing being freed stays reachable — and reachable through a timer
    // that will then act on a room nobody can reach any more.
    for (const p of room.players) {
        clearTimeout(graceTimers.get(p.id));
        graceTimers.delete(p.id);
    }

    // Told, not left to find out. A stale room is closed with people still
    // connected to it by definition, and a board that quietly stops answering
    // is indistinguishable from a broken server.
    io.to(code).emit('room:closed', notice);
    for (const s of io.sockets.sockets.values()) {
        if (s.data.roomCode !== code) continue;
        s.leave(code);
        s.data.roomCode = null;
        s.data.spectating = false;
    }

    rooms.delete(code);
    return true;
}

/** Which ending applies, if any. Order matters only in what it reports. */
function expiredReason(room, now) {
    if (room.emptySince && now - room.emptySince > EMPTY_ROOM_MS) {
        return 'Everyone had left, so that room was closed.';
    }
    // Measured from the last request, not from the win: the stats screen is
    // worth reading, and a rematch is a request like any other.
    const quietFor = now - (room.lastActionAt || now);
    if (room.phase === 'ended' && quietFor > ENDED_ROOM_MS) {
        return 'That game had finished, so the room was closed.';
    }
    if (quietFor > STALE_ROOM_MS) {
        return 'That room sat untouched for hours, so it was closed.';
    }
    return null;
}

function sweepRooms() {
    const now = Date.now();
    let closed = 0;
    for (const [code, room] of rooms) {
        // Disconnected is not gone — the grace period and the abandonment
        // countdown both depend on a seat outliving its socket — so emptiness
        // is timed rather than acted on the moment the last socket drops.
        const anyoneConnected = room.players.some((p) => p.connected);
        room.emptySince = anyoneConnected ? null : room.emptySince || now;

        const notice = expiredReason(room, now);
        if (notice && closeRoom(code, room, notice)) closed++;
    }
    // Expired rate-limit records, for the same reason the rooms above go: this
    // map is keyed by IP and nothing else ever removes a lapsed entry, so on an
    // open server it would grow with every visitor and never shrink.
    for (const [ip, rec] of roomsMade) {
        if (now > rec.until) roomsMade.delete(ip);
    }
    if (closed) pushPresence();
    return closed;
}
setInterval(sweepRooms, SWEEP_MS).unref();

io.on('connection', (socket) => {
    pushPresence();

    socket.on('room:create', ({ name, playerId, initials, color } = {}, cb) => {
        if (rooms.size >= MAX_ROOMS) {
            return cb?.({ error: 'The server is full right now — try again in a few minutes' });
        }
        const ip = socketIp(socket);
        if (tooManyRooms(ip)) {
            return cb?.({ error: "That's a lot of rooms in a short time — give it a few minutes" });
        }

        let code = engine.makeRoomCode();
        while (rooms.has(code)) code = engine.makeRoomCode();
        const room = engine.createRoom(code);
        // Registered only once it has someone in it, so a refused join cannot
        // strand an empty room holding a code and a slot against the cap.
        // Defensive rather than a fix: none of addPlayer's guards can fire on a
        // room made a line ago — nobody is banned, the phase is waiting, it is
        // not full, and a blank name defaults instead of failing. It is the
        // ordering that stays correct if one of those ever grows a case.
        const result = engine.addPlayer(room, { name, playerId, initials, color });
        if (result.error) return cb?.({ error: result.error });
        rooms.set(code, room);
        noteRoom(ip);
        seat(socket, room, result, cb);
    });

    socket.on('room:join', ({ roomCode, name, playerId, initials, color } = {}, cb) => {
        const room = getRoom(roomCode);
        if (!room) return cb?.({ error: 'No room with that code' });
        const result = engine.addPlayer(room, { name, playerId, initials, color });
        if (result.error) {
            // A closed door isn't the same as a locked one. When the only thing
            // missing is a seat, say so and let the client offer the other way
            // in rather than turning them away outright.
            const watchable = engine.spectateReason(room, playerId);
            return cb?.({ error: result.error, canSpectate: !!watchable, reason: watchable });
        }
        seat(socket, room, result, cb);
    });

    socket.on('room:spectate', ({ roomCode, name, playerId } = {}, cb) => {
        const room = getRoom(roomCode);
        if (!room) return cb?.({ error: 'No room with that code' });
        if (!engine.spectateReason(room, playerId)) {
            // There's a seat going, or they're barred outright — either way
            // this isn't the door they want.
            return cb?.({ error: 'Join the game instead' });
        }
        const { spectator } = engine.addSpectator(room, { name, playerId });
        socket.data.playerId = spectator.id;
        socket.data.roomCode = room.roomCode;
        socket.data.spectating = true;
        socket.join(room.roomCode);
        touch(room);
        cb?.({
            roomCode: room.roomCode,
            playerId: spectator.id,
            spectating: true,
            state: engine.publicState(room),
        });
        broadcast(room);
        pushPresence();
    });

    socket.on('room:leave', () => {
        const room = getRoom(socket.data.roomCode);
        if (room) {
            socket.leave(room.roomCode);
            if (socket.data.spectating) {
                // Nothing to hold open for a watcher — no seat, no turn.
                engine.removeSpectator(room, socket.data.playerId);
            } else {
                // Pressing Leave in the lobby gives the seat up for real;
                // mid-game it can only mean "gone for now", and removePlayer
                // knows which.
                engine.removePlayer(room, socket.data.playerId);
            }
            broadcast(room);
        }
        socket.data.roomCode = null;
        socket.data.spectating = false;
        pushPresence();
    });

    // Mouse moved, key pressed, screen touched — sent only by whoever is up,
    // and throttled hard on the client. It carries nothing: the fact that it
    // arrived is the whole message.
    socket.on('game:active', () =>
        act(socket, (room, pid) => engine.noteActive(room, pid)),
    );
    socket.on('room:profile', (patch = {}) => act(socket, (room, pid) => engine.setProfile(room, pid, patch)));
    socket.on('room:settings', (patch = {}) => act(socket, (room, pid) => engine.updateSettings(room, pid, patch)));
    socket.on('room:team', ({ playerId, teamId } = {}) =>
        act(socket, (room, pid) => engine.setTeam(room, pid, playerId, teamId ?? null)),
    );
    // Not routed through `act`, because the person it acts on has to be shown
    // the door as well as removed from the roster — a socket still in the room
    // would keep drawing a lobby its owner is no longer in.
    socket.on('room:kick', ({ playerId } = {}) => {
        const room = getRoom(socket.data.roomCode);
        if (!room) return socket.emit('error:game', 'Room not found');
        const res = engine.kickPlayer(room, socket.data.playerId, playerId);
        if (res.error) return socket.emit('error:game', res.error);
        for (const s of io.sockets.sockets.values()) {
            if (s.data.roomCode !== room.roomCode || s.data.playerId !== playerId) continue;
            s.leave(room.roomCode);
            s.data.roomCode = null;
            s.data.spectating = false;
            // The same event a closed room sends: from where they are standing
            // it is the same thing — the room is gone, with a line saying why.
            s.emit('room:closed', 'The host removed you from the room.');
        }
        touch(room);
        broadcast(room);
        pushPresence();
    });

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

    socket.on('chat:send', ({ text } = {}) =>
        act(socket, (room, pid) => engine.addChat(room, pid, text), { watchers: true }),
    );
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

        // A watcher leaving is just gone — there's no seat to hold for them and
        // no turn to skip, so none of the grace-period machinery applies.
        if (socket.data.spectating) {
            if (engine.removeSpectator(room, playerId)) broadcast(room);
            return;
        }

        engine.markDisconnected(room, playerId);
        // If they were the one on the clock, it just got shorter — a tab that
        // has closed is never going to take its full minute. `refreshIdle`
        // keeps its own hands off anyone else's turn.
        engine.refreshIdle(room, playerId);
        broadcast(room);
        scheduleIdle(room);

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

/** Sit a socket down in a room it has just been admitted to. */
function seat(socket, room, result, cb) {
    socket.data.playerId = result.player.id;
    socket.data.roomCode = room.roomCode;
    socket.data.spectating = false;
    socket.join(room.roomCode);
    touch(room);
    clearTimeout(graceTimers.get(result.player.id));
    graceTimers.delete(result.player.id);
    // Back mid-turn: give them the full window again rather than the seconds
    // left of the one they were being played out on.
    engine.refreshIdle(room, result.player.id);

    // `state.board` carries the board meta on every broadcast — the host can
    // swap boards in the lobby, so it can't be a one-shot handshake value.
    cb?.({
        roomCode: room.roomCode,
        playerId: result.player.id,
        state: engine.publicState(room),
    });
    broadcast(room);
    // Reconnecting can have just called off a countdown, so its timer has to go
    // with it — and the turn clock they were being played out on.
    scheduleVote(room);
    scheduleIdle(room);
    pushPresence();
}

// Running without a password is a choice, so it has to be made explicitly.
//
// This used to refuse outright, on the grounds that an open server is never
// what you want in production. Deliberately opening the game up makes that too
// strong — but only just, and dropping the check entirely would mean a typo in
// /etc/nopoly.env, or an EnvironmentFile that failed to load, silently
// publishing the site to everyone. Opening on purpose and opening by accident
// must not look the same to the server, so the intent gets its own variable.
const OPEN = process.env.NOPOLY_OPEN === '1';
if (PRODUCTION && !auth.enabled() && !OPEN) {
    console.error('Refusing to start: NOPOLY_PASSWORD is not set, which would leave the game open to anyone.');
    console.error('If that is deliberate, set NOPOLY_OPEN=1 to confirm it.');
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
            // The restart is when they went away, as far as anything measuring
            // absence is concerned. Stamped rather than inherited so the away
            // clock gives them its grace to reconnect instead of counting from
            // a disconnect that happened before the process died.
            p.disconnectedAt = Date.now();
        }
        // Watchers are tracked by live socket and nothing else, so a snapshot's
        // list is stale on arrival. They reconnect and re-announce themselves.
        room.spectators = [];
        rooms.set(room.roomCode, room);
        // Everyone above was just marked disconnected, which is exactly what an
        // abandonment countdown is watching for — so give it its full length
        // back before arming it, or the restart itself kicks someone out.
        engine.refreshAbandonDeadline(room);
        // Same reasoning for the turn clock: everyone is disconnected at this
        // instant, and an inherited deadline would play the current player's
        // turn for them before their browser had finished reconnecting.
        engine.armIdle(room);
        // endsAt is absolute on both, so anything that expired during the
        // restart resolves immediately rather than hanging forever.
        scheduleAuction(room);
        scheduleVote(room);
        scheduleIdle(room);
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
    // Async: this runs while people are mid-turn, and a blocking write stalls
    // every table in the process for as long as the disk takes. The shutdown
    // save below stays synchronous, where blocking is the entire point.
    if (rooms.size) persist.saveAsync(rooms);
}, AUTOSAVE_MS).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    const restored = restoreRooms();
    console.log(`Server listening on port ${PORT}`);
    console.log(hasBuild ? 'Client: serving client/dist' : 'Client: no build found (API only)');
    console.log(restored ? `State: resumed ${restored} room(s)` : 'State: no rooms to resume');
    if (auth.enabled()) {
        console.log('Access: password required');
    } else if (OPEN) {
        console.log(`Access: OPEN by NOPOLY_OPEN — anyone with the URL can play (max ${MAX_ROOMS} rooms)`);
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
