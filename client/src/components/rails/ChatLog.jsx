import { useEffect, useRef, useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { useGame } from '@/lib/game-context';
import { Button } from '@/components/ui/button';

/** Player chat only — the game's own commentary lives in the board's GameFeed. */
export function ChatLog() {
    const { state, send } = useGame();
    const [text, setText] = useState('');
    const endRef = useRef(null);
    const feed = state.chat;

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [feed.length]);

    const submit = (e) => {
        e.preventDefault();
        const body = text.trim();
        if (!body) return;
        send('chat:send', { text: body });
        setText('');
    };

    return (
        <section className="panel flex min-h-0 flex-1 flex-col">
            <header className="panel-divider px-4 py-3">
                <span className="label">Chat</span>
            </header>
            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3">
                {feed.length === 0 && <p className="text-[13px] text-muted-foreground">Say hello.</p>}
                {feed.map((item) => (
                    <p key={item.id} className="text-[14px] leading-snug">
                        <span className="font-medium" style={{ color: item.color }}>
                            {item.name}
                        </span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="text-foreground/90">{item.text}</span>
                    </p>
                ))}
                <div ref={endRef} />
            </div>
            <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/8 p-3">
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="say something…"
                    maxLength={240}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-black/25 px-3 text-[14px] outline-none placeholder:text-muted-foreground focus:border-primary/60"
                />
                <Button type="submit" size="icon" className="size-10 shrink-0" disabled={!text.trim()}>
                    <SendHorizonal />
                </Button>
            </form>
        </section>
    );
}
