# API, feeds & MCP

All public endpoints are CORS-enabled and cached at the edge for 30 seconds. The OpenAPI 3.1 document lives at `/api/openapi.json`.

## Public status

| Endpoint | Description |
|---|---|
| `GET /api/v1/status/{slug}` | JSON snapshot (overall, components, uptime, live data, incidents, maintenance) |
| `GET /s/{slug}/status.json` | Same, page-relative |
| `GET /s/{slug}/status.md` | Markdown twin (also `Accept: text/markdown` on `/s/{slug}`) |
| `GET /s/{slug}/feed.xml` | RSS 2.0 incident feed |
| `GET /s/{slug}/badge.svg` | Shields-style badge. `?players` for the online count |
| `GET /s/{slug}/og.png` | Open Graph image |
| `GET /s/{slug}/embed` | Compact iframe widget |
| `WS /s/{slug}/live` | WebSocket stream of monitor updates |

## Authenticated (API key)

Create keys under **Settings → API keys** and send `Authorization: Bearer pyl_…`.

| Endpoint | Description |
|---|---|
| `GET /api/v1/monitors` | Monitors with status and latest snapshot |
| `GET /api/v1/monitors/{id}/history?hours=24` | Raw checks and time buckets |

## Push & relay

- `GET|POST /api/push/{token}` — heartbeat ([docs](/docs/heartbeats))
- `GET /api/relay/config`, `POST /api/relay/results` — relay protocol ([docs](/docs/relay))

## MCP

`POST /mcp` implements the Model Context Protocol over Streamable HTTP (stateless, protocol `2025-06-18`). Point an MCP-capable agent at it:

```json
{ "mcpServers": { "pylon": { "url": "https://<your-pylon>/mcp" } } }
```

Tools:

- `list_status_pages()` — discover slugs
- `get_status(slug)` — Markdown + structured status
- `list_incidents(slug, limit?, includeResolved?, days?)`

Password-protected pages and pages with the *disallow* AI policy are never exposed.

## llms.txt

`/llms.txt` follows the llmstxt.org convention and links docs, the API and every public status page's Markdown twin. `/llms-full.txt` inlines all of it. Both are scoped to a single page when requested on its custom domain.
