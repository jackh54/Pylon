# pylon-relay

Self-hosted probe runner for [Pylon](https://github.com/jackh54/Pylon). Adds UDP game protocols (Steam A2S, Minecraft Bedrock), 300+ games via GameDig, and LAN hosts.

```bash
docker run -d --restart=always -e PYLON_URL=https://<your-pylon> -e PYLON_TOKEN=prl_... ghcr.io/jackh54/pylon-relay:latest
# or from source
npm ci && PYLON_URL=https://<your-pylon> PYLON_TOKEN=prl_... node index.js
```

Create the token under **Relays** in your Pylon dashboard. See the [relay docs](https://github.com/jackh54/Pylon/blob/main/docs/relay.md).
