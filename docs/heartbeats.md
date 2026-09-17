# Heartbeats & push metrics

A **Heartbeat** monitor is the universal integration: anything that can make an HTTP request can be monitored, and it can attach live metrics that appear on your status page.

Create a monitor of type *Heartbeat (push)*, set the expected interval and grace period, and copy the push URL from the monitor page:

```
https://<your-pylon>/api/push/<token>
```

## Ping

```bash
curl -fsS "https://<your-pylon>/api/push/<token>?status=up"
```

Parameters (query string or JSON body):

| Field | Meaning |
|---|---|
| `status` | `up` (default) or `down` |
| `msg` | Short message shown on the page |
| `latency` | Milliseconds, shown as latency |
| anything else | Stored as snapshot data (`players`, `maxPlayers`, `tps`, `map`, …) |

If no ping arrives within *interval + grace*, the monitor goes **down** with the message "No heartbeat".

## Attach metrics

```bash
curl -fsS -X POST "https://<your-pylon>/api/push/<token>" \
  -H 'content-type: application/json' \
  -d '{"players": 42, "maxPlayers": 100, "tps": 19.9, "map": "world"}'
```

`players` / `maxPlayers` render as a player pill, `tps` and other keys can be shown via the component's *extra fields*.

## Examples

**Paper / Spigot plugin (Java)**

```java
JsonObject body = new JsonObject();
body.addProperty("players", Bukkit.getOnlinePlayers().size());
body.addProperty("maxPlayers", Bukkit.getMaxPlayers());
body.addProperty("tps", Math.min(20.0, Bukkit.getTPS()[0]));
HttpRequest req = HttpRequest.newBuilder(URI.create(PUSH_URL))
    .header("content-type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
HttpClient.newHttpClient().sendAsync(req, HttpResponse.BodyHandlers.discarding());
```

Schedule it every 30–60 seconds with `Bukkit.getScheduler().runTaskTimerAsynchronously`.

**systemd timer for a backup job**

```ini
# /etc/systemd/system/backup.service
[Service]
ExecStart=/usr/local/bin/backup.sh
ExecStartPost=/usr/bin/curl -fsS "https://<your-pylon>/api/push/<token>?status=up"
```

**Discord bot (Node)**

```js
setInterval(() => fetch(PUSH_URL, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ guilds: client.guilds.cache.size, ping: client.ws.ping }) }), 60_000);
```

**Report a failure explicitly**

```bash
curl -fsS "https://<your-pylon>/api/push/<token>?status=down&msg=World+save+failed"
```

Push responses are JSON: `{"ok":true,"status":"up"}`. CORS is enabled so browsers and in-game web views can ping too.
