# Deploying Shortly to production (split architecture)

End-to-end CI/CD with each component running where it makes the most sense:

```
                         ┌──────────────┐
   shortly.example.com ─▶│    Vercel    │  ← React SPA (free CDN, global)
                         └──────────────┘
                                │   API calls
                                ▼
                         ┌──────────────────┐
api.shortly.example.com ▶│   EC2 (free)     │
                         │  ┌────────────┐  │     ┌──────────────┐
                         │  │   Caddy    │  │  ┌─▶│   Supabase   │ ← Postgres
                         │  ├────────────┤  │  │  └──────────────┘
                         │  │  backend   │──┼──┤
                         │  ├────────────┤  │  │  ┌──────────────┐
                         │  │   redis    │◀─┼──┘  │ Grafana Cloud│ ← logs
                         │  ├────────────┤  │     └──────────────┘
                         │  │  promtail  │──┼─────────▲
                         │  └────────────┘  │
                         └──────────────────┘
```

Three external SaaS pieces (free tier): **Supabase** (Postgres),
**Vercel** (frontend hosting), **Grafana Cloud** (logs).
EC2 only runs three small containers — easily fits in 1 GB of free-tier RAM.

## The phases

| # | Phase                          | What happens                                          | Time      |
|---|--------------------------------|-------------------------------------------------------|-----------|
| 1 | Supabase (Postgres)            | Create project, get connection string                 | ~5 min    |
| 2 | EC2 prep                       | Install Docker, copy deploy files, edit `.env`        | ~15 min   |
| 3 | DNS                            | Two records: apex → Vercel, `api` → EC2               | ~5 min    |
| 4 | First manual backend deploy    | `docker compose up`, verify `https://api.…/actuator/health` | ~10 min |
| 5 | Vercel (frontend)              | Connect repo, set `VITE_API_BASE_URL`, deploy         | ~10 min   |
| 6 | GitHub Actions secrets         | Add `EC2_HOST`/`EC2_USER`/`EC2_SSH_KEY`               | ~3 min    |
| 7 | Google OAuth prod redirect URI | Add `https://api.…/login/oauth2/code/google`          | ~3 min    |
| 8 | Grafana Cloud (optional)       | Off-server logs                                       | ~10 min   |

---

## Phase 1 — Supabase (Postgres)

