import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { assertPublicHost } from "../lib/net";

const schema = z.object({
  panelUrl: z.string().url(),
  serverId: z.string().min(1),
  apiKey: z.string().min(1),
});
export type PterodactylConfig = z.infer<typeof schema>;

interface Resources {
  attributes?: {
    current_state?: "running" | "starting" | "stopping" | "offline";
    resources?: { memory_bytes?: number; cpu_absolute?: number; disk_bytes?: number; uptime?: number; network_rx_bytes?: number; network_tx_bytes?: number };
  };
}

/** Pterodactyl / Pelican panel client API. Works for anything the panel hosts. */
export const pterodactylProbe: ProbeDefinition<PterodactylConfig> = {
  id: "pterodactyl",
  name: "Pterodactyl / Pelican",
  description: "Container state plus CPU, memory, disk and uptime from the panel's client API. Works for every egg.",
  category: "game",
  badge: "Panel",
  icon: "Server",
  runsOn: ["edge", "relay"],
  schema,
  defaults: {},
  fields: [
    { key: "panelUrl", label: "Panel URL", type: "url", placeholder: "https://panel.example.com", required: true },
    { key: "serverId", label: "Server identifier", type: "text", placeholder: "1a2b3c4d", required: true, half: true, help: "The short id from the panel URL" },
    { key: "apiKey", label: "Client API key", type: "password", placeholder: "ptlc_…", required: true, half: true },
  ],
  dataFields: [
    { key: "state", label: "State" },
    { key: "cpu", label: "CPU", format: "percent" },
    { key: "memoryMb", label: "Memory", format: "mb" },
    { key: "diskMb", label: "Disk", format: "mb" },
  ],
  address: (c) => `${c.panelUrl.replace(/\/$/, "")}/server/${c.serverId}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(new URL(config.panelUrl).hostname);
      const res = await fetch(`${config.panelUrl.replace(/\/$/, "")}/api/client/servers/${encodeURIComponent(config.serverId)}/resources`, {
        headers: { accept: "application/json", authorization: `Bearer ${config.apiKey}` },
        signal: ctx.signal,
      });
      if (res.status === 401 || res.status === 403) return fail("Panel rejected the API key");
      if (!res.ok) return fail(`Panel responded HTTP ${res.status}`);
      const json = (await res.json()) as Resources;
      const latencyMs = Date.now() - started;
      const state = json.attributes?.current_state ?? "unknown";
      const r = json.attributes?.resources ?? {};
      const data = {
        state,
        cpu: r.cpu_absolute !== undefined ? Math.round(r.cpu_absolute * 10) / 10 : undefined,
        memoryMb: r.memory_bytes !== undefined ? Math.round(r.memory_bytes / 1048576) : undefined,
        diskMb: r.disk_bytes !== undefined ? Math.round(r.disk_bytes / 1048576) : undefined,
        uptimeSec: r.uptime !== undefined ? Math.round(r.uptime / 1000) : undefined,
      };
      if (state !== "running") return fail(`Server is ${state}`, { latencyMs, data });
      return { ok: true, latencyMs, message: `running · ${data.cpu ?? 0}% cpu · ${data.memoryMb ?? 0} MB`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
