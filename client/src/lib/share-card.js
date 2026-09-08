/**
 * The end-of-game graph, redrawn as a picture you can keep.
 *
 * Everyone wants to post the chart afterwards, and a room is gone the moment
 * the server reclaims it — there is no database behind this game and no URL
 * that would still resolve tomorrow. So the souvenir is made on the player's
 * own machine, out of the state they already have, and handed to them as a
 * file. Nothing is uploaded, and nothing has to be kept alive for it to work.
 *
 * Drawn on a canvas rather than screenshotted off the page: the on-screen chart
 * is an SVG full of CSS variables and web fonts, and every DOM-to-image route
 * for that is a dependency plus a list of things that quietly come out blank. A
 * card that composes itself from the numbers renders the same everywhere.
 */

import { money, shortMoney } from '@/lib/board-layout';
import { alpha, tag } from '@/lib/color';

const W = 1200;
const H = 675; // 16:9 — the shape every chat app previews without cropping.
const PAD = 48;

const INK = '#efedf7';
const MUTED = '#8b88a0';
const FAINT = 'rgba(255,255,255,.07)';

const sans = (size, weight = 400) => `${weight} ${size}px "Outfit Variable", system-ui, sans-serif`;
const mono = (size, weight = 400) => `${weight} ${size}px "JetBrains Mono Variable", ui-monospace, monospace`;

/** The spaced-out caps the panels use for section headings. */
function label(ctx, text, x, y) {
    ctx.font = mono(11, 500);
    ctx.fillStyle = MUTED;
    ctx.letterSpacing = '1.4px';
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.letterSpacing = '0px';
}

/** A tick scale that lands on round money, so the gridlines read as amounts. */
function niceMax(value) {
    if (value <= 0) return 1000;
    const pow = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
        if (step * pow >= value) return step * pow;
    }
    return 10 * pow;
}

/**
 * The chart itself, into the box given.
 *
 * The winner gets the weight — a thicker line, a fill under it, a glow —
 * because the picture is being made to say who won. Everyone else stays a thin
 * line: eight filled areas over each other is a smear, not a graph.
 */
