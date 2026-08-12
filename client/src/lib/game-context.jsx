/* eslint-disable react-refresh/only-export-components -- provider and its hook belong together */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { socket, loadIdentity, saveIdentity, clearRoom } from './socket';

const GameContext = createContext(null);

export function GameProvider({ children }) {
    const [connected, setConnected] = useState(socket.connected);
    const [playerId, setPlayerId] = useState(() => loadIdentity().playerId || null);
    const [roomCode, setRoomCode] = useState(null);
    const [state, setState] = useState(null);
    const [notice, setNotice] = useState(null);
    const [joining, setJoining] = useState(false);
    /** Server-wide head count, pushed whenever it changes. */
    const [presence, setPresence] = useState(null);

    const flash = useCallback((text) => {
        setNotice({ text, at: Date.now() });
        setTimeout(() => setNotice((n) => (n && Date.now() - n.at >= 3000 ? null : n)), 3200);
    }, []);

    const applyJoin = useCallback((res) => {
        if (!res || res.error) return res;
        saveIdentity({ playerId: res.playerId, roomCode: res.roomCode });
        setPlayerId(res.playerId);
        setRoomCode(res.roomCode);
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
            const { roomCode: stored, playerId: pid, name } = loadIdentity();
            if (stored) {
                socket.emit('room:join', { roomCode: stored, playerId: pid, name }, (res) => {
                    if (res?.error) {
                        clearRoom();
                        setRoomCode(null);
                        setState(null);
                    } else {
                        applyJoin(res);
                    }
                });
            }
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
            // no longer part of.
            const pid = loadIdentity().playerId;
            if (pid && !next.players.some((p) => p.id === pid)) {
                clearRoom();
                setRoomCode(null);
                setState(null);
                return;
            }
            setState(next);
        };
        const onError = (text) => flash(text);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('state', onState);
        socket.on('presence', onPresence);
        socket.on('error:game', onError);
        document.addEventListener('visibilitychange', reportVisibility);
        if (socket.connected) onConnect();

        return () => {
            document.removeEventListener('visibilitychange', reportVisibility);
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('state', onState);
            socket.off('presence', onPresence);
            socket.off('error:game', onError);
        };
    }, [applyJoin, flash]);

    const createRoom = useCallback(
        (name) =>
            new Promise((resolve) => {
                setJoining(true);
                saveIdentity({ name });
                socket.emit('room:create', { name, playerId: loadIdentity().playerId }, (res) => {
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
                socket.emit(
                    'room:join',
                    { roomCode: code.toUpperCase().trim(), name, playerId: loadIdentity().playerId },
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
        setState(null);
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
            // Board meta comes down with the state, so a board swap in the
            // lobby reaches everyone on the next broadcast.
            board: state?.board || null,
            me,
            current,
            isMyTurn: !!me && !!current && me.id === current.id && !state.paused,
            isHost: !!state && state.hostId === playerId,
            createRoom,
            joinRoom,
            leaveRoom,
            flash,
            send,
        };
    }, [connected, joining, notice, presence, playerId, roomCode, state, createRoom, joinRoom, leaveRoom, flash, send]);

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
    const ctx = useContext(GameContext);
    if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
    return ctx;
}
