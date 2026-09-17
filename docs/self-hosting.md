# Self-hosting

Pylon runs entirely on Cloudflare: **Workers** (app + probes), **D1** (SQLite database), **Durable Objects** (one scheduler per monitor + WebSocket hubs), **R2** (logo uploads) and **Cron Triggers**. A typical community fits in the free tier.

## Prerequisites

- Node.js 22+ and pnpm
- A Cloudflare account (`npx wrangler login`)

## Choose a plan

Pylon runs on either Cloudflare Workers plan with the same code. Pick the column that matches your account:

| | Workers Free ($0) | Workers Paid ($5 / month) |
|---|---|---|
| Monitors at 60 s intervals (D1 write budget) | ~60 | ~1,000 |
| Alert delivery | inline, one attempt | Cloudflare Queue, 5 retries with backoff |
| Password hashing | PBKDF2 600k iterations | PBKDF2 600k iterations |
| CPU per request | 10 ms | 30 s (probe timeouts are wall-clock, so both work) |
| Worker size limit | 3 MB gzipped (Pylon is ~1 MB) | 10 MB |
| Durable Objects, R2, cron, WebSockets | included | included |
| Everything else | identical | identical |

## Deploy

### Option A — guided (recommended)

```bash
git clone https://github.com/jackh54/Pylon && cd Pylon
pnpm install
npx wrangler login
pnpm setup
```

`pnpm setup` asks **paid or free**, then creates the D1 database, the R2 bucket and (Paid) the alert queue, writes the ids into `wrangler.jsonc`, applies migrations, builds, deploys and sets `SESSION_SECRET`. Non-interactive:

```bash
pnpm setup --plan paid --url https://status.example.gg --yes
pnpm setup --plan free --url https://status.example.gg --yes
pnpm setup --dry-run        # show what would happen
```

### Option B — manual, Workers Paid

```bash
npx wrangler d1 create pylon            # paste the id into wrangler.jsonc → d1_databases[0].database_id
npx wrangler r2 bucket create pylon-uploads
npx wrangler queues create pylon-notify
pnpm db:migrate                         # applies drizzle/*.sql to the remote D1
# set "APP_URL" in wrangler.jsonc to your public URL
pnpm deploy
npx wrangler secret put SESSION_SECRET  # openssl rand -hex 32
```

### Option C — manual, Workers Free

Same as above, minus the queue, plus two edits in `wrangler.jsonc`:

1. Delete the block between `// BEGIN paid-only` and `// END paid-only` (the `queues` section). Alerts are then sent inline.
2. Set `"PBKDF2_ITERATIONS": "100000"` — the Free plan rejects higher iteration counts.

```bash
npx wrangler d1 create pylon
npx wrangler r2 bucket create pylon-uploads
pnpm db:migrate
pnpm deploy
npx wrangler secret put SESSION_SECRET
```

### Instance settings

| Var (`wrangler.jsonc` → `vars`) | Meaning |
|---|---|
| `INSTANCE_MODE` | `self-hosted` (written by `pnpm setup`): no plan limits, no pricing page, `/` goes straight to sign-in. `hosted`: plan limits, pricing, admin page. |
| `ADMIN_EMAILS` | Comma-separated emails that can open `/app/admin` to see every team and change plans. |
| `DEFAULT_PLAN` | Hosted only: `free` or `pro` for newly created teams. |
| `BILLING_URL` | Hosted only: where "Upgrade" buttons link once you sell Pro. |
| `ALLOW_SIGNUP` | `false` makes the instance invite-only. |
| `CUSTOM_DOMAIN_TARGET`, `CUSTOM_DOMAIN_IPS` | Hostname and IPs customers point their DNS at when you run the [edge proxy](https://github.com/jackh54/Pylon/tree/main/deploy/edge). Empty = Worker Custom Domains. |
| `EDGE_SECRET` (secret) | Shared secret between the edge proxy and the Worker. |

### After the first deploy

- Open the URL Wrangler printed, register the first account (it becomes the owner of the first team).
- Put that URL into `APP_URL` if you left it empty, and redeploy.
- Optional secrets: `STEAM_API_KEY` (edge A2S checks), `RESEND_API_KEY` + `EMAIL_FROM` (email alerts and subscriber emails), `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET` (Discord login).
- Make the instance invite-only by setting `ALLOW_SIGNUP` to `"false"`.

### Switching plans later

Upgraded to Paid? `pnpm setup --plan paid` adds the queue and raises the hashing cost (existing passwords keep working; they are re-hashed on next change). Downgrading: `pnpm setup --plan free`. Redeploy afterwards.

## Local development

```bash
cp .dev.vars.example .dev.vars        # set SESSION_SECRET
pnpm db:migrate:local
pnpm dev                              # http://localhost:5173 – runs inside workerd with local D1/DO/R2
```

Trigger the cron locally: `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.

## Architecture

```
Browser ──HTTP/WS──▶ Worker (React Router SSR + API)
                        │  ├─ D1: users, orgs, monitors, pages, incidents, daily_stats
                        │  ├─ R2: uploads
                        │  └─ Cache API: public pages (30 s)
                        ├─ Durable Object "MonitorRunner" ×N (alarm every interval, SQLite history)
                        │      └─ runs probe on the edge, or waits for push/relay results
                        └─ Durable Object "LiveHub" ×pages (hibernating WebSockets)
Relay (Node) ──pull config / push results──▶ Worker
```

## Plans, limits & costs

**Workers Paid (recommended, $5/month):** 50M D1 writes/month included (~1,000 monitors at 60 s), Queues for retried alert delivery, 10 MB scripts, 30 s CPU per request, higher PBKDF2 cost (`PBKDF2_ITERATIONS` defaults to 600000 in `wrangler.jsonc`). This is the configuration the repository ships with.

**Workers Free:** works too. Remove the `queues` block from `wrangler.jsonc` (alerts are sent inline) and stay under 100k D1 writes/day (~60 monitors at 60 s). Password hashing is the same on both plans: Workers limits a single PBKDF2 call to 100000 iterations, so Pylon chains blocks to reach `PBKDF2_ITERATIONS`.

- Each check writes one snapshot row; a daily rollup is flushed every 5 minutes.
- Durable Objects are SQLite-backed; raw history is retained 30 days per monitor.
- The edge cannot send UDP or reach private IPs — use a relay.
- Custom hostnames for many tenants: Cloudflare for SaaS (100 hostnames free, then per-hostname pricing).

## Custom domains for status pages

Three options, from simplest to most flexible: Worker **Custom Domains** for hostnames on your own Cloudflare account, the free **edge proxy** in `deploy/edge` (Caddy on any VPS, for customer-owned domains), or **Cloudflare for SaaS** (100 hostnames included). See [Status pages](/docs/status-pages) for details.

## Updating

```bash
git pull && pnpm install && pnpm db:migrate && pnpm deploy
```
