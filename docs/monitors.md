# Monitor types

Every check produces a **result**: `ok`, `latencyMs`, a human `message`, and a structured `data` snapshot. Well-known snapshot keys (`players`, `maxPlayers`, `version`, `map`, `name`, `motd`) render automatically on status pages; any other key can be shown with the component's *extra fields* setting.

## Where checks run

- **Edge** — Cloudflare's network, no setup. Outbound TCP and HTTP(S) only (no UDP, no ICMP, no private IPs).
- **Relay** — a Node process you host. Adds UDP, LAN hosts, and 300+ GameDig games. See [Relay](/docs/relay).
- **Push** — nothing is probed; your system calls a URL. See [Heartbeats](/docs/heartbeats).

## Minecraft: Java Edition

Implements the Server List Ping handshake + status + ping packets over raw TCP. Resolves `_minecraft._tcp` SRV records when the port is the default 25565. Snapshot: `players`, `maxPlayers`, `version`, `protocol`, `motd`, `sample` (up to 20 names).

Option **Alert if players below** turns a low population into a failure (useful for lobby servers that should never be empty).

## Minecraft: Bedrock Edition

Bedrock speaks RakNet over UDP. From the edge Pylon asks [mcstatus.io](https://mcstatus.io) to do the UDP hop; on a relay it queries the server directly. Snapshot: `players`, `maxPlayers`, `version`, `motd`, `gamemode`.

## Steam / Source (A2S)

Covers every game using Valve's A2S protocol: CS2, Rust, ARK, Valheim, Palworld, Garry's Mod, TF2, L4D2, 7 Days to Die, DayZ, Squad, Project Zomboid, Unturned, Arma, Conan Exiles, and more.

- **Edge**: uses the Steam Web API server list. Requires `STEAM_API_KEY` (free) and a server that is public on Steam's master list. Snapshot: `players`, `maxPlayers`, `bots`, `map`, `name`, `product`, `version`, `secure`.
- **Relay**: real `A2S_INFO` query over UDP. Works for private/unlisted servers.

## FiveM / RedM

Reads `dynamic.json` and `info.json` from the server's HTTP port (30120 by default). Snapshot: `players`, `maxPlayers`, `name`, `map`, `gametype`.

## Rust (WebRCON)

Opens a WebSocket to Rust's WebRCON and runs `serverinfo`. Snapshot: `players`, `maxPlayers`, `queued`, `joining`, `fps`, `entities`, `memoryMb`, `uptimeSec`, `map`, `name`. Rust also works via A2S.

## RCON

Source RCON authentication (Minecraft, CS2, ARK, 7DTD, Valheim mods…). Optionally run a command and require its output to contain a string — e.g. `list` must contain `players online`. Snapshot: `response`.

## Pterodactyl / Pelican

Uses a **client** API key (`ptlc_…`) and the server's short identifier. Fails unless the container state is `running`. Snapshot: `state`, `cpu`, `memoryMb`, `diskMb`, `uptimeSec`. Works for every egg the panel hosts.

## Any game (GameDig)

Relay-only. Pick a GameDig type id (Rust, Valheim, Palworld, ARK, Satisfactory, Enshrouded, TeamSpeak, SA-MP, BeamMP, …) — [full list](https://github.com/gamedig/node-gamedig#games-list). Snapshot: `players`, `maxPlayers`, `map`, `name`, plus anything GameDig returns.

## Discord

- **Widget**: `presence_count` of a guild with *Server Widget* enabled. Snapshot: `online`, `name`, `invite`.
- **Bot**: verifies a bot token against `/users/@me`.

## HTTP / Website

Asserts status (`2xx`, `200,204`, `200-299`), body keyword present/absent, and a JSON path value (`data.status` == `ok`). Custom headers and POST bodies supported.

## TCP port

Plain connect. Ideal for Terraria, Starbound, Factorio, custom servers.

## DNS

Resolves via 1.1.1.1 DoH. Catches expired domains and broken SRV records before players do.

## Status logic

- A check that fails increments a counter; the monitor flips to **down** after *Failures before down* consecutive failures.
- A successful check with latency above *Degraded above* marks it **degraded**.
- Transitions write an event, open/resolve automatic incidents on every status page showing the monitor, notify channels, and push a live update to open browsers.
- Raw checks are kept for 30 days inside the monitor's Durable Object; daily rollups (uptime %, latency, peak players, downtime) are kept for 400 days.