function drawChart(ctx, box, series, winnerNames) {
    const { x, y, w, h } = box;
    const len = Math.max(...series.map((s) => s.points.length), 2);
    const peak = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1);
    const top = niceMax(peak * 1.08);

    const px = (i) => x + (w * i) / (len - 1);
    const py = (v) => y + h - (h * v) / top;

    // Gridlines and their amounts. Recessive on purpose: the lines are the
    // data, this is the ruler behind them.
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const v = (top * i) / 4;
        const gy = Math.round(py(v)) + 0.5;
        ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,.14)' : FAINT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
        ctx.font = mono(11);
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'right';
        ctx.fillText(shortMoney(v), x - 12, gy);
    }

    // Turn numbers along the bottom, thinned to whatever fits.
    const turns = series[0]?.points || [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = mono(11);
    ctx.fillStyle = MUTED;
    const every = Math.max(1, Math.ceil(len / 9));
    for (let i = 0; i < len; i += every) ctx.fillText(String(turns[i]?.turn ?? i), px(i), y + h + 12);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Losers first, so the winner's line is never buried under a bankruptcy.
    const order = series
        .slice()
        .sort((a, b) => Number(winnerNames.has(a.name)) - Number(winnerNames.has(b.name)));

    for (const s of order) {
        if (s.points.length < 2) continue;
        const won = winnerNames.has(s.name);
        const path = new Path2D();
        s.points.forEach((p, i) => (i ? path.lineTo(px(i), py(p.value)) : path.moveTo(px(i), py(p.value))));

        if (won) {
            const fill = new Path2D(path);
            fill.lineTo(px(s.points.length - 1), y + h);
            fill.lineTo(px(0), y + h);
            fill.closePath();
            const grad = ctx.createLinearGradient(0, y, 0, y + h);
            grad.addColorStop(0, alpha(s.color, 0.5));
            grad.addColorStop(0.55, alpha(s.color, 0.14));
            grad.addColorStop(1, alpha(s.color, 0));
            ctx.fillStyle = grad;
            ctx.fill(fill);
        }

        ctx.strokeStyle = won ? s.color : alpha(s.color, 0.85);
        ctx.lineWidth = won ? 3.4 : 1.9;
        ctx.shadowColor = alpha(s.color, won ? 0.75 : 0.35);
        ctx.shadowBlur = won ? 18 : 8;
        ctx.stroke(path);
        ctx.shadowBlur = 0;

        // A dot where each line stops. Where it stops on the floor, that is a
        // bankruptcy, and the moment is worth being able to point at.
        const end = s.points.at(-1);
        ctx.fillStyle = won ? s.color : alpha(s.color, 0.9);
        ctx.beginPath();
        ctx.arc(px(s.points.length - 1), py(end.value), won ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** The winner's name, or both of them, laid out from the left edge. */
function drawWinners(ctx, winners, x, y) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    let cx = x;
    winners.forEach((w, i) => {
        if (i) {
            ctx.font = sans(34, 300);
            ctx.fillStyle = MUTED;
            ctx.fillText('&', cx, y);
            cx += ctx.measureText('&').width + 18;
        }
        ctx.fillStyle = w.color;
        ctx.beginPath();
        ctx.arc(cx + 13, y - 11, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = mono(10, 600);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(tag(w), cx + 13, y - 7);
        ctx.textAlign = 'left';
        cx += 36;
        ctx.font = sans(40, 500);
        ctx.fillStyle = INK;
        ctx.fillText(w.name, cx, y);
        cx += ctx.measureText(w.name).width + 20;
    });
}

/**
 * Everyone in finishing order along the bottom — the chart's legend and the
 * scoreboard at once. Eight lines are only identifiable if the colours are
 * named somewhere, and the names may as well carry the numbers.
 */
function drawStandings(ctx, standings, x, y, w) {
    const cols = Math.min(4, Math.max(1, standings.length));
    const cw = w / cols;
    ctx.textBaseline = 'alphabetic';
    standings.slice(0, 8).forEach((p, i) => {
        const cx = x + cw * (i % cols);
        const cy = y + Math.floor(i / cols) * 38;
        ctx.textAlign = 'left';
        ctx.fillStyle = p.bankrupt ? alpha(p.color, 0.45) : p.color;
        ctx.beginPath();
        ctx.roundRect(cx, cy - 9, 10, 10, 3);
        ctx.fill();
        ctx.font = sans(17, 400);
        ctx.fillStyle = p.bankrupt ? MUTED : INK;
        const name = p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name;
        ctx.fillText(name, cx + 20, cy);
        // Right-aligned inside its own column, so the amounts line up down the
        // card however long the names are.
        ctx.textAlign = 'right';
        ctx.font = mono(13);
        ctx.fillStyle = MUTED;
        ctx.fillText(p.bankrupt ? 'bankrupt' : money(p.netWorth), cx + cw - 24, cy);
    });
}

/** Paint the whole card onto a canvas sized for it. */
export function drawShareCard(canvas, card) {
    // Fixed rather than devicePixelRatio: the file should come out the same
    // size whoever made it, phone or desktop.
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.78, -80, 0, W * 0.78, -80, 760);
    glow.addColorStop(0, alpha(card.winners[0]?.color || '#7c5cff', 0.3));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    label(ctx, 'nopoly', PAD, PAD + 4);
    ctx.textAlign = 'right';
    label(ctx, card.host, W - PAD, PAD + 4);
    ctx.textAlign = 'left';

    // A game given a name in the history carries it here, top right under the
    // host — the picture is the thing that gets posted, so the name people
    // gave the game should be on it.
    if (card.title) {
        ctx.textAlign = 'right';
        ctx.font = sans(19, 400);
        ctx.fillStyle = INK;
        const title = card.title.length > 44 ? `${card.title.slice(0, 43)}…` : card.title;
        ctx.fillText(title, W - PAD, PAD + 34);
        ctx.textAlign = 'left';
    }

    label(ctx, card.teamLabel, PAD, PAD + 52);
    if (card.winners.length) {
        drawWinners(ctx, card.winners, PAD, PAD + 96);
    } else {
        ctx.font = sans(40, 500);
        ctx.fillStyle = INK;
        ctx.fillText('Nobody', PAD, PAD + 96);
    }

    ctx.font = mono(14);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(card.facts.join('   ·   '), PAD, PAD + 128);

    drawChart(
        ctx,
        { x: PAD + 62, y: 232, w: W - PAD * 2 - 62, h: 286 },
        card.series,
        new Set(card.winners.map((w) => w.name)),
    );

    ctx.strokeStyle = FAINT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, 566.5);
    ctx.lineTo(W - PAD, 566.5);
    ctx.stroke();
    drawStandings(ctx, card.standings, PAD, 600, W - PAD * 2);

    return canvas;
}

/**
 * The same card, built from a saved or shared game rather than a live room.
 *
 * A link carries the end screen and not the picture: the picture is derived
 * from it, so there is one description of a finished game travelling rather
 * than two copies of the same numbers.
 */
export function cardFromEntry(entry) {
    const winners = entry.players.filter((p) => entry.winnerIds.includes(p.id));
    const ms = (entry.endedAt || Date.now()) - (entry.startedAt || entry.endedAt || Date.now());
    return {
        host: typeof location === 'undefined' ? 'nopoly' : location.host,
        endedAt: entry.endedAt,
        title: entry.nickname || undefined,
        teamLabel: entry.winnerTeam ? `winning team · ${entry.winnerTeam}` : 'winner',
        winners: winners.map((w) => ({ name: w.name, color: w.color, initials: w.initials })),
        facts: [
            `${Math.floor(ms / 60000)} min ${Math.floor((ms % 60000) / 1000)} sec`,
            `${entry.facts.turnCount} turns`,
            `${entry.players.length} players`,
            `${entry.facts.trades} trades`,
        ],
        series: entry.players.map((p) => ({
            name: p.name,
            color: p.color,
            points: (entry.series || []).map((s) => ({ turn: s.turn, value: s.values[p.id] ?? 0 })),
        })),
        standings: entry.players
            .slice()
            .sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || b.netWorth - a.netWorth)
            .map((p) => ({ name: p.name, color: p.color, bankrupt: p.bankrupt, netWorth: p.netWorth })),
    };
}

/** Render to a PNG. Waits on the fonts, or the card comes out in Times. */
export async function shareCardBlob(card) {
    await document.fonts?.ready;
    const canvas = drawShareCard(document.createElement('canvas'), card);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function shareFileName(card) {
    // The name it was given, or whoever won it — either way, something you can
    // find again in a downloads folder.
    const slug = (text) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    const who = (card.title && slug(card.title)) || slug(card.winners[0]?.name || '') || 'game';
    const when = new Date(card.endedAt || Date.now()).toISOString().slice(0, 10);
    return `nopoly-${who}-${when}.png`;
}
