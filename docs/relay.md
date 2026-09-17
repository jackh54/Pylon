# Relay

The edge can only open TCP and HTTP connections. A **relay** is a small Node.js service you run anywhere (a VPS, the game server box itself, a Raspberry Pi) that executes checks the edge can't:

- UDP protocols: Steam A2S, Minecraft Bedrock RakNet, GameSpy, Quake…
- 300+ games through [GameDig](https://github.com/gamedig/node-gamedig)
- Private/LAN hosts and servers behind NAT
- Extra vantage points ("EU relay", "US relay")

Relays **pull** their assignments and **push** results, so they need no inbound ports.

## Install

1. In the dashboard open **Relays → New relay** and copy the token (shown once).
2. Run the relay with Docker (amd64 and arm64 images):

```bash
docker run -d --name pylon-relay --restart=always \
  -e PYLON_URL=https://<your-pylon> -e PYLON_TOKEN=prl_… \
  ghcr.io/jackh54/pylon-relay:latest
```

or from source with Node 20+:

```bash
git clone https://github.com/jackh54/Pylon && cd Pylon/relay
npm ci
PYLON_URL=https://<your-pylon> PYLON_TOKEN=prl_… node index.js
```

For a long-running install without Docker, wrap that command in a systemd service or pm2.

3. Create monitors and choose the relay under **Runs on**. Relay-only types (GameDig) require one.

## How it works

- Every 60 s the relay fetches `GET /api/relay/config` (Bearer token) and reconciles a local scheduler.
- Each monitor runs at its own interval; results are batched to `POST /api/relay/results`.
- Pylon treats relay monitors like heartbeats: if results stop arriving (relay offline), the monitors go down with "No heartbeat".
- The **Relays** page shows last-seen time and version.

## Supported types on a relay

| Type | Implementation |
|---|---|
| gamedig | `GameDig.query({ type, host, port })` |
| minecraft-java | GameDig `minecraft` |
| minecraft-bedrock | GameDig `minecraftbedrock` (direct UDP) |
| source | GameDig `protocol-valve` (direct A2S) |
| fivem | GameDig `fivem` |
| http | `fetch` with the same assertions as the edge |
| tcp | `net.connect` |
| dns | `dns.promises.resolve` |

RCON, Rust WebRCON, Pterodactyl and Discord checks are edge-only today; use a heartbeat if you need them behind NAT.
