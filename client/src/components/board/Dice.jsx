import { motion } from 'framer-motion';

// pip layout per face, on a 3x3 grid (index 0..8)
const FACES = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, rolling, delay = 0 }) {
    const pips = FACES[value] || [];
    return (
        <motion.div
            animate={rolling ? { rotate: [0, -14, 12, -6, 0], y: [0, -14, 0, -5, 0] } : { rotate: 0, y: 0 }}
            transition={{ duration: 0.55, delay, ease: 'easeOut' }}
            className="grid size-[86px] grid-cols-3 grid-rows-3 place-items-center rounded-2xl border border-white/12 bg-gradient-to-br from-[#232333] to-[#15151e] p-2.5 shadow-[0_14px_30px_-14px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.08)]"
        >
            {Array.from({ length: 9 }).map((_, i) => (
                <span
                    key={i}
                    className={`size-2.5 rounded-full ${pips.includes(i) ? 'bg-foreground shadow-[0_0_7px_rgba(233,231,242,.5)]' : 'bg-transparent'}`}
                />
            ))}
        </motion.div>
    );
}

export function Dice({ dice, rolling }) {
    const [a, b] = dice?.[0] ? dice : [1, 1];
    return (
        <div className="flex items-center gap-5">
            <Die value={a} rolling={rolling} />
            <Die value={b} rolling={rolling} delay={0.07} />
        </div>
    );
}
