import { Sparkles, Gift } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/**
 * Chance ("Surprise") / Community Chest ("Treasure") card reveal. Shown only to
 * the player who drew it — the rest of the table sees the card in the history
 * feed instead of having their screen taken over.
 */
export function CardModal({ open }) {
    const { state, send } = useGame();
    const card = state.pendingCard;
    if (!card) return null;

    const isChance = card.deck === 'chance';
    const accent = isChance ? '#ffb648' : '#4cc9f0';

    return (
        <Modal open={open} onClose={() => send('game:dismissCard')} width={400}>
            <div className="flex flex-col items-center gap-5 p-8 text-center">
                <div
                    className="flex size-14 items-center justify-center rounded-2xl"
                    style={{ background: `${accent}22`, color: accent, boxShadow: `0 0 30px ${accent}44` }}
                >
                    {isChance ? <Sparkles className="size-6" /> : <Gift className="size-6" />}
                </div>
                <span className="label">{isChance ? 'Surprise' : 'Treasure'}</span>
                <p className="text-xl leading-snug">{card.text}</p>
                <Button className="h-11 w-full text-base" onClick={() => send('game:dismissCard')}>
                    Got it
                </Button>
            </div>
        </Modal>
    );
}
