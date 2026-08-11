# Deploying Nopoly to Oracle Cloud

One VM runs everything: Node serves the API and the built client, Nginx
terminates TLS in front of it. No database — all game state is in memory.

## Before you start

- A **domain name** pointed at the VM's public IP. Let's Encrypt will not issue
  a certificate for a bare IP address, and without HTTPS the shared password
  crosses the internet in the clear. A free DuckDNS subdomain is fine.
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

```bash
cd ~/nopoly && git pull
cd client && npm ci && npm run build
cd ../server && npm ci --omit=dev
sudo systemctl restart nopoly
```

**A restart ends every game in progress** — state is in memory only. Deploy when
nobody is mid-game.

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

## Troubleshooting

| Symptom | Cause |
|---|---|
| Page never loads from outside, `curl localhost` works | iptables — see step 2 above |
| Loads, but moves lag by seconds | WebSocket upgrade headers missing from the Nginx `/socket.io/` block |
| "Too many attempts" for everyone at once | `X-Real-IP` / `X-Forwarded-For` not being passed, so all players share one bucket |
| Server won't start | `NOPOLY_PASSWORD` unset — check `journalctl -u nopoly -n 50` |
| Everyone dropped after a minute idle | `proxy_read_timeout` too low |
