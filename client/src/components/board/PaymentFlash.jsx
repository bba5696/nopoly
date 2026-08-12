import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

import { useGame } from '@/lib/game-context';
import { money } from '@/lib/board-layout';
import { alpha } from '@/lib/color';
import { playCashIn, playCashOut } from '@/lib/sound';

const HOLD_MS = 1700;

/**
 * Rent, tax and fines, made to land.
 *
 * Paying rent is the most consequential thing that happens in a game of this,
 * and it arrived as a line in the history feed and two balances quietly
 * changing — you could miss the biggest moment of the game while looking at
 * your own rail. So it gets the middle of the board for a second and a half.
 *
 * Driven off a sequence number rather than the payment's contents: the same
 * player paying the same rival the same rent twice in a lap is common, and
 * comparing values would show it once.
 */
export function PaymentFlash() {
    const { state, playerId } = useGame();
    const pay = state.lastPayment;
    const seq = pay?.seq ?? 0;
    // Which one has had its moment. Derived rather than copied into state, so
    // nothing is set synchronously while rendering — and seeded from whatever
    // the first state carries, so reconnecting mid-game doesn't replay the last
    // payment as though it had just happened.
    const [dismissed, setDismissed] = useState(seq);
    const shown = pay && pay.amount > 0 && pay.seq !== dismissed ? pay : null;
    const showing = shown?.seq ?? null;

    useEffect(() => {
        if (showing === null) return;
        const it = state.lastPayment;
        if (it.fromId === playerId) playCashOut();
        else if (it.toId === playerId) playCashIn();
        const t = setTimeout(() => setDismissed(showing), HOLD_MS);
        return () => clearTimeout(t);
        // Only when a different payment arrives — `state` changes constantly
        // and re-running this would replay the sound on every broadcast.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showing]);

    const from = shown && state.players.find((p) => p.id === shown.fromId);
    const to = shown && shown.toId && state.players.find((p) => p.id === shown.toId);
    // Green when it's coming to you, red when it's leaving, neutral when it's
    // two other people — the colour is the fastest part to read.
    const tone = !shown ? '#fff' : shown.toId === playerId ? '#3ddc97' : shown.fromId === playerId ? '#ff5c7c' : '#e9e7f2';

    return (
        <AnimatePresence>
            {shown && from && (
                <motion.div
                    key={shown.seq}
                    initial={{ opacity: 0, y: 16, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -26, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                    // Above the board but never in the way of a tap: the whole
                    // thing is inert, and it clears itself.
                    className="pointer-events-none absolute inset-x-0 top-[26%] z-20 flex justify-center"
                >
                    <div
                        className="flex flex-col items-center gap-1 rounded-2xl border px-5 py-3 backdrop-blur-sm"
                        style={{
                            borderColor: alpha(tone, 0.45),
                            background: `linear-gradient(180deg, ${alpha(tone, 0.16)}, rgba(10,10,16,.82))`,
                            boxShadow: `0 18px 50px -20px ${alpha(tone, 0.8)}`,
                        }}
                    >
                        <span className="mono text-[clamp(22px,4.4vw,40px)] leading-none" style={{ color: tone }}>
                            {money(shown.amount)}
                        </span>
                        <span className="flex items-center gap-1.5 text-[clamp(10px,1.5vw,13px)] text-muted-foreground">
                            <span className="max-w-[7em] truncate" style={{ color: from.color }}>
                                {from.name}
                            </span>
                            <ArrowRight className="size-3 shrink-0" />
                            <span className="max-w-[7em] truncate" style={{ color: to ? to.color : undefined }}>
                                {to ? to.name : 'the bank'}
                            </span>
                        </span>
                        {shown.reason && (
                            <span className="label !text-[9.5px] opacity-70">{shown.reason}</span>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
