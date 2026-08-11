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

const DISCONNECT_GRACE_MS = 45_000;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;

app.get('/health', (req, res) => {
    res.json({ ok: true, rooms: rooms.size });
});

/* ------------------------------------------------------------------- access */

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/** Lets the client know whether to show the password screen at all. */
app.get('/auth/required', (req, res) => {
    res.json({ required: auth.enabled() });
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

/** Run an engine action for a socket's room, then broadcast the new state. */
function act(socket, fn) {
    const room = getRoom(socket.data.roomCode);
    if (!room) return socket.emit('error:game', 'Room not found');
    const result = fn(room, socket.data.playerId) || {};
    if (result.error) socket.emit('error:game', result.error);
    broadcast(room);
    scheduleAuction(room);
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
            rooms.delete(code);
        }
    }
}
setInterval(sweepEmptyRooms, 60_000).unref();

io.on('connection', (socket) => {
    socket.on('room:create', ({ name, playerId } = {}, cb) => {
        let code = engine.makeRoomCode();
        while (rooms.has(code)) code = engine.makeRoomCode();
        const room = engine.createRoom(code);
        rooms.set(code, room);
        joinRoom(socket, room, { name, playerId }, cb);
    });

    socket.on('room:join', ({ roomCode, name, playerId } = {}, cb) => {
        const room = getRoom(roomCode);
        if (!room) return cb?.({ error: 'No room with that code' });
        joinRoom(socket, room, { name, playerId }, cb);
    });

    socket.on('room:leave', () => {
        const room = getRoom(socket.data.roomCode);
        if (room) {
            socket.leave(room.roomCode);
            engine.markDisconnected(room, socket.data.playerId);
            broadcast(room);
        }
        socket.data.roomCode = null;
    });

    socket.on('room:settings', (patch = {}) => act(socket, (room, pid) => engine.updateSettings(room, pid, patch)));
    socket.on('auction:bid', ({ amount } = {}) => act(socket, (room, pid) => engine.placeBid(room, pid, amount)));

    socket.on('game:start', () => act(socket, engine.startGame));
    socket.on('game:roll', () => act(socket, engine.rollDice));
    socket.on('game:buy', () => act(socket, engine.buyProperty));
    socket.on('game:decline', () => act(socket, engine.declinePurchase));
    socket.on('game:endTurn', () => act(socket, engine.endTurn));
    socket.on('game:payJail', () => act(socket, engine.payJailFine));
    socket.on('game:useJailCard', () => act(socket, engine.useJailCard));
    socket.on('game:pause', () => act(socket, engine.togglePause));
    socket.on('game:bankrupt', () => act(socket, engine.declareBankruptcy));
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

    socket.on('chat:send', ({ text } = {}) => act(socket, (room, pid) => engine.addChat(room, pid, text)));
    socket.on('game:activity', (payload = {}) => act(socket, (room, pid) => engine.setActivity(room, pid, payload)));

    socket.on('disconnect', () => {
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
                if (engine.skipIfStillGone(room, playerId)) broadcast(room);
            }, DISCONNECT_GRACE_MS),
        );
    });
});

function joinRoom(socket, room, { name, playerId }, cb) {
    const result = engine.addPlayer(room, { name, playerId });
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
}

// An open server is fine on a laptop and never fine on the internet, and a
// warning in a log nobody reads is how it ships open. Refuse instead.
if (PRODUCTION && !auth.enabled()) {
    console.error('Refusing to start: NOPOLY_PASSWORD is not set, which would leave the game open to anyone.');
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(hasBuild ? 'Client: serving client/dist' : 'Client: no build found (API only)');
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
        io.close();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}
