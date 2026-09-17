# Notifications

Channels receive an alert when a monitor changes state (down, degraded, recovered) and when incidents are created.

| Channel | Config | Notes |
|---|---|---|
| Discord | Webhook URL, optional mention (`@here`, `<@&role>`), bot name | Rich embed with players/latency fields |
| Slack | Incoming webhook URL | |
| Telegram | Bot token, chat id | |
| Webhook | URL, optional signing secret | JSON body, `x-pylon-signature: sha256=HMAC(body)` |
| Email | Recipients | Requires `RESEND_API_KEY` |

Mark a channel as **default** to alert for every monitor; otherwise select it on each monitor.

The first successful check after creating a monitor does not alert. Recovery alerts are sent when a monitor returns to *up* or *degraded*.

## Webhook payload

```json
{
  "title": "🔴 Survival is DOWN",
  "event": "monitor.status_changed",
  "monitor": { "id": "mon_…", "name": "Survival", "type": "Minecraft: Java Edition", "address": "play.example.gg", "url": "https://…/app/monitors/mon_…" },
  "from": "up", "to": "down",
  "message": "Connection refused",
  "latencyMs": 1203,
  "data": { "players": 0 },
  "at": 1758056400000,
  "appName": "Pylon"
}
```
