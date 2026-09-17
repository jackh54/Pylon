import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { openTcp, resolveSrv, assertPublicHost } from "../lib/net";
import { mcPacket, writeVarInt, encodeString, u16be, i64be } from "../lib/bytes";
import { withTimeout } from "../lib/time";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(25565),
  /** protocol version sent in the handshake; -1 lets the server pick */
  protocolVersion: z.coerce.number().int().default(-1),
  minPlayers: z.coerce.number().int().min(0).optional(),
});
export type MinecraftJavaConfig = z.infer<typeof schema>;

type ChatComponent = string | { text?: string; extra?: ChatComponent[]; translate?: string };

export function flattenChat(c: ChatComponent | undefined): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  let s = c.text ?? c.translate ?? "";
  if (Array.isArray(c.extra)) s += c.extra.map(flattenChat).join("");
  return s;
}

export function stripColorCodes(s: string): string {
  return s.replace(/§[0-9a-fk-orx]/gi, "").replace(/\s+/g, " ").trim();
}

interface SlpResponse {
  version?: { name?: string; protocol?: number };
  players?: { max?: number; online?: number; sample?: { name: string; id: string }[] };
  description?: ChatComponent;
  favicon?: string;
  enforcesSecureChat?: boolean;
}

/** Minecraft Java Edition Server List Ping over raw TCP. */
export async function serverListPing(host: string, port: number, timeoutMs: number, protocolVersion = -1) {
  const s = await openTcp(host, port, timeoutMs);
  try {
    const handshake = mcPacket(
      writeVarInt(0x00),
      writeVarInt(protocolVersion),
      encodeString(host),
      u16be(port),
      writeVarInt(1),
    );
    const statusRequest = mcPacket(writeVarInt(0x00));
    await s.writer.write(handshake);
    await s.writer.write(statusRequest);

    const response = await withTimeout((async () => {
      await s.reader.readVarInt(); // packet length
      const packetId = await s.reader.readVarInt();
      if (packetId !== 0x00) throw new Error(`Unexpected packet id 0x${packetId.toString(16)}`);
      const len = await s.reader.readVarInt();
      if (len > 1_000_000) throw new Error("Status response too large");
      const bytes = await s.reader.readBytes(len);
      return JSON.parse(new TextDecoder().decode(bytes)) as SlpResponse;
    })(), timeoutMs, s.close);

    // Ping/pong for a real RTT measurement (some proxies skip it; ignore failures)
    let latencyMs: number | undefined;
    try {
      const start = Date.now();
      await s.writer.write(mcPacket(writeVarInt(0x01), i64be(BigInt(start))));
      await withTimeout((async () => {
        await s.reader.readVarInt();
        const id = await s.reader.readVarInt();
        if (id === 0x01) await s.reader.readInt64BE();
      })(), Math.min(timeoutMs, 3000));
      latencyMs = Date.now() - start;
    } catch { /* fall back to connect-time latency below */ }

    return { response, latencyMs };
  } finally {
    s.close();
  }
}

export const minecraftJavaProbe: ProbeDefinition<MinecraftJavaConfig> = {
  id: "minecraft-java",
  name: "Minecraft: Java Edition",
  description: "Server List Ping over TCP. Player counts, version, MOTD and real ping. SRV records are resolved automatically.",
  category: "game",
  badge: "Minecraft",
  icon: "Pickaxe",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 25565, protocolVersion: -1 },
  fields: [
    { key: "host", label: "Server address", type: "text", placeholder: "play.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: "25565", half: true },
    { key: "minPlayers", label: "Alert if players below", type: "number", placeholder: "optional", half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "version", label: "Version" },
    { key: "motd", label: "MOTD" },
  ],
  address: (c) => c.port === 25565 ? c.host : `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(config.host);
      let host = config.host;
      let port = config.port;
      if (port === 25565) {
        const srv = await resolveSrv("_minecraft._tcp", host, ctx.signal);
        if (srv) { host = srv.target; port = srv.port; }
      }
      const { response, latencyMs: pingMs } = await serverListPing(host, port, ctx.timeoutMs, config.protocolVersion);
      const latencyMs = pingMs ?? Date.now() - started;
      const players = response.players?.online ?? 0;
      const maxPlayers = response.players?.max ?? 0;
      const version = stripColorCodes(response.version?.name ?? "unknown");
      const data = {
        players,
        maxPlayers,
        version,
        protocol: response.version?.protocol,
        motd: stripColorCodes(flattenChat(response.description)).slice(0, 200),
        sample: response.players?.sample?.map((p) => p.name).slice(0, 20) ?? [],
      };
      if (config.minPlayers !== undefined && players < config.minPlayers) {
        return fail(`Only ${players} players online (minimum ${config.minPlayers})`, { latencyMs, data });
      }
      return { ok: true, latencyMs, message: `${players}/${maxPlayers} players · ${version}`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
