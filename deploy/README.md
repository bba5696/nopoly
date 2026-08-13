# Deploying Nopoly to Oracle Cloud

One VM runs everything: Node serves the API and the built client, Nginx
terminates TLS in front of it. No database — games live in memory, with a
snapshot on disk so a redeploy doesn't end them.

## Before you start

- A **domain name** pointed at the VM's public IP. Let's Encrypt will not issue
  a certificate for a bare IP address, and without HTTPS the shared password
  crosses the internet in the clear. A free DuckDNS subdomain works — see
  [Domain](#domain-free-via-duckdns).
- If you're on the `VM.Standard.E2.1.Micro` shape (1 GB RAM), **do the swap step
  below first**. It is not optional there.

## Swap (required on the 1 GB micro shape)

`npm ci` and the Vite build both need more than a gigabyte. Without swap the
kernel's OOM killer stops them partway, which surfaces as a bare `Killed` or an
unexplained non-zero exit rather than an error that names the real cause.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # survives reboot
free -h                                                       # confirm Swap: 2.0Gi
```

The build is slow on one OCPU — expect a few minutes. If you'd rather not build
on the VM at all, see [Building elsewhere](#building-elsewhere).

## Domain (free, via DuckDNS)

Certbot needs a real hostname; it will not issue for a bare IP. DuckDNS gives
one away and satisfies Let's Encrypt's HTTP challenge fine.

1. Sign in at [duckdns.org](https://duckdns.org) with any of the listed logins.
2. Claim a subdomain — `nopoly` gives you `nopoly.duckdns.org`.
3. Set its IP to the VM's **public** address (the one in the Oracle console, not
   the `10.x` private one) and hit update.

Confirm it resolves before running certbot, or the challenge fails with an error
that points at the wrong thing:

```bash
dig +short nopoly.duckdns.org     # must print your VM's public IP
```

The address is static as long as the instance isn't recreated, so nothing needs
to keep it refreshed.

## The two things that go wrong

Oracle blocks inbound traffic in **two independent places**, and opening only
one leaves you with a server that looks healthy and is unreachable. Do both.

### 1. VCN Security List (Oracle's console)

Networking → Virtual Cloud Networks → your VCN → Security Lists → Default →
**Add Ingress Rules**:

| Source CIDR | Protocol | Dest. port |
|-------------|----------|------------|
| `0.0.0.0/0` | TCP      | `80`       |
| `0.0.0.0/0` | TCP      | `443`      |

### 2. The VM's own iptables

This is the step almost everyone misses. Oracle's images ship with a firewall
that `REJECT`s everything except SSH, so port 80 stays closed even after the
console rule is added. Rules must be inserted **above** that REJECT — appending
them does nothing.

```bash
# Ubuntu images
sudo iptables -I INPUT 6 -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save

# Oracle Linux images use firewalld instead
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

Check the rule actually landed before the REJECT line:

```bash
sudo iptables -L INPUT --line-numbers -n | head -12
```

## Install

```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
```

The repo is private, so the VM needs its own read access. A deploy key is the
narrowest way to grant it — it works for exactly this one repo and nothing else
on the account:

```bash
ssh-keygen -t ed25519 -C "nopoly-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Paste that public key into the repo's **Settings → Deploy keys → Add deploy
key**. Leave "Allow write access" unchecked — the VM only ever pulls. Then:

```bash
git clone git@github.com:YOUR_USER/nopoly.git ~/nopoly

# Build the client — this is what the server serves
cd ~/nopoly/client && npm ci && npm run build

# Server deps, production only
cd ~/nopoly/server && npm ci --omit=dev
```

## Configure the password

```bash
sudo tee /etc/nopoly.env > /dev/null <<'EOF'
NOPOLY_PASSWORD=pick-something-long-here
EOF
sudo chmod 600 /etc/nopoly.env
```

The server **refuses to start** in production without this, rather than quietly
running open to the internet.

## Start it

```bash
sudo cp ~/nopoly/deploy/nopoly.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nopoly
curl localhost:3000/health          # {"ok":true,"rooms":0}
```

## Nginx and TLS

```bash
sudo cp ~/nopoly/deploy/nginx.conf /etc/nginx/sites-available/nopoly
sudo sed -i "s/YOUR_DOMAIN/nopoly.example.com/" /etc/nginx/sites-available/nopoly
sudo ln -sf /etc/nginx/sites-available/nopoly /etc/nginx/sites-enabled/nopoly
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nopoly.example.com
```

Certbot rewrites the site file to add TLS and the port-80 redirect, and installs
a renewal timer.

## Updating

You can deploy while people are playing. Games are snapshotted to disk on the
way out and resumed on the way back in, and every open tab notices the new build
within about twenty seconds, shows "Updating the game", reloads, and rejoins its
seat. From the table it's a few seconds of nothing.

```bash
cd ~/nopoly && git pull
cd client && npm ci && npm run build
cd ../server && npm ci --omit=dev
sudo systemctl restart nopoly
```

Check the build actually changed, or nothing above is live:

```bash
curl -s localhost:3000/version    # must differ from before the deploy
```

### Client-only changes need no restart at all

`express.static` reads from disk per request, so a rebuilt `client/dist` is
served immediately by the running process. If nothing under `server/` changed,
stop after `npm run build` — no restart, no reconnect, nothing to resume.

### The state snapshot

Written to `/var/lib/nopoly/rooms.json` — created and owned by systemd via
`StateDirectory=nopoly` in the unit, which is also the only path the service can
write to under `ProtectSystem=strict`. It's saved on shutdown and every 15
seconds, so a `kill -9` or a power cut costs at most a few moves. It's deleted
once resumed, and ignored if older than six hours.

**If you installed the unit before this existed, reinstall it** — without
`StateDirectory=` the save silently fails and restarts still end every game:

```bash
sudo cp ~/nopoly/deploy/nopoly.service /etc/systemd/system/nopoly.service
sudo systemctl daemon-reload && sudo systemctl restart nopoly
journalctl -u nopoly -n 5 | grep State:     # "saved N room(s)" / "resumed N room(s)"
```

## Building elsewhere

The alternative to building on a slow VM: build on your own machine and copy the
output up. `client/dist` is the only thing the server needs — it's gitignored, so
it doesn't travel with `git pull` and has to be copied on every deploy.

```bash
# on your machine, from the repo root
cd client && npm run build
scp -r dist ubuntu@YOUR_IP:~/nopoly/client/
ssh ubuntu@YOUR_IP 'sudo systemctl restart nopoly'
```

The server still needs its own dependencies installed on the VM
(`npm ci --omit=dev` in `server/`), but that's a much lighter install than the
client's and completes fine on 1 GB.

## Do not run two instances

Games live in the memory of one process. A second instance behind a load
balancer would put players into two different worlds that never see each other.
One VM, one process.

This is also why the game **cannot be hosted on Vercel**, or on anything else
serverless. Vercel's own WebSocket documentation is explicit that new
connections are not guaranteed to reach the same function instance and that
rooms and presence must live in an external store rather than in memory — which
is `rooms`, the three `setTimeout` clocks, and `persist.js`. Hosting it there
means adding Redis and reworking `index.js`, not changing a setting.

## A second hostname, via Vercel (optional)

What Vercel *can* do is stand in front of the VM. Useful when the DuckDNS name
is filtered somewhere you want to play — a school or office network — since the
game then answers on a `vercel.app` address as well. Oracle still runs
everything; Vercel only forwards.

`vercel.json` at the repo root holds the rewrite. Point its `destination` at
your own hostname if it isn't `nopoly.duckdns.org`:

```json
{ "rewrites": [{ "source": "/:path(.*)", "destination": "https://YOUR_HOST/:path" }] }
```

`/:path(.*)` and not the more obvious `/:path*`. The starred form does not match
an empty path or one ending in a slash, which is a quiet way to lose exactly two
routes: `/`, so the site never loads at all, and `/socket.io/`, so it loads and
then can't reach the game. Everything in between — `/version`, `/assets/…`,
`/auth/required` — proxies fine either way, which is what makes it look like it
works.

Then import the repo at [vercel.com/new](https://vercel.com/new). `vercel.json`
already sets the framework to none and the output directory to `public/`, which
is deliberately empty — Vercel serves its static output *before* it applies a
rewrite, so pointing that at the repo root would publish `server/` to the
internet instead of forwarding it. Leave `public/` empty.

Two things make this work, and both are easy to undo by accident:

- **Socket.IO must keep its default transports.** It opens on HTTP long-polling
  and upgrades to a WebSocket only where one is available. Vercel rewrites do
  not carry a WebSocket upgrade to an external origin, so the connection stays
  on polling and the game plays normally. Pinning `transports: ['websocket']` in
  `client/src/lib/socket.js` would kill this route while leaving Oracle fine —
  the comment there says so.
- **`TRUST_PROXY_HOPS`.** Direct traffic passes through one proxy (Nginx);
  traffic through Vercel passes through two. Only the login rate limiter reads
  `req.ip`. Left at the default of 1, everyone arriving via Vercel shares one
  bucket, so eight bad password attempts between them triggers the cooldown for
  all of them. Set it to `2` in `/etc/nopoly.env` if most people come in that
  way — at the cost of the header being spoofable on the direct route.

Long-polling holds a request open for around 25 seconds while it waits for
something to happen. Vercel does not document a timeout for proxied external
requests, so if connections drop in a quiet lobby, that is the first suspect —
and the fallback is Cloudflare in front of the VM instead, which proxies
WebSockets properly but needs a domain you own.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page never loads from outside, `curl localhost` works | iptables — see step 2 above |
| Loads, but moves lag by seconds | WebSocket upgrade headers missing from the Nginx `/socket.io/` block |
| "Too many attempts" for everyone at once | `X-Real-IP` / `X-Forwarded-For` not being passed, so all players share one bucket |
| Server won't start | `NOPOLY_PASSWORD` unset — check `journalctl -u nopoly -n 50` |
| Everyone dropped after a minute idle | `proxy_read_timeout` too low |
