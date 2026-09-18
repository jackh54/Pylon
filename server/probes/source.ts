import { z } from "zod";
import { fail, skip, errorMessage, type ProbeDefinition } from "./types";
import { resolveIpv4 } from "../lib/net";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(27015),
});
export type SourceConfig = z.infer<typeof schema>;

interface SteamServer {
  addr: string; name?: string; map?: string; players?: number; max_players?: number; bots?: number;
  version?: string; product?: string; gametype?: string; secure?: boolean; appid?: number;
}

/**
 * Source / Steam A2S servers (CS2, Rust, ARK, Valheim, Palworld, GMod, TF2, Squad, DayZ…).
 * A2S is UDP, so on the edge we use the Steam Web API's server list (needs a free Steam API key).
 * A relay performs the real A2S_INFO query.
 */
export const sourceProbe: ProbeDefinition<SourceConfig> = {
  id: "source",
  name: "Steam / Source (A2S)",
  description: "CS2, Rust, ARK, Valheim, Palworld, GMod, TF2, DayZ, Squad and any Steam-listed server. Edge checks use the Steam Web API; relays query A2S directly.",
  category: "game",
  badge: "Steam",
  icon: "Crosshair",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 27015 },
  fields: [
    { key: "host", label: "Host / IP", type: "text", placeholder: "203.0.113.10", required: true },
    { key: "port", label: "Query port", type: "number", placeholder: "27015", half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "map", label: "Map" },
    { key: "name", label: "Server name" },
    { key: "product", label: "Game" },
  ],
  docs: "Edge checks require `STEAM_API_KEY` (free at steamcommunity.com/dev/apikey) and the server must be public on Steam's master list. Otherwise run it on a relay, which speaks A2S over UDP directly.",
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      if (!ctx.secrets.STEAM_API_KEY) return fail("STEAM_API_KEY is not configured on this Pylon. Add it or run this monitor on a relay.");
      const ip = await resolveIpv4(config.host, ctx.signal);
      const url = `https://api.steampowered.com/IGameServersService/GetServerList/v1/?key=${encodeURIComponent(ctx.secrets.STEAM_API_KEY)}&limit=1&filter=${encodeURIComponent(`\\addr\\${ip}:${config.port}`)}`;
      const res = await fetch(url, { signal: ctx.signal, headers: { accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) return skip(`Steam Web API unavailable (HTTP ${res.status})`);
      if (!res.ok) return fail(`Steam Web API responded HTTP ${res.status}`);
      const json = (await res.json()) as { response?: { servers?: SteamServer[] } };
      const latencyMs = Date.now() - started;
      const server = json.response?.servers?.[0];
      if (!server) return fail("Server not found on Steam master list (offline, not public, or wrong query port)", { latencyMs });
      const data = {
        players: server.players ?? 0,
        maxPlayers: server.max_players ?? 0,
        bots: server.bots ?? 0,
        map: server.map,
        name: server.name,
        product: server.product,
        version: server.version,
        secure: server.secure,
        via: "steam-web-api",
      };
      return { ok: true, latencyMs, message: `${data.players}/${data.maxPlayers} players${data.map ? ` · ${data.map}` : ""}`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
