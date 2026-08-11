// Notification tones, synthesised rather than shipped as audio files: they're
// a few hundred bytes of code instead of a download, they can't fail to load,
// and there's nothing extra for the browser to cache badly.
//
// Browsers refuse to start audio until the user has interacted with the page,
// so the context is created lazily and `unlock()` is wired to the first click.
// Without that, the "your turn" ping — which fires from a state update, not a
// gesture — would be silently dropped.

const MUTE_KEY = 'nopoly:muted';

let ctx = null;
let muted = (() => {
    try {
        return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
        return false;
    }
})();

export const isMuted = () => muted;

export function setMuted(next) {
    muted = next;
    try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    } catch {
        // private mode — the setting just won't survive a reload
    }
}

function audio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
}

/** Call once from a real user gesture so later, un-gestured pings can play. */
export function unlock() {
    audio();
}

/**
 * One note. Sine waves only — a square wave at notification volume sounds like
 * an alarm, and this fires every time the turn comes round.
 */
function note(at, freq, duration, peak) {
    const c = audio();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Ramped rather than switched: an instant start or stop clicks audibly.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
}

function play(notes) {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + 0.01;
    for (const [offset, freq, duration, peak] of notes) note(t0 + offset, freq, duration, peak);
}

/** Buzz the phone alongside the tone; silently absent on desktop. */
function buzz(pattern) {
    if (muted) return;
    try {
        navigator.vibrate?.(pattern);
    } catch {
        // some browsers throw rather than no-op when the API is disabled
    }
}

/**
 * Filtered white noise — the basis of anything that isn't a musical note.
 * `sweep` walks the bandpass from one frequency to another, which is what turns
 * a flat hiss into something that reads as movement.
 */
function noise(at, duration, { from, to, peak, q = 1.1, type = 'bandpass' }) {
    const c = audio();
    if (!c) return;
    const frames = Math.max(1, Math.floor(c.sampleRate * duration));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + duration);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.03, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    src.connect(filter).connect(gain).connect(c.destination);
    src.start(at);
    src.stop(at + duration + 0.02);
}

function playNoise(bursts) {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + 0.01;
    for (const [offset, duration, opts] of bursts) noise(t0 + offset, duration, opts);
}

/** Your turn: a rising two-note figure, the most attention-getting of the set. */
export function playTurn() {
    play([
        [0, 587.33, 0.16, 0.16],
        [0.13, 880, 0.28, 0.16],
    ]);
    buzz([60, 50, 90]);
}

/** An offer arrived: softer and lower, so it can't be mistaken for your turn. */
export function playTrade() {
    play([
        [0, 466.16, 0.14, 0.1],
        [0.11, 622.25, 0.2, 0.1],
    ]);
    buzz(50);
}

/** You're in the room. Two quiet notes, nothing ceremonial. */
export function playJoin() {
    play([
        [0, 523.25, 0.12, 0.08],
        [0.09, 659.25, 0.18, 0.08],
    ]);
}

/** Someone else arrived in the lobby — quieter still, it fires repeatedly. */
export function playPlayerJoined() {
    play([[0, 783.99, 0.11, 0.05]]);
}

/** Game on: a major triad, the only fanfare in the set. */
export function playStart() {
    play([
        [0, 523.25, 0.16, 0.13],
        [0.1, 659.25, 0.16, 0.13],
        [0.2, 783.99, 0.34, 0.14],
    ]);
    buzz([70, 60, 70]);
}

/** Bought it: bright and quick, with a little sparkle on top. */
export function playBuy() {
    play([
        [0, 880, 0.1, 0.11],
        [0.07, 1174.66, 0.14, 0.11],
        [0.15, 1567.98, 0.2, 0.06],
    ]);
}

/** Turn handed on: a short descending pair, deliberately unexciting. */
export function playEndTurn() {
    play([
        [0, 392, 0.1, 0.07],
        [0.07, 293.66, 0.16, 0.07],
    ]);
}

/**
 * Dice: a whoosh with two clacks in it. The sweep up and back down is what
 * makes the noise read as a throw rather than a hiss, and the clacks land late
 * so they sound like the dice settling rather than leaving your hand.
 */
export function playRoll() {
    playNoise([
        [0, 0.34, { from: 320, to: 1500, peak: 0.075, q: 0.9 }],
        [0.19, 0.05, { from: 2600, to: 1200, peak: 0.09, q: 1.6 }],
        [0.27, 0.05, { from: 2200, to: 900, peak: 0.075, q: 1.6 }],
    ]);
    buzz(35);
}
