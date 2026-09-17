<p align="center">
  <img src="public/favicon.svg" width="72" alt="Pylon" />
</p>
<h1 align="center">Pylon</h1>
<p align="center"><b>Status pages and uptime monitoring built for game servers.</b><br/>
Minecraft · Steam/Source · FiveM · Rust · Pterodactyl · Discord · RCON · HTTP · and anything else via relays and heartbeats.<br/>
<i>Use the hosted service, or self-host the open-source code for free.</i></p>

<p align="center">
  <a href="https://github.com/jackh54/Pylon/actions/workflows/ci.yml"><img src="https://github.com/jackh54/Pylon/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> · <a href="#features">Features</a> · <a href="#architecture">Architecture</a> · <a href="docs/self-hosting.md">Self-hosting</a> · <a href="docs/api.md">API &amp; MCP</a>
</p>

> **Codename.** "Pylon" is a working name — change it in one place: [`app/lib/brand.ts`](app/lib/brand.ts).

## Hosted or self-hosted

- **Hosted** — sign up, add a monitor, share the link. Free plan for small communities; a Pro plan (custom domains, white-label pages, higher limits) is coming. Plan limits live in [`server/plans.ts`](server/plans.ts) and are enforced in the app; an operator admin page at `/app/admin` manages teams and plans.
- **Self-hosted** — the same code, AGPL-3.0, on your own Cloudflare account. `pnpm setup` provisions everything and switches the instance into self-hosted mode: no plan limits, no pricing page, no branding requirements.

## Why

BetterStack, Statuspage and friends monitor HTTP. Game communities need to know **how many players are online, which version the server runs, whether TPS is dropping, and where to connect** — and they want a page that looks like *their* brand, on *their* domain, without paying per seat.

Pylon is that page. It runs on Cloudflare's free tier, renders at the edge in a few milliseconds, and speaks the protocols game servers actually use.

## Features

- **Game-native probes** — Minecraft Java (Server List Ping over TCP, SRV aware), Minecraft Bedrock, Steam A2S (CS2, Rust, ARK, Valheim, Palworld, GMod, TF2, DayZ…), FiveM/RedM, Rust WebRCON (players, queue, FPS, entities), Source RCON with command assertions, Pterodactyl/Pelican panel resources, Discord widget/bot, HTTP with keyword/JSON assertions, TCP, DNS.
- **No-limit integrations** — *Relays* (a 200-line Node service) add UDP protocols, LAN hosts and 300+ GameDig games. *Heartbeats* let plugins, cron jobs, bots and agents push status **and metrics** (`players`, `tps`, anything) with one HTTP call.
- **Status pages players love** — connect address with copy button, live player totals, per-component chips (players / version / map / latency), 90-day uptime bars with downtime and peak-player tooltips, sections, incidents with Markdown updates, scheduled maintenance, subscribers (email/Discord/webhook) and RSS.
- **Deeply customizable** — accent color, light/dark/system, corner radius, bar/dot history, font, logo upload (R2), banner, links, custom CSS, custom domains, password protection.
- **Live** — hibernating WebSockets per page push every check to open browsers; falls back to polling.
- **Alerts** — Discord (rich embeds), Slack, Telegram, email (Resend), signed webhooks. Default channels + per-monitor routing. Automatic incidents on down/recovery. Delivery goes through a Cloudflare Queue with retries when available.
- **Fast** — SSR on Cloudflare Workers, edge-cached for 30 s with stale-while-revalidate, a few KB of JS, self-hosted font, zero layout shift.
- **SEO** — canonical URLs, Open Graph + Twitter cards with generated OG images, JSON-LD (`WebSite`, `Organization`, `ItemList`, `Event`, `NewsArticle`, `BreadcrumbList`), sitemap, RSS, badges, per-page `noindex`.
- **AI-first** — every page has a Markdown twin (`Accept: text/markdown` or `/status.md`), `/llms.txt` + `/llms-full.txt`, an **MCP endpoint** (`/mcp`, Streamable HTTP) with `get_status` / `list_incidents` / `list_status_pages`, an OpenAPI 3.1 spec, and a `robots.txt` with explicit AI-crawler rules and `Content-Signal` — configurable per page (allow / search-only / disallow).
- **Multi-tenant SaaS-ready** — teams with roles (owner/admin/member/viewer), invites, API keys, Discord OAuth, invite-only mode.

## Quick start

```bash
pnpm install
cp .dev.vars.example .dev.vars          # set SESSION_SECRET (openssl rand -hex 32)
pnpm db:migrate:local
pnpm dev                                # http://localhost:5173
```

Register, click **Create demo setup** on the overview, and open the generated status page. It monitors real public Minecraft networks so you'll see live player counts within a minute.

Deploying to your own Cloudflare account is one command that asks whether you are on Workers **Paid** or **Free** and provisions accordingly:

```bash
npx wrangler login
pnpm setup            # or: pnpm setup --plan free --url https://status.example.gg --yes
```

