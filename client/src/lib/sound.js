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
    // Mute is the master: it silences the bed too, and unmuting brings it back
    // only if it was wanted in the first place.
    if (next) stopMusic();
    else if (musicOn) startMusic();
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

/* ---------------------------------------------------------------- music */

/**
 * A background bed for the long waits between your turns.
 *
 * Synthesised like everything else here, which rules out anything with a tune —
 * a melody you can hum is a melody you'll hate on the fortieth loop, and a
 * game runs for an hour. So it's four slow chords on a soft triangle pad, each
 * held for eight seconds, drifting through a progression that doesn't resolve.
 * It's meant to be noticed once and then not again.
 *
 * Off by default. Background music is the most personal setting in any game,
 * and starting it unasked in a room where someone is on a call is worse than
 * not having it.
 */
const MUSIC_KEY = 'nopoly:music';
/** Root notes of the progression, in Hz — Am, F, C, G, low and wide apart. */
const CHORDS = [
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [196.0, 261.63, 329.63],
    [196.0, 246.94, 293.66],
];
const CHORD_SECONDS = 8;

let musicOn = (() => {
    try {
        return localStorage.getItem(MUSIC_KEY) === '1';
    } catch {
        return false;
    }
})();
let musicTimer = null;
let musicGain = null;
let chordAt = 0;

export const isMusicOn = () => musicOn;

/** Schedule the next chord a little ahead of when it's needed. */
function scheduleChord() {
    const c = audio();
    if (!c || !musicGain) return;
    const chord = CHORDS[chordAt % CHORDS.length];
    chordAt += 1;
    const at = c.currentTime + 0.1;
    for (const freq of chord) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        // Long fades both ways, so chords bleed into each other rather than
        // arriving — the seam is what would make a loop audible as a loop.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.055, at + CHORD_SECONDS * 0.4);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + CHORD_SECONDS * 1.05);
        osc.connect(gain).connect(musicGain);
        osc.start(at);
        osc.stop(at + CHORD_SECONDS * 1.1);
    }
}

export function startMusic() {
    const c = audio();
    if (!c || musicTimer) return;
    if (!musicGain) {
        musicGain = c.createGain();
        // Under everything else by a wide margin: this is a floor, not a layer
        // you're meant to listen to.
        musicGain.gain.value = 0.5;
        musicGain.connect(c.destination);
    }
    scheduleChord();
    musicTimer = setInterval(scheduleChord, CHORD_SECONDS * 1000);
}

export function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
    if (musicGain) {
        // Faded rather than cut, or the pad stops mid-swell with a thud.
        const c = audio();
        if (c) {
            musicGain.gain.setValueAtTime(musicGain.gain.value, c.currentTime);
            musicGain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.2);
        }
        const dying = musicGain;
        musicGain = null;
        setTimeout(() => dying.disconnect(), 1600);
    }
}

export function setMusicOn(next) {
    musicOn = next;
    try {
        localStorage.setItem(MUSIC_KEY, next ? '1' : '0');
    } catch {
        // private mode — the setting just won't survive a reload
    }
    if (next && !muted) startMusic();
    else stopMusic();
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
 *
 * `distant` is the same throw heard from across the table — someone else's.
 * It has to be quiet enough to be background and present enough to say the
 * game is still moving, because waiting for your turn used to be silent.
 */
export function playRoll(distant = false) {
    const k = distant ? 0.42 : 1;
    playNoise([
        [0, 0.34, { from: 320, to: 1500, peak: 0.075 * k, q: 0.9 }],
        [0.19, 0.05, { from: 2600, to: 1200, peak: 0.09 * k, q: 1.6 }],
        [0.27, 0.05, { from: 2200, to: 900, peak: 0.075 * k, q: 1.6 }],
    ]);
    if (!distant) buzz(35);
}

/** Someone else bought something — the purchase sparkle, held back. */
export function playRivalBuy() {
    play([
        [0, 880, 0.09, 0.045],
        [0.07, 1174.66, 0.13, 0.04],
    ]);
}

/**
 * A colour set completed — the moment rent doubles and building starts, and
 * the most consequential thing that happens in a game.
 *
 * Two versions, because it means opposite things depending on whose it is. Ana
 * ascending major arpeggio for yours; the same shape falling, and darker, for
 * a rival's. Everyone hears one or the other: a set changing hands is news for
 * the whole table, not just the person it happened to.
 */
export function playSet() {
    play([
        [0, 523.25, 0.14, 0.12],
        [0.09, 659.25, 0.14, 0.12],
        [0.18, 783.99, 0.14, 0.12],
        [0.27, 1046.5, 0.42, 0.13],
    ]);
    buzz([50, 40, 50, 40, 90]);
}

export function playRivalSet() {
    play([
        [0, 622.25, 0.14, 0.075],
        [0.1, 466.16, 0.16, 0.075],
        [0.21, 311.13, 0.44, 0.08],
    ]);
}

/** Someone went to jail: a flat, unmusical clack. */
export function playJail() {
    playNoise([
        [0, 0.07, { from: 1800, to: 700, peak: 0.075, q: 2.2 }],
        [0.09, 0.16, { from: 500, to: 180, peak: 0.06, q: 1.4 }],
    ]);
}

/** Someone is out. Low and slow — the only sound in the set that sits still. */
export function playBankrupt() {
    play([
        [0, 349.23, 0.2, 0.09],
        [0.16, 261.63, 0.24, 0.09],
        [0.34, 174.61, 0.6, 0.1],
    ]);
}
