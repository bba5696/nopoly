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

/* ------------------------------------------------------------ the bell */

/*
 * Everything above is a bare sine with a short decay, which is all a
 * notification needs and is also why it can only ever beep: a sine has no
 * harmonics, so there is nothing in it to sound like an instrument.
 *
 * Completing a set deserves better than a beep, so it gets three things a
 * notification doesn't: overtones, a long tail, and a room to ring out in.
 */

/** A struck-bell spectrum — octave, twelfth and double octave over the root. */
let bellWave = null;
function bell(c) {
    if (!bellWave) {
        const real = new Float32Array([0, 1, 0.44, 0.2, 0.11, 0.05, 0.03, 0.015]);
        bellWave = c.createPeriodicWave(real, new Float32Array(real.length));
    }
    return bellWave;
}

/**
 * A hall to ring out in. Reverb is most of what "angelic" means — the same
 * notes dry sound like a doorbell, and the tail is what turns a sequence of
 * notes into one sustained thing rather than four separate events.
 *
 * The impulse is generated rather than downloaded: noise decaying over three
 * seconds, which is a plain but perfectly convincing hall.
 */
let hall = null;
function reverb(c) {
    if (hall) return hall;
    const seconds = 3;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            // Squared decay, and a short silent head so the dry note lands first.
            const t = i / len;
            data[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.6 * (i < 480 ? i / 480 : 1);
        }
    }
    const node = c.createConvolver();
    node.buffer = buf;
    const wet = c.createGain();
    wet.gain.value = 0.9;
    node.connect(wet).connect(c.destination);
    hall = node;
    return hall;
}

/**
 * One rung of the bell. Two oscillators a few cents apart, because a single
 * one is static and the beating between two is what reads as a voice rather
 * than a tone generator.
 */
function chime(at, freq, duration, peak, detune = 7) {
    const c = audio();
    if (!c) return;
    const send = reverb(c);
    for (const cents of [-detune, detune]) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.setPeriodicWave(bell(c));
        osc.frequency.value = freq;
        osc.detune.value = cents;
        // Swelled rather than struck: a 60ms attack is the difference between
        // a chime and a click, and it's what lets the notes bleed together.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak / 2, at + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain);
        gain.connect(c.destination);
        gain.connect(send);
        osc.start(at);
        osc.stop(at + duration + 0.05);
    }
}

function playChimes(notes) {
    if (muted) return;
    const c = audio();
    if (!c) return;
    const t0 = c.currentTime + 0.02;
    for (const [offset, freq, duration, peak] of notes) chime(t0 + offset, freq, duration, peak);
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
    // Noise needs roughly twice the gain of a tone to land as equally loud: a
    // bandpass throws away everything outside its band, so the number here
    // isn't comparable to the peaks the sine-based sounds use. Widening the Q
    // does as much work as the gain does — it lets more of the burst through
    // and gives the clacks some body instead of a thin tick.
    const k = distant ? 0.62 : 1;
    playNoise([
        [0, 0.34, { from: 320, to: 1500, peak: 0.13 * k, q: 0.8 }],
        [0.19, 0.05, { from: 2600, to: 1200, peak: 0.17 * k, q: 1.3 }],
        [0.27, 0.05, { from: 2200, to: 900, peak: 0.15 * k, q: 1.3 }],
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
    // The notes overlap rather than follow each other: by the time the top one
    // lands the first three are still ringing, so it arrives as a chord that
    // was built rather than four notes in a row. C major, up two octaves.
    playChimes([
        [0, 261.63, 2.8, 0.085],
        [0.11, 392.0, 2.6, 0.075],
        [0.22, 523.25, 2.6, 0.08],
        [0.33, 659.25, 2.4, 0.075],
        [0.44, 783.99, 2.4, 0.07],
        // Two octaves above the root, quiet and late — the shine on top.
        [0.62, 1046.5, 2.2, 0.05],
        [0.62, 1567.98, 1.8, 0.022],
    ]);
    buzz([40, 60, 40, 60, 110]);
}

export function playRivalSet() {
    // Same instrument, so it reads as the same event happening to someone
    // else; a minor triad falling instead of a major one rising, and no shine
    // on top. Quieter too — it's news, not an announcement.
    playChimes([
        [0, 440.0, 2.6, 0.055],
        [0.13, 349.23, 2.6, 0.05],
        [0.26, 261.63, 2.8, 0.055],
        // A low root underneath, which is what makes it land as a weight.
        [0.4, 130.81, 3.0, 0.045],
    ]);
}

/**
 * Money arriving. The bell again, because collecting rent is the other moment
 * worth enjoying — a bright two-note lift, short enough to fire several times
 * a lap without wearing out.
 */
export function playCashIn() {
    playChimes([
        [0, 783.99, 1.4, 0.06],
        [0.08, 1046.5, 1.6, 0.055],
    ]);
}

/** Money leaving: a dull thud under two falling notes. Deliberately no shine. */
export function playCashOut() {
    play([
        [0, 293.66, 0.16, 0.085],
        [0.1, 196.0, 0.3, 0.09],
    ]);
    playNoise([[0, 0.16, { from: 380, to: 120, peak: 0.11, q: 0.8 }]]);
    buzz(45);
}

/**
 * Someone went to jail: a flat, unmusical clack and the thud after it. The
 * narrow bands this started with made it nearly inaudible — a door closing is
 * broadband, and squeezing it through a high-Q filter left a tick.
 */
export function playJail() {
    playNoise([
        [0, 0.08, { from: 1900, to: 700, peak: 0.2, q: 1.3 }],
        [0.09, 0.2, { from: 520, to: 170, peak: 0.17, q: 0.9 }],
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
