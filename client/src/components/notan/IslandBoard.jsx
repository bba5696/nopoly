import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LOOK, pips } from '@/lib/notan';
import { alpha } from '@/lib/color';
import { ResourceIcon } from '@/components/notan/ResourceIcon';

/** Pixels per unit of the server's geometry (one hex's corner radius). */
const S = 60;

const hexPoints = (x, y, r = 0.97) =>
    Array.from({ length: 6 }, (_, k) => {
        const a = ((60 * k - 90) * Math.PI) / 180;
        return `${(x + Math.cos(a) * r) * S},${(y + Math.sin(a) * r) * S}`;
    }).join(' ');

/** A little house, or a house with a tower for a city. Centred on the corner. */
function Town({ x, y, kind, color, ring, ...hover }) {
    const cx = x * S;
    const cy = y * S;
    const s = kind === 'city' ? 13 : 10;
    const path =
        kind === 'city'
            ? `M${cx - s},${cy + s * 0.75} L${cx - s},${cy - s * 0.1} L${cx - s * 0.35},${cy - s * 0.65} L${cx + s * 0.25},${cy - s * 0.1} L${cx + s * 0.25},${cy - s * 0.55} L${cx + s},${cy - s * 0.55} L${cx + s},${cy + s * 0.75} Z`
            : `M${cx - s},${cy + s * 0.7} L${cx - s},${cy - s * 0.15} L${cx},${cy - s} L${cx + s},${cy - s * 0.15} L${cx + s},${cy + s * 0.7} Z`;
    return (
        <g {...hover}>
            {ring && <circle cx={cx} cy={cy} r={s + 7} fill="none" stroke="#ffd34d" strokeWidth="2" className="animate-pulse" />}
            <path d={path} fill={color} stroke="#0e0e14" strokeWidth="2.5" strokeLinejoin="round" />
        </g>
    );
}

/**
 * The robber: a masked bandit on a dark disc with a red ring, so the one piece
 * that takes things away is the one that stands out on any hex.
 */
function Robber({ x, y, ...hover }) {
    // Off to the side of the number, so the hex it blocks still says what it is.
    const cx = (x - 0.56) * S;
    const cy = y * S + 4;
    return (
        <g {...hover}>
            <circle cx={cx} cy={cy} r="15" fill="#0e0e14" stroke="#ff5c7c" strokeWidth="2" />
            <clipPath id="robber-clip">
                <circle cx={cx} cy={cy} r="13" />
            </clipPath>
            <g clipPath="url(#robber-clip)">
                {/* Shoulders, then the head. */}
                <path d={`M${cx - 10},${cy + 15} Q${cx - 10},${cy + 3.5} ${cx},${cy + 3.5} Q${cx + 10},${cy + 3.5} ${cx + 10},${cy + 15} Z`} fill="#e9e7f2" />
                <circle cx={cx} cy={cy - 3.5} r="5.5" fill="#e9e7f2" />
                {/* The mask across the eyes, with the eyes cut out of it. */}
                <rect x={cx - 7} y={cy - 5.6} width="14" height="3.8" rx="1.9" fill="#0e0e14" />
                <circle cx={cx - 2.5} cy={cy - 3.7} r="0.95" fill="#e9e7f2" />
                <circle cx={cx + 2.5} cy={cy - 3.7} r="0.95" fill="#e9e7f2" />
            </g>
        </g>
    );
}

/**
 * The island, flat and top-down. Everything clickable is drawn only when it is
 * clickable: legal corners glow while you are placing a town, legal edges while
 * you are placing a road, every hex while the robber is yours to move.
 */
