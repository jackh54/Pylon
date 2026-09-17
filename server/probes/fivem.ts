import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { assertPublicHost } from "../lib/net";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(30120),
  https: z.coerce.boolean().default(false),
});
export type FivemConfig = z.infer<typeof schema>;

interface DynamicJson { clients?: number; sv_maxclients?: number; hostname?: string; mapname?: string; gametype?: string; iv?: string }
interface InfoJson { vars?: Record<string, string>; version?: number; server?: string }

/** FiveM / RedM (Cfx.re) servers expose plain HTTP endpoints on the game port. */
export const fivemProbe: ProbeDefinition<FivemConfig> = {
  id: "fivem",
  name: "FiveM / RedM",
  description: "Cfx.re servers via their built-in HTTP endpoints: player count, hostname, map and gametype.",
  category: "game",
  badge: "Cfx.re",
  icon: "Car",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 30120, https: false },
  fields: [
    { key: "host", label: "Host", type: "text", placeholder: "fivem.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: "30120", half: true },
    { key: "https", label: "Use HTTPS", type: "boolean", half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "name", label: "Hostname" },
    { key: "map", label: "Map" },
    { key: "gametype", label: "Gametype" },
  ],
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(config.host);
      const base = `${config.https ? "https" : "http"}://${config.host}:${config.port}`;
      const res = await fetch(`${base}/dynamic.json`, { signal: ctx.signal, headers: { "user-agent": "Pylon-Monitor/1.0" } });
      if (!res.ok) return fail(`dynamic.json responded HTTP ${res.status}`);
      const dyn = (await res.json()) as DynamicJson;
      const latencyMs = Date.now() - started;
      let projectName: string | undefined;
      try {
        const info = await fetch(`${base}/info.json`, { signal: ctx.signal, headers: { "user-agent": "Pylon-Monitor/1.0" } });
        if (info.ok) projectName = ((await info.json()) as InfoJson).vars?.sv_projectName;
      } catch { /* optional */ }
      const data = {
        players: dyn.clients ?? 0,
        maxPlayers: dyn.sv_maxclients ?? 0,
        name: (projectName ?? dyn.hostname ?? "").replace(/\^\d/g, "").slice(0, 120),
        map: dyn.mapname,
        gametype: dyn.gametype,
      };
      return { ok: true, latencyMs, message: `${data.players}/${data.maxPlayers} players`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
