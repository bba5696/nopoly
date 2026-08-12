import { useGame } from '@/lib/game-context';
import { cn } from '@/lib/utils';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * How many people are on the server right now, and how many games are running.
 *
 * The group is small enough that "is anyone around?" is the real question
 * before you set anything up, and until now the only way to answer it was to
 * ask somewhere else. Counts only — a room is findable by its code and nothing
 * here hands one out.
 */
export function PresencePill({ className }) {
    const { connected, presence } = useGame();

    if (!connected) {
        return <span className={cn('label text-[#ff5c7c]', className)}>offline</span>;
    }

    // The first push lands a beat after the socket does. Until then we know one
    // thing for certain, which is that we're here.
    const online = presence?.online ?? 1;
    const playing = presence?.playing ?? 0;
    const games = presence?.games ?? 0;

    return (
        <span
            className={cn('flex items-center gap-2', className)}
            title={
                games
                    ? `${plural(playing, 'player')} in ${plural(games, 'game')}, ${online - playing} in the menu`
                    : 'Nobody has a game running'
            }
        >
            <span className="relative flex size-2 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#3ddc97] opacity-60" />
                <span className="relative size-2 rounded-full bg-[#3ddc97]" />
            </span>
            <span className="label text-[#3ddc97]">{plural(online, 'player')} online</span>
            {games > 0 && <span className="label text-muted-foreground">· {plural(games, 'game')}</span>}
        </span>
    );
}
