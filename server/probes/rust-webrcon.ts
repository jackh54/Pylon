import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { assertPublicHost } from "../lib/net";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(28016),
  password: z.string().min(1),
});
export type RustWebRconConfig = z.infer<typeof schema>;

interface RustServerInfo {
  Hostname?: string; MaxPlayers?: number; Players?: number; Queued?: number; Joining?: number;
  EntityCount?: number; GameTime?: string; Uptime?: number; Map?: string; Framerate?: number; Memory?: number;
}

/** Rust's WebRCON is a WebSocket; Workers can open outbound WebSockets, so this runs on the edge. */
export const rustWebRconProbe: ProbeDefinition<RustWebRconConfig> = {
  id: "rust-webrcon",
  name: "Rust (WebRCON)",
  description: "Deep Rust metrics over WebRCON: players, queue, server FPS, entities, memory and uptime.",
  category: "game",
  badge: "Rust",
  icon: "Wrench",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 28016 },
  fields: [
    { key: "host", label: "Host", type: "text", placeholder: "rust.example.com", required: true },
    { key: "port", label: "RCON port", type: "number", placeholder: "28016", half: true },
    { key: "password", label: "RCON password", type: "password", required: true, half: true },
  ],
  dataFields: [
    { key: "players", label: "Players", format: "players" },
    { key: "queued", label: "Queued", format: "number" },
    { key: "fps", label: "Server FPS", format: "number" },
    { key: "entities", label: "Entities", format: "number" },
    { key: "memoryMb", label: "Memory", format: "mb" },
    { key: "map", label: "Map" },
  ],
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(config.host);
      const res = await fetch(`http://${config.host}:${config.port}/${encodeURIComponent(config.password)}`, {
        headers: { Upgrade: "websocket" },
        signal: ctx.signal,
      });
      const ws = res.webSocket;
      if (!ws) return fail(`WebRCON upgrade failed (HTTP ${res.status})`);
      ws.accept();
      const info = await new Promise<RustServerInfo>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error("WebRCON timed out")); try { ws.close(); } catch { /* ignore */ } }, ctx.timeoutMs);
        ws.addEventListener("message", (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as { Identifier?: number; Message?: string };
            if (msg.Identifier === 1 && msg.Message) { clearTimeout(timer); resolve(JSON.parse(msg.Message) as RustServerInfo); ws.close(); }
          } catch (e) { clearTimeout(timer); reject(e); }
        });
        ws.addEventListener("close", () => { clearTimeout(timer); reject(new Error("WebRCON closed before responding (bad password?)")); });
        ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebRCON socket error")); });
        ws.send(JSON.stringify({ Identifier: 1, Message: "serverinfo", Name: "Pylon" }));
      });
      const latencyMs = Date.now() - started;
      const data = {
        players: info.Players ?? 0,
        maxPlayers: info.MaxPlayers ?? 0,
        queued: info.Queued ?? 0,
        joining: info.Joining ?? 0,
        fps: info.Framerate,
        entities: info.EntityCount,
        memoryMb: info.Memory,
        uptimeSec: info.Uptime,
        map: info.Map,
        name: info.Hostname?.slice(0, 120),
      };
      return { ok: true, latencyMs, message: `${data.players}/${data.maxPlayers} players · ${data.fps ?? "?"} fps`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
