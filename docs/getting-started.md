# Getting started

Pylon is a status page and uptime monitor built for game servers. Add a monitor, drop it on a status page, and share the link — your players get live player counts, versions, uptime history and incident updates.

**Hosted or self-hosted?** The quickest path is an account on the hosted service: free plan, no infrastructure. The code is open source (AGPL-3.0), so you can also [run your own instance](/docs/self-hosting) on a Cloudflare account for free, with no plan limits.

## 1. Create an account

Sign up at `/register`. The first account creates a **team** (organization) that holds monitors, status pages, notification channels and API keys. Invite teammates from **Settings**.

## 2. Add a monitor

Go to **Monitors → Add monitor** and pick a type:

| Type | What it does | Runs on |
|---|---|---|
| Minecraft: Java | Server List Ping over TCP – players, version, MOTD, real ping. SRV records resolved. | Edge, relay |
| Minecraft: Bedrock | RakNet ping (via mcstatus.io from the edge, direct UDP on a relay) | Edge, relay |
| Steam / Source (A2S) | CS2, Rust, ARK, Valheim, Palworld, GMod, TF2, DayZ, Squad… | Edge (Steam Web API key), relay |
| FiveM / RedM | Cfx.re HTTP endpoints – players, hostname, map | Edge, relay |
| Rust (WebRCON) | Players, queue, FPS, entities, memory | Edge, relay |
| RCON | Auth + optional command with output assertion | Edge, relay |
| Pterodactyl / Pelican | Container state, CPU, memory, disk from the panel API | Edge, relay |
| Any game (GameDig) | 300+ games including UDP protocols | Relay |
| Discord | Guild online count via widget, or bot token check | Edge, relay |
| HTTP / Website | Status code, keyword, JSON path assertions | Edge, relay |
| TCP port | Plain connect check for anything TCP | Edge, relay |
| DNS | Resolve a record and assert its value | Edge, relay |
| Heartbeat (push) | Your server pings Pylon, optionally with metrics | Push |

Use **Run a test check** before saving. Interval, timeout, retries and a "degraded above N ms" threshold are per monitor.

## 3. Build a status page

**Status pages → New page**, then add sections (e.g. *Game servers*, *Web*) and components linked to monitors. The **Hero** tab adds a connect address with a copy button and a live player total. **Branding** controls colors, dark/light mode, logo and custom CSS.

Your page is live at `/s/<slug>` and can be served from a custom domain.

## 4. Get alerted

Add a Discord webhook (or Slack, Telegram, email, generic webhook) under **Notifications**. Mark it *default* to alert for every monitor, or pick channels per monitor.

## 5. Optional: run a relay

Relays are tiny self-hosted probe runners that unlock UDP protocols (A2S, Bedrock, GameDig) and LAN hosts. See [Relay](/docs/relay).