export function IslandBoard({
    map,
    buildings,
    roads,
    robber,
    colorOf,
    nameOf,
    legal,
    mode,
    suggest,
    onVertex,
    onEdge,
    onHex,
    produce,
    setupVertex,
}) {
    const box = useMemo(() => {
        const xs = [...map.vertices.map((v) => v.x), ...map.harbors.map((h) => h.x)];
        const ys = [...map.vertices.map((v) => v.y), ...map.harbors.map((h) => h.y)];
        const pad = 0.55;
        const minX = Math.min(...xs) - pad;
        const minY = Math.min(...ys) - pad;
        return `${minX * S} ${minY * S} ${(Math.max(...xs) - minX + pad) * S} ${(Math.max(...ys) - minY + pad) * S}`;
    }, [map]);

    const legalVertices = new Set(mode === 'settlement' ? legal.settlement : mode === 'city' ? legal.city : []);
    const legalEdges = new Set(mode === 'road' ? legal.road : []);
    const robberMode = mode === 'robber';
    const vertex = (id) => map.vertices[id];

    // What the pointer is over, said in a sentence beside it.
    const [tip, setTip] = useState(null);
    const hover = (text) => ({
        onMouseEnter: (e) => setTip({ text, x: e.clientX, y: e.clientY }),
        onMouseMove: (e) => setTip({ text, x: e.clientX, y: e.clientY }),
        onMouseLeave: () => setTip(null),
    });
    const whose = (pid) => nameOf(pid) || 'Someone';

    return (
        <>
        <svg viewBox={box} className="h-full w-full select-none" role="img" aria-label="The island" onMouseLeave={() => setTip(null)}>
            <defs>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="5" result="b" />
                    <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            {/* Harbours: a thin tether to the two corners that use it, and the
                rate in a pill like the prices on the board game. */}
            {map.harbors.map((h) => {
                const a = vertex(h.a);
                const b = vertex(h.b);
                const color = LOOK[h.type].fill;
                const name = LOOK[h.type].name.toLowerCase();
                return (
                    <g
                        key={`harbor-${h.edgeId}`}
                        {...hover(
                            h.type === 'any'
                                ? '3:1 harbour — with a town on either of its two corners, trade 3 of any one resource for 1 of another.'
                                : `2:1 ${name} harbour — with a town on either of its two corners, trade 2 ${name} for any 1 resource.`,
                        )}
                    >
                        <line x1={a.x * S} y1={a.y * S} x2={h.x * S} y2={h.y * S} stroke="rgba(255,255,255,.18)" strokeWidth="1.5" strokeDasharray="3 3" />
                        <line x1={b.x * S} y1={b.y * S} x2={h.x * S} y2={h.y * S} stroke="rgba(255,255,255,.18)" strokeWidth="1.5" strokeDasharray="3 3" />
                        <rect x={h.x * S - 21} y={h.y * S - 10} width="42" height="20" rx="10" fill="#16161f" stroke={alpha(color, 0.55)} strokeWidth="1.2" />
                        {h.type === 'any' ? (
                            <text x={h.x * S} y={h.y * S + 4} textAnchor="middle" fontSize="10.5" fill={color} className="mono">
                                3:1
                            </text>
                        ) : (
                            <>
                                <text x={h.x * S - 4} y={h.y * S + 4} textAnchor="middle" fontSize="10.5" fill={color} className="mono">
                                    2:1
                                </text>
                                <ResourceIcon kind={h.type} size={12} x={h.x * S + 7} y={h.y * S - 6} strokeWidth={2.4} />
                            </>
                        )}
                    </g>
                );
            })}

            {/* The land. */}
            {map.hexes.map((h) => {
                const look = LOOK[h.resource];
                const red = h.number === 6 || h.number === 8;
                const target = robberMode && h.id !== robber;
                const best = robberMode && suggest?.kind === 'robber' && suggest.at === h.id;
                return (
                    <g
                        key={h.id}
                        onClick={target ? () => onHex(h.id) : undefined}
                        className={target ? 'cursor-pointer' : undefined}
                        {...hover(
                            (h.number
                                ? `${look.name} — pays ${look.name.toLowerCase()} to every town on its corners when a ${h.number} is rolled (${pips(h.number)} in 36 rolls).`
                                : `${look.name} — grows nothing.`) +
                                (h.id === robber ? ' The robber is here, so it pays nothing for now.' : '') +
                                (target ? ' Click to move the robber here.' : ''),
                        )}
                    >
                        <polygon points={hexPoints(h.x, h.y, 0.94)} fill="#16161f" />
                        <polygon
                            points={hexPoints(h.x, h.y, 0.94)}
                            fill={alpha(look.fill, target ? 0.2 : 0.12)}
                            stroke={target ? 'rgba(255,255,255,.7)' : alpha(look.fill, 0.5)}
                            strokeWidth={target ? 2 : 1.4}
                            strokeLinejoin="round"
                            className={target ? 'transition-opacity hover:opacity-70' : undefined}
                        />
                        <ResourceIcon kind={h.resource} size={26} x={h.x * S - 13} y={(h.y - 0.42) * S - 19} />
                        {h.number && (
                            <g style={{ pointerEvents: 'none' }}>
                                <rect
                                    x={h.x * S - 16}
                                    y={(h.y + 0.12) * S - 12}
                                    width="32"
                                    height="24"
                                    rx="8"
                                    fill="#0e0e14"
                                    stroke={red ? 'rgba(255,92,124,.6)' : 'rgba(255,255,255,.12)'}
                                />
                                <text
                                    x={h.x * S}
                                    y={(h.y + 0.12) * S + 5}
                                    textAnchor="middle"
                                    fontSize="14"
                                    fill={red ? '#ff5c7c' : '#e9e7f2'}
                                    className="mono"
                                >
                                    {h.number}
                                </text>
                                {/* The dots: how often it comes up. */}
                                {Array.from({ length: pips(h.number) }, (_, i) => (
                                    <circle
                                        key={i}
                                        cx={h.x * S + (i - (pips(h.number) - 1) / 2) * 4.5}
                                        cy={(h.y + 0.12) * S + 19}
                                        r="1.4"
                                        fill={red ? '#ff5c7c' : 'rgba(233,231,242,.5)'}
                                    />
                                ))}
                            </g>
                        )}
                        {/* Blocked: dimmed, so it reads as paying nothing. */}
                        {h.id === robber && (
                            <polygon points={hexPoints(h.x, h.y, 0.94)} fill="rgba(14,14,20,.55)" style={{ pointerEvents: 'none' }} />
                        )}
                        {best && (
                            <text x={(h.x + 0.5) * S} y={(h.y + 0.55) * S} textAnchor="middle" fontSize="18" fill="#ffd34d" style={{ pointerEvents: 'none' }}>
                                ★
                            </text>
                        )}
                    </g>
                );
            })}

            {/* The hexes that just paid out, lit for a moment after the roll.
                Keyed by the roll, so each one plays once and fades. */}
            {produce?.seq ? (
                <g key={`lit-${produce.seq}`} style={{ pointerEvents: 'none' }}>
                    {map.hexes
                        .filter((h) => h.number === produce.roll && h.id !== robber)
                        .map((h) => (
                            <motion.polygon
                                key={h.id}
                                points={hexPoints(h.x, h.y)}
                                fill="rgba(255,211,77,.12)"
                                stroke="#ffd34d"
                                strokeWidth="2.5"
                                style={{ filter: 'url(#glow)' }}
                                initial={{ opacity: 1 }}
                                animate={{ opacity: 0 }}
                                transition={{ duration: 2, delay: 0.4 }}
                            />
                        ))}
                </g>
            ) : null}

            {/* Roads, built. */}
            {Object.entries(roads).map(([e, pid]) => {
                const edge = map.edges[e];
                const a = vertex(edge.a);
                const b = vertex(edge.b);
                return (
                    <g key={`road-${e}`} {...hover(`${whose(pid)}’s road`)}>
                        <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="#0e0e14" strokeWidth="9" strokeLinecap="round" />
                        <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke={colorOf(pid)} strokeWidth="5" strokeLinecap="round" />
                    </g>
                );
            })}

            {/* Roads you could build. A fat invisible line to hit, a dashed one to see. */}
            {[...legalEdges].map((e) => {
                const edge = map.edges[e];
                const a = vertex(edge.a);
                const b = vertex(edge.b);
                const best = suggest?.kind === 'road' && suggest.at === e;
                return (
                    <g
                        key={`legal-road-${e}`}
                        onClick={() => onEdge(e)}
                        className="group cursor-pointer"
                        {...hover(best ? 'Build a road here — the suggested direction, toward a good open corner.' : 'Build a road here.')}
                    >
                        <line x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} stroke="transparent" strokeWidth="20" />
                        <line
                            x1={a.x * S}
                            y1={a.y * S}
                            x2={b.x * S}
                            y2={b.y * S}
                            stroke={best ? '#ffd34d' : '#ffffff'}
                            strokeWidth="3.5"
                            strokeDasharray="5 5"
                            strokeLinecap="round"
                            className="opacity-80 transition-opacity group-hover:opacity-100"
                        />
                    </g>
                );
            })}

            {/* Towns. */}
            {Object.entries(buildings).map(([v, b]) => (
                <Town
                    key={`town-${v}`}
                    x={vertex(v).x}
                    y={vertex(v).y}
                    kind={b.kind}
                    color={colorOf(b.playerId)}
                    ring={mode === 'city' && legalVertices.has(Number(v))}
                    {...hover(
                        b.kind === 'city'
                            ? `${whose(b.playerId)}’s city — 2 points, collects 2 from each hex it touches.`
                            : `${whose(b.playerId)}’s settlement — 1 point, collects 1 from each hex it touches.`,
                    )}
                />
            ))}
            {setupVertex != null && mode === 'road' && (
                <circle cx={vertex(setupVertex).x * S} cy={vertex(setupVertex).y * S} r="20" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="4 4" />
            )}

            {/* Corners you could settle, or settlements you could crown. */}
            {[...legalVertices].map((v) => {
                const at = vertex(v);
                const best = suggest?.kind === 'settlement' && suggest.at === v;
                return (
                    <g
                        key={`legal-v-${v}`}
                        onClick={() => onVertex(v)}
                        className="group cursor-pointer"
                        {...hover(
                            mode === 'city'
                                ? 'Upgrade this settlement to a city (+1 point, double resources).'
                                : best
                                  ? 'Build a settlement here — the strongest open corner (most dice dots, most kinds).'
                                  : 'Build a settlement here.',
                        )}
                    >
                        <circle cx={at.x * S} cy={at.y * S} r="16" fill="transparent" />
                        {mode === 'settlement' && (
                            <circle
                                cx={at.x * S}
                                cy={at.y * S}
                                r={best ? 8 : 6}
                                fill={best ? '#ffd34d' : 'rgba(233,231,242,.85)'}
                                stroke="#0e0e14"
                                strokeWidth="2"
                                className="animate-pulse group-hover:opacity-100"
                            />
                        )}
                        {best && (
                            <text x={at.x * S} y={at.y * S - 15} textAnchor="middle" fontSize="16" fill="#ffd34d" style={{ pointerEvents: 'none' }}>
                                ★
                            </text>
                        )}
                    </g>
                );
            })}

            <Robber
                x={map.hexes[robber].x}
                y={map.hexes[robber].y}
                {...hover('The robber — the hex it sits on pays nothing. It moves when someone rolls a 7 or plays a Knight, and they steal a card.')}
            />
        </svg>
        {tip && (
            <div
                className="panel pointer-events-none fixed z-50 max-w-[260px] px-2.5 py-1.5 text-[12px] leading-snug"
                style={{ left: tip.x + 14, top: tip.y + 14 }}
            >
                {tip.text}
            </div>
        )}
        </>
    );
}
