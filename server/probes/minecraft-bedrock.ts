import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(19132),
});
export type MinecraftBedrockConfig = z.infer<typeof schema>;

interface McStatusBedrock {
  online: boolean;
  players?: { online: number; max: number };
  version?: { name?: string; protocol?: number };
  motd?: { clean?: string };
  gamemode?: string;
  edition?: string;
}

/**
 * Bedrock uses RakNet unconnected pings over UDP, which Cloudflare Workers cannot send.
 * On the edge we ask mcstatus.io (public, free) to do the UDP hop; a relay does it directly.
 */
export const minecraftBedrockProbe: ProbeDefinition<MinecraftBedrockConfig> = {
  id: "minecraft-bedrock",
  name: "Minecraft: Bedrock Edition",
  description: "RakNet ping. From the edge it goes through mcstatus.io; a relay queries the server directly over UDP.",
  category: "game",
  badge: "Minecraft",
  icon: "Blocks",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 19132 },
  fields: [
    { key: "host", label: "Server address", type: "text", placeholder: "bedrock.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: "19132", half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "version", label: "Version" },
    { key: "motd", label: "MOTD" },
    { key: "gamemode", label: "Gamemode" },
  ],
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      const res = await fetch(`https://api.mcstatus.io/v2/status/bedrock/${encodeURIComponent(config.host)}:${config.port}`, {
        headers: { accept: "application/json", "user-agent": "Pylon-Monitor/1.0" },
        signal: ctx.signal,
      });
      if (!res.ok) return fail(`mcstatus.io responded HTTP ${res.status}`);
      const json = (await res.json()) as McStatusBedrock;
      const latencyMs = Date.now() - started;
      if (!json.online) return fail("Server is offline (no RakNet response)", { latencyMs });
      const data = {
        players: json.players?.online ?? 0,
        maxPlayers: json.players?.max ?? 0,
        version: json.version?.name ?? "unknown",
        motd: json.motd?.clean?.slice(0, 200) ?? "",
        gamemode: json.gamemode,
        via: "mcstatus.io",
      };
      return { ok: true, latencyMs, message: `${data.players}/${data.maxPlayers} players · ${data.version}`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