Details and the manual steps for both plans: [docs/self-hosting.md](docs/self-hosting.md).

## Architecture

```
                 ┌──────────────────────── Cloudflare Worker ────────────────────────┐
 Browser ─HTTP──▶│ React Router v8 SSR  ·  API routes  ·  MCP  ·  llms.txt  ·  feeds │
 Agent  ─MCP───▶│        │                                                          │
                 │   D1 (SQLite) ── users · orgs · monitors · pages · incidents ·    │
                 │        │           daily_stats (uptime rollups)                  │
                 │   R2 ── uploads        Cache API ── public pages (30 s)           │
                 │                                                                   │
                 │   Durable Object  MonitorRunner ×N   (alarm every N s,            │
                 │      ├─ runs probe on the edge   OR   waits for push/relay        │
                 │      ├─ SQLite: raw checks (30 d)                                 │
                 │      └─ on change → events · auto-incidents · notify · broadcast  │
                 │   Durable Object  LiveHub ×pages    (hibernating WebSockets)      │
                 └───────────────────────────────────────────────────────────────────┘
 Relay (Node, anywhere) ── GET /api/relay/config · POST /api/relay/results
 Anything            ── GET|POST /api/push/<token>?status=up  {players, tps…}
```

- **`server/probes/`** — the probe registry. Each probe declares a zod schema, UI fields, where it can run and a `run()` implementation. Adding a game is one file.
- **`server/do/monitor-runner.ts`** — scheduling and state machine. One Durable Object per monitor keeps D1 writes tiny and scales linearly.
- **`app/routes/`** — React Router v8 routes: marketing, docs, auth, dashboard (`/app`), public status pages (`/s/:slug`), SEO/AI endpoints and the API.
- **`relay/`** — the relay runner (GameDig).

## Project layout

```
app/            React Router app (routes, components, styles)
server/         Server-only code: db schema, probes, Durable Objects, auth, notifications, services
workers/app.ts  Worker entry: custom domains, WebSocket upgrades, edge cache, cron, DO exports
drizzle/        D1 migrations (drizzle-kit)
docs/           Markdown docs, rendered at /docs and bundled into llms-full.txt
relay/          pylon-relay package
deploy/edge/    optional Caddy edge proxy for customer custom domains (on-demand TLS on any VPS)
```

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Dev server inside workerd with local D1/DO/R2 |
| `pnpm build` / `pnpm deploy` | Build and deploy with Wrangler |
| `pnpm typecheck` | `wrangler types` + `react-router typegen` + `tsc` |
| `pnpm db:generate` | Generate a migration from `server/db/schema.ts` |
| `pnpm db:migrate:local` / `pnpm db:migrate` | Apply migrations |

## Configuration

| Name | Where | Purpose |
|---|---|---|
| `APP_URL` | `wrangler.jsonc` vars | Public URL (absolute links, OG images, custom-domain detection) |
| `ALLOW_SIGNUP` | `wrangler.jsonc` vars | `"false"` makes the instance invite-only |
| `PBKDF2_ITERATIONS` | `wrangler.jsonc` vars | Password hashing cost; 600000 by default, derived in 100000-iteration blocks because Workers caps a single call |
| `NOTIFY_QUEUE` | `wrangler.jsonc` queues | Optional. Queue-backed alert delivery with retries (Workers Paid) |
| `INSTANCE_MODE` | `wrangler.jsonc` vars | `hosted` (plan limits, pricing, admin) or `self-hosted` (no limits) |
| `DEFAULT_PLAN`, `BILLING_URL`, `ADMIN_EMAILS` | `wrangler.jsonc` vars | Hosted-mode plan defaults, upgrade link, operator emails |
| `AUTH_LIMITER`, `PUSH_LIMITER`, `PUBLIC_LIMITER` | `wrangler.jsonc` ratelimits | Optional abuse protection for sign-in, pushes and public forms |
| `CUSTOM_DOMAIN_TARGET`, `CUSTOM_DOMAIN_IPS`, `EDGE_SECRET` | vars / secret | Custom domains through the [edge proxy](deploy/edge/README.md) |
| `SESSION_SECRET` | secret | Cookie/HMAC secret |
| `DISCORD_CLIENT_ID/SECRET` | secret | Discord login |
| `STEAM_API_KEY` | secret | Edge A2S checks via Steam Web API |
| `RESEND_API_KEY`, `EMAIL_FROM` | secret | Email alerts and subscriber emails |

## Roadmap

- Multi-region edge checks with per-region latency (Durable Object location hints)
- Player-count charts on public pages, per-component incident timelines
- Stripe billing for the hosted service (plans and limits are already enforced; `BILLING_URL` and the admin page bridge the gap)
- Native Go agent for host metrics (CPU/RAM/disk) using the push API
- Prometheus scrape endpoint

## License

AGPL-3.0. Run it, fork it, sell hosting for it — just publish your changes.
