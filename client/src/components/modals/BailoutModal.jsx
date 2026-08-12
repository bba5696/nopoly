import { HandCoins, X } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/board-layout';
import { liquidValue } from '@/lib/rent';

/**
 * Shown to the teammate of someone who owes more than they can raise alone.
 *
 * Accepting moves the debt across rather than the cash: they're free
 * immediately and you're the one who has to sell. That's a big enough
 * commitment to be worth a modal rather than a line in the rail — and it isn't
 * dismissable, because the debtor's turn is frozen until you answer.
 */
export function BailoutModal() {
    const { state, me, send } = useGame();
    if (!me || !state.settings.teams) return null;

    const debtor = state.players.find(
        (p) => p.id !== me.id && p.teamId && p.teamId === me.teamId && p.debt?.bailout === 'offered',
    );
    if (!debtor || me.bankrupt) return null;

    const owed = debtor.debt.amount;
    const canCover = liquidValue(state, me) >= owed;
    const shortfall = owed - liquidValue(state, me);

    return (
        <Modal open subtitle="Your teammate is short" title={`${debtor.name} owes ${money(owed)}`} width={460} dismissable={false}>
            <div className="flex flex-col gap-5 p-5">
                <p className="text-[14px] leading-snug text-muted-foreground">
                    They can't raise it on their own. If you cover it, the debt moves to you — {debtor.name} plays on
                    and <span className="text-foreground">your</span> turn is blocked until you've sold enough to
                    clear it.
                </p>
                <p className="rounded-lg border border-[#ff5c7c]/30 bg-[#ff5c7c]/[0.07] px-3 py-2 text-[13px] leading-snug text-[#ff9db2]">
                    If you don't, {debtor.name} is out and everything they own goes back to the bank — including
                    their share of any set you've built together.
                </p>

                <div className="mono flex justify-between border-y border-dashed border-white/8 py-2.5 text-[13px]">
                    <span className="text-muted-foreground">you could raise</span>
                    <span style={{ color: canCover ? '#3ddc97' : '#ff5c7c' }}>{money(liquidValue(state, me))}</span>
                </div>

                <div className="flex flex-col gap-2.5">
                    <Button className="h-12 text-lg" disabled={!canCover} onClick={() => send('game:bailout', { accept: true })}>
                        <HandCoins /> Cover {money(owed)}
                    </Button>
                    {/* Not a dead end: the debtor can still sell their own estate
                        down, which shrinks this and eventually brings it into
                        reach. Saying so beats a button that's just off. */}
                    {!canCover && (
                        <span className="text-center text-[12px] leading-snug text-muted-foreground">
                            You're {money(shortfall)} short. {debtor.name} can sell their own property down first —
                            this drops as they do.
                        </span>
                    )}
                    <Button
                        variant="outline"
                        className="h-11 text-base"
                        onClick={() => send('game:bailout', { accept: false })}
                    >
                        <X /> Let them go bankrupt
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
