import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { openTcp, assertPublicHost } from "../lib/net";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
});
export type TcpConfig = z.infer<typeof schema>;

export const tcpProbe: ProbeDefinition<TcpConfig> = {
  id: "tcp",
  name: "TCP Port",
  description: "Open a TCP connection to a host and port. Works for any TCP game server (Terraria, Starbound, custom).",
  category: "generic",
  icon: "Plug",
  runsOn: ["edge", "relay"],
  schema,
  defaults: {},
  fields: [
    { key: "host", label: "Host", type: "text", placeholder: "play.example.com", required: true },
    { key: "port", label: "Port", type: "number", placeholder: "7777", required: true, half: true },
  ],
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(config.host);
      const s = await openTcp(config.host, config.port, ctx.timeoutMs);
      s.close();
      const latencyMs = Date.now() - started;
      return { ok: true, latencyMs, message: `Port ${config.port} open` };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