1. Sign up at https://supabase.com (use GitHub login).
2. **New project** → name it `shortly`, pick region close to your EC2.
   Choose a strong password (you'll need it).
3. After provisioning (~2 min), go to **Project Settings → Database → Connection string**.
4. Pick the **JDBC** tab. You'll see something like:
   ```
   jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:5432/postgres?user=postgres.abcdefgh&password=YOUR-PASSWORD
   ```
5. Split that into the three values you'll put in `.env`:
   ```
   SUPABASE_DB_URL=jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
   SUPABASE_DB_USER=postgres.abcdefgh
   SUPABASE_DB_PASSWORD=YOUR-PASSWORD
   ```
   (Move user/password out of the URL — Hikari wants them as separate fields.
   Add `?sslmode=require`.)
6. **Run the migrations**: in the Supabase **SQL Editor**, paste the contents
   of `backend/src/main/resources/db/migration/V1__init_schema.sql` and run.
   Then V2, V3, V4, V5 in order.
   (Or skip — Flyway will run them automatically when the backend first starts.)

✅ **Phase 1 done** when you have the three SUPABASE_DB_* values written down.

---

## Phase 2 — Prepare your EC2 box

SSH in:

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@<ec2-public-ip>
```

Install Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
newgrp docker
docker run --rm hello-world
```

Open ports 80 + 443 in the EC2 **Security Group** (AWS Console → instance →
Security tab → click the SG → Edit inbound rules):

| Port | Source       | Purpose         |
|------|--------------|-----------------|
| 22   | My IP        | SSH (you only)  |
| 80   | 0.0.0.0/0    | HTTP (ACME + redirect) |
| 443  | 0.0.0.0/0    | HTTPS           |

Create the project directory and pull the deploy files from your repo:

```bash
sudo mkdir -p /opt/shortly
sudo chown $USER:$USER /opt/shortly
cd /tmp
git clone https://github.com/BaLjEeTX/shortly.git
cp shortly/deploy/docker-compose.prod.yml   /opt/shortly/docker-compose.yml
cp shortly/deploy/Caddyfile                 /opt/shortly/Caddyfile
cp shortly/deploy/.env.example              /opt/shortly/.env
cp shortly/deploy/promtail-prod-config.yml  /opt/shortly/promtail-prod-config.yml
rm -rf shortly
cd /opt/shortly && ls -la
```

Generate a JWT secret:

```bash
openssl rand -base64 64 | tr -d '\n'; echo
```

Copy that line.

Edit `.env`:

```bash
nano /opt/shortly/.env
```

Fill in:
- `GITHUB_OWNER` = `baljeetx` (your GitHub username, **lowercase**)
- `FRONTEND_DOMAIN` = `shortly.example.com` (your apex domain)
- `API_DOMAIN` = `api.shortly.example.com` (api subdomain)
- `ACME_EMAIL` = your email
- `SUPABASE_DB_URL`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD` (from Phase 1)
- `JWT_SECRET` = paste the openssl output
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (same as local `.env`)
- Leave `GRAFANA_LOKI_*` for now

Save, exit, lock it down:

```bash
chmod 600 /opt/shortly/.env
```

Comment out the promtail service (skip it for now):

```bash
sed -i '/^  promtail:/,/^      - promtail_positions:\/tmp$/s/^/#/' /opt/shortly/docker-compose.yml
```

Login to GHCR so the box can pull your backend image:

1. On GitHub → Settings → Developer settings → Personal access tokens →
   *Tokens (classic)* → Generate new token. Scope: `read:packages`. Copy it.
2. ```
   echo "<paste-the-PAT>" | docker login ghcr.io -u BaLjEeTX --password-stdin
   ```

Verify:

```bash
cd /opt/shortly
docker compose config | head -30        # should print clean YAML
grep -E '^[A-Z]' .env | grep -v 'replace-me'   # should show only real values
```

✅ **Phase 2 done** when `docker compose config` exits clean and `.env` has no `replace-me` strings left.

---

## Phase 3 — DNS (two records)

You need TWO DNS records: the apex points at Vercel, the `api` subdomain
points at EC2.

In your registrar's DNS panel (GoDaddy / Namecheap / Hostinger):

| Type   | Host  | Value                          | TTL | Purpose                |
|--------|-------|--------------------------------|-----|------------------------|
| A      | `api` | `<your EC2 elastic IP>`        | 600 | Backend API on EC2     |
| CNAME  | `@`   | `cname.vercel-dns.com.`        | 600 | Frontend on Vercel     |

(If your registrar doesn't allow CNAME on the apex `@`, use Vercel's `A 76.76.21.21` instead — Vercel docs confirm that IP. Or use Cloudflare's CNAME flattening. Tell me which registrar and I'll give the exact steps.)

Wait 1–10 min, then verify:

```bash
dig +short api.shortly.example.com    # should return your EC2 IP
dig +short shortly.example.com        # should return Vercel IPs
```

✅ **Phase 3 done** when both DNS lookups return the expected IPs.

---

## Phase 4 — First manual backend deploy

This requires that you've already pushed the project to GitHub at least once
with `.github/workflows/deploy.yml` present **and** that the `build-backend`
job has run successfully. So first, on your **Mac**:

```bash
cd /Users/baljeetsingh/Development/Project/SpringBoot/LinkShortner
git add .
git commit -m "feat: split-architecture production deploy"
git push origin main
```

Watch https://github.com/BaLjEeTX/shortly/actions. The `test` and
`build-backend` jobs should both pass. `deploy` will fail (no EC2 secrets yet
— that's fine, we add them in Phase 6).

When `build-backend` is green, the image appears at
https://github.com/BaLjEeTX?tab=packages as `shortly-backend`.

Then on EC2:

```bash
cd /opt/shortly
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f backend
```

Wait until you see `Started ShortlyApplication`. From your Mac:

```bash
curl -i https://api.shortly.example.com/actuator/health
# expect: HTTP/2 200 with {"status":"UP",...}
```

(Caddy fetches a Let's Encrypt cert on first request — give it ~30 seconds.)

Smoke test the anonymous URL endpoint:

```bash
curl -X POST https://api.shortly.example.com/api/v1/urls/anonymous \
  -H 'Content-Type: application/json' \
  -d '{"longUrl":"https://example.com","durationMinutes":5}'
```

If the cert never appears: `docker compose logs caddy` tells you why
(usually DNS hasn't propagated, or 80/443 are closed in the SG).

✅ **Phase 4 done** when `https://api.<domain>/actuator/health` returns 200 over HTTPS.

---

## Phase 5 — Vercel (deploy the frontend)

1. Sign up at https://vercel.com (use GitHub login).
2. **Add New Project** → import your `BaLjEeTX/shortly` repo.
3. *Configure project*:
   - **Root directory**: `frontend` ← critical
   - Framework preset: Vite (auto-detected)
   - Build/Install commands: leave default (vercel.json provides them)
4. **Environment variables** — add ONE:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://api.shortly.example.com`
   - Apply to: Production, Preview, Development
5. Click **Deploy**.
6. After deploy succeeds, go to **Settings → Domains** and add
   `shortly.example.com` (or whatever your apex is). Vercel will tell you
   the DNS records needed — they should match what you set in Phase 3. If
   you get a checkmark, you're good. If "Invalid configuration", DNS hasn't
   propagated yet — wait, then click "Refresh".
7. Browse to `https://shortly.example.com`. You should see the landing page
   served from Vercel's global CDN.

To verify the frontend is talking to your backend, open the browser's
DevTools → Network tab → click "Shorten". You should see a request to
`https://api.shortly.example.com/api/v1/urls/anonymous` returning 200.

✅ **Phase 5 done** when the landing page loads from your domain and shortening a URL succeeds.

---

## Phase 6 — Wire GitHub Actions to deploy automatically

So far the `deploy` job in your workflow fails because we haven't given it
EC2 credentials. Add three repo secrets:

GitHub repo → **Settings → Secrets and variables → Actions** → *New repository secret*.

| Secret name    | Value                                                      |
|----------------|------------------------------------------------------------|
| `EC2_HOST`     | Your EC2 elastic IP                                        |
| `EC2_USER`     | `ubuntu`                                                   |
| `EC2_SSH_KEY`  | Full **private** key text (`-----BEGIN ... END-----`)      |

For `EC2_SSH_KEY`, on your Mac:
```bash
cat ~/.ssh/your-key.pem
```
Paste that whole blob.

Then create the **`production` environment**: Settings → Environments →
*New environment* → name it `production`. Optionally tick **Required reviewers**
and add yourself for a manual-approval gate.

Trigger:

```bash
echo "" >> README.md
git commit -am "ci: trigger deploy"
git push
```

Watch Actions. `test` → `build-backend` → `deploy` should all turn green.

✅ **Phase 6 done** when a fresh push to `main` lands on EC2 within ~3 min.

---

## Phase 7 — Google OAuth: add the production redirect URI

Open https://console.cloud.google.com/auth/clients → click your client →
under **Authorized redirect URIs**, add:

```
https://api.shortly.example.com/login/oauth2/code/google
```

Keep the localhost URI so local dev still works.

In the consent screen → **Audience → Authorized domains** → add `shortly.example.com`.

✅ **Phase 7 done** when "Continue with Google" on `https://shortly.example.com` lands you signed in on the dashboard.

---

## Phase 8 — Grafana Cloud (optional)

Off-server hosted logs + dashboards.

1. Sign up at https://grafana.com (free tier).
2. Once your stack is provisioned: **My Account → your stack → Loki → Send Logs**.
   You'll see:
   - URL: `https://logs-prod-XX.grafana.net/loki/api/v1/push`
   - User: a number like `123456`
   - Generate a token (Loki write scope) — copy it (`glc_…`).
3. On EC2, edit `/opt/shortly/.env`:
   ```
   GRAFANA_LOKI_URL=https://logs-prod-XX.grafana.net/loki/api/v1/push
   GRAFANA_LOKI_USER=123456
   GRAFANA_LOKI_TOKEN=glc_paste-the-token
   ```
4. Uncomment the `promtail` service in `/opt/shortly/docker-compose.yml`:
   ```bash
   sed -i 's/^#//' /opt/shortly/docker-compose.yml   # only run if you ONLY commented promtail
   ```
   (or just `nano` and remove the `#`s manually).
5. `docker compose up -d promtail`
6. In Grafana Cloud → **Explore** → datasource: your stack's Loki →
   query `{env="production"}`. Live logs from your EC2 should stream in.

---

## Day-2 stuff

**Roll back a bad deploy** — every image is tagged with the git SHA. On EC2:

```bash
cd /opt/shortly
sed -i 's|:latest|:abc1234|g' docker-compose.yml   # use prev good sha
docker compose pull
docker compose up -d
```

When you deploy a fix, change the tag back to `:latest`.

**Live logs** (only the backend you control):

```bash
docker compose logs -f backend
```

For Vercel logs: vercel.com → your project → **Logs** tab.
For Supabase logs: supabase.com → your project → **Logs** tab.

**Restart a single service**:

```bash
docker compose restart backend
```

**EC2 ran out of disk** (Docker images pile up):

```bash
docker system prune -af --volumes
```

**Free-tier RAM tight?** `htop` to see usage. The backend is 90 % of it.
Tune `JAVA_OPTS` in `.env`: drop to `-Xmx350m` if needed. If still OOM,
upgrade to t3.small (~$15/mo).
