/* eslint-disable react-refresh/only-export-components -- provider and its hook belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { socket, loadIdentity, saveIdentity, clearRoom } from './socket';

const GameContext = createContext(null);

export function GameProvider({ children }) {
    const [connected, setConnected] = useState(socket.connected);
    const [playerId, setPlayerId] = useState(() => loadIdentity().playerId || null);
    const [roomCode, setRoomCode] = useState(null);
    const [state, setState] = useState(null);
    // Your own cards, in games that have any. Kept apart from `state` because
    // that is exactly what it is on the wire: the room's truth and yours are
    // two different payloads.
    const [hand, setHand] = useState([]);
    const [notice, setNotice] = useState(null);
    const [serverNotice, setServerNotice] = useState(null);
    const [joining, setJoining] = useState(false);
    /** Server-wide head count, pushed whenever it changes. */
    const [presence, setPresence] = useState(null);
    /** In the room without a seat — watching rather than playing. */
    const [spectating, setSpectating] = useState(false);

    const flash = useCallback((text) => {
        setNotice({ text, at: Date.now() });
        setTimeout(() => setNotice((n) => (n && Date.now() - n.at >= 3000 ? null : n)), 3200);
    }, []);

    const applyJoin = useCallback((res) => {
        if (!res || res.error) return res;
        saveIdentity({ playerId: res.playerId, roomCode: res.roomCode, spectating: !!res.spectating });
        setPlayerId(res.playerId);
        setRoomCode(res.roomCode);
        setSpectating(!!res.spectating);
        setState(res.state);
        return res;
    }, []);

    // Socket lifecycle. On (re)connect we transparently rejoin the stored room,
    // which is what makes a refresh mid-game land you back in your seat.
    useEffect(() => {
        // Told, not inferred: the server can't see a tab go to the background,
        // and a socket left open on a tab nobody has looked at for an hour
        // shouldn't keep its owner on the head count.
        const reportVisibility = () => socket.emit('presence:visibility', { hidden: document.hidden });

        const onConnect = () => {
            setConnected(true);
            // A tab restored in the background connects already hidden.
            reportVisibility();
            const { roomCode: stored, playerId: pid, name, initials, color, spectating: wasWatching } = loadIdentity();
            if (!stored) return;

            const dropOut = () => {
                clearRoom();
                setRoomCode(null);
                setSpectating(false);
                setState(null);
            };
            const watch = () =>
                socket.emit('room:spectate', { roomCode: stored, playerId: pid, name }, (res) =>
                    res?.error ? dropOut() : applyJoin(res),
                );

            // Straight back to watching if that's how we left. Asking for a
            // seat first would be answered with the same refusal that sent us
            // here, and would flash the prompt again on every reconnect.
            if (wasWatching) return watch();
            socket.emit('room:join', { roomCode: stored, playerId: pid, name, initials, color }, (res) => {
                if (!res?.error) return applyJoin(res);
                // A seat that vanished while we were away — a game that started
                // without us, or a room that filled up — is still watchable.
                if (res.canSpectate) return watch();
                dropOut();
            });
        };
        const onDisconnect = () => {
            setConnected(false);
            // Whatever we last heard is now stale, and showing a count from
            // before we dropped is worse than showing none.
            setPresence(null);
        };
        const onPresence = (next) => setPresence(next);
        const onState = (next) => {
            // Dropped from the room (resigned, or not carried into a rematch) —
            // fall back to the home screen rather than showing a game we're
            // no longer part of. A watcher is never in `players` and is meant
            // not to be, so this can't judge them by the same list.
            const { playerId: pid, spectating: watching } = loadIdentity();
            const gone = pid && !next.players.some((p) => p.id === pid);
            const stillWatching = watching && next.spectators?.some((s) => s.id === pid);
            if (gone && !stillWatching) {
                clearRoom();
                setRoomCode(null);
                setSpectating(false);
                setState(null);
                return;
            }
            setState(next);
        };
        const onError = (text) => flash(text);
        // The server reclaimed the room out from under us — finished, empty,
        // or untouched for hours. Nothing to reconnect to, so clear the stored
        // code as well: keeping it would have every reconnect ask for a room
        // that no longer exists.
        const onClosed = (text) => {
            clearRoom();
            setRoomCode(null);
            setSpectating(false);
            setState(null);
            setHand([]);
            flash(text || 'That room was closed.');
        };

        // Your own cards. A second, smaller channel than `state`, because a
        // hand is true for one person and the state is true for the room —
        // see broadcast() and pushHands() on the server.
        const onHand = (payload) => setHand(payload?.hand || []);

        // A word from the site's admin to every open tab — "restarting in two
        // minutes". Null takes it down; `until` takes it down on its own.
        const onServerNotice = (payload) => setServerNotice(payload?.text ? payload : null);

        socket.on('connect', onConnect);
        socket.on('server:notice', onServerNotice);
        socket.on('disconnect', onDisconnect);
        socket.on('state', onState);
        socket.on('hand', onHand);
        socket.on('presence', onPresence);
        socket.on('error:game', onError);
        socket.on('room:closed', onClosed);
        document.addEventListener('visibilitychange', reportVisibility);
        if (socket.connected) onConnect();

        return () => {
            document.removeEventListener('visibilitychange', reportVisibility);
            socket.off('connect', onConnect);
            socket.off('server:notice', onServerNotice);
            socket.off('disconnect', onDisconnect);
            socket.off('state', onState);
            socket.off('hand', onHand);
            socket.off('presence', onPresence);
            socket.off('error:game', onError);
            socket.off('room:closed', onClosed);
        };
    }, [applyJoin, flash]);

    const createRoom = useCallback(
        (name, game) =>
            new Promise((resolve) => {
                setJoining(true);
                saveIdentity({ name });
                // The profile travels with you into a new room rather than
                // being set up again every game.
                const { playerId: pid, initials, color } = loadIdentity();
                socket.emit('room:create', { name, playerId: pid, initials, color, game }, (res) => {
                    setJoining(false);
                    if (res?.error) flash(res.error);
                    else applyJoin(res);
                    resolve(res);
                });
            }),
        [applyJoin, flash],
    );

    const joinRoom = useCallback(
        (code, name) =>
            new Promise((resolve) => {
                setJoining(true);
                saveIdentity({ name });
                const { playerId: pid, initials, color } = loadIdentity();
                socket.emit(
                    'room:join',
                    { roomCode: code.toUpperCase().trim(), name, playerId: pid, initials, color },
                    (res) => {
                        setJoining(false);
                        // A refusal that comes with a way in isn't a failure
                        // yet — the caller offers the choice instead of a
                        // toast that reads like a dead end.
                        if (res?.error && !res.canSpectate) flash(res.error);
                        else if (!res?.error) applyJoin(res);
                        resolve(res);
                    },
                );
            }),
        [applyJoin, flash],
    );

    const spectate = useCallback(
        (code, name) =>
            new Promise((resolve) => {
                setJoining(true);
                saveIdentity({ name });
                const { playerId: pid } = loadIdentity();
                socket.emit(
                    'room:spectate',
                    { roomCode: code.toUpperCase().trim(), name, playerId: pid },
                    (res) => {
                        setJoining(false);
                        if (res?.error) flash(res.error);
                        else applyJoin(res);
                        resolve(res);
                    },
                );
            }),
        [applyJoin, flash],
    );

    const leaveRoom = useCallback(() => {
        socket.emit('room:leave');
        clearRoom();
        setRoomCode(null);
        setSpectating(false);
        setState(null);
        setHand([]);
    }, []);

    const send = useCallback((event, payload) => socket.emit(event, payload), []);

    const value = useMemo(() => {
        const me = state?.players.find((p) => p.id === playerId) || null;
        const current = state?.players[state.turnIndex] || null;
        return {
            connected,
            joining,
            notice,
            presence,
            playerId,
            roomCode,
            state,
            // Which game this room is playing, so a screen can be chosen
            // before anything else is read.
            game: state?.game || 'nopoly',
            hand,
            // Board meta comes down with the state, so a board swap in the
            // lobby reaches everyone on the next broadcast.
            board: state?.board || null,
            me,
            current,
            isMyTurn: !!me && !!current && me.id === current.id && !state.paused,
            isHost: !!state && state.hostId === playerId,
            spectating,
            createRoom,
            joinRoom,
            spectate,
            leaveRoom,
            flash,
            send,
            serverNotice,
        };
    }, [connected, joining, notice, serverNotice, presence, playerId, roomCode, state, hand, spectating, createRoom, joinRoom, spectate, leaveRoom, flash, send]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
    const ctx = useContext(GameContext);
    if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
    return ctx;
}
