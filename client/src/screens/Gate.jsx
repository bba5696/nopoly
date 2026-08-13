import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BuildTag } from '@/components/ui/build-tag';
import { login } from '@/lib/socket';

/**
 * Shared-password screen. This is only the front door — the server checks the
 * token again on the socket handshake, so getting past this without the
 * password doesn't get you a game.
 */
export function Gate({ onUnlocked }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError('');
        const res = await login(password);
        setBusy(false);
        if (res.error) {
            setError(res.error);
            setPassword('');
            return;
        }
        onUnlocked();
    };

    return (
        <div className="flex min-h-svh items-center justify-center p-6">
            <motion.form
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                onSubmit={submit}
                className="panel flex w-full max-w-[420px] flex-col gap-7 p-10"
            >
                <header className="flex flex-col items-center gap-3 text-center">
                    <span
                        className="flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"
                        style={{ boxShadow: '0 0 30px rgba(124,92,255,.25)' }}
                    >
                        <Lock className="size-5" />
                    </span>
                    <span className="text-3xl font-medium tracking-tight">nopoly</span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                        Private game. Enter the password your friends gave you.
                    </span>
                </header>

                <div className="flex flex-col gap-2">
                    <input
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="password"
                        className="min-w-0 rounded-xl border border-input bg-black/25 px-4 text-lg outline-none placeholder:text-muted-foreground focus:border-primary/60"
                        style={{ height: 52 }}
                    />
                    {error && <span className="label text-center text-[#ff5c7c]">{error}</span>}
                </div>

                <Button type="submit" className="h-13 text-lg" style={{ height: 52 }} disabled={!password || busy}>
                    {busy ? 'Checking…' : 'Enter'}
                </Button>

                {/* Readable without logging in, which is the point: checking a
                    friend's phone shouldn't need the password first. The same
                    reasoning puts the terms link here — terms you can only
                    reach after agreeing to them aren't terms. A plain anchor,
                    since legal.html is its own page outside the app. */}
                <div className="flex flex-col items-center gap-2">
                    <a
                        href="/legal.html"
                        className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Terms &amp; privacy
                    </a>
                    <BuildTag className="text-center" />
                </div>
            </motion.form>
        </div>
    );
}
