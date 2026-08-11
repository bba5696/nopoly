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
