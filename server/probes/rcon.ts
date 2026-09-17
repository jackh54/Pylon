import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { openTcp, assertPublicHost } from "../lib/net";
import { concat, i32le } from "../lib/bytes";
import { withTimeout } from "../lib/time";

const schema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(25575),
  password: z.string().min(1),
  command: z.string().optional(),
  expect: z.string().optional(),
});
export type RconConfig = z.infer<typeof schema>;

const SERVERDATA_AUTH = 3;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH_RESPONSE = 2;

function rconPacket(id: number, type: number, body: string): Uint8Array {
  const b = new TextEncoder().encode(body);
  const payload = concat(i32le(id), i32le(type), b, Uint8Array.of(0, 0));
  return concat(i32le(payload.length), payload);
}

/** Source RCON (also used by Minecraft, Rust legacy, ARK, Valheim mods, etc.). */
export const rconProbe: ProbeDefinition<RconConfig> = {
  id: "rcon",
  name: "RCON",
  description: "Authenticate over Source RCON (Minecraft, CS2, ARK, 7DTD…) and optionally run a command and assert on its output.",
  category: "game",
  badge: "RCON",
  icon: "TerminalSquare",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { port: 25575 },
  fields: [
    { key: "host", label: "Host", type: "text", placeholder: "play.example.com", required: true },
    { key: "port", label: "RCON port", type: "number", placeholder: "25575", half: true },
    { key: "password", label: "RCON password", type: "password", required: true, half: true },
    { key: "command", label: "Command (optional)", type: "text", placeholder: "list" },
    { key: "expect", label: "Output must contain", type: "text", placeholder: "optional", half: true },
  ],
  dataFields: [{ key: "response", label: "Response" }],
  address: (c) => `${c.host}:${c.port}`,
  async run(config, ctx) {
    const started = Date.now();
    let s: Awaited<ReturnType<typeof openTcp>> | undefined;
    try {
      assertPublicHost(config.host);
      s = await openTcp(config.host, config.port, ctx.timeoutMs);
      const sock = s;
      const readPacket = async () => {
        const size = await sock.reader.readInt32LE();
        if (size < 10 || size > 4096 + 10) throw new Error(`Bad RCON packet size ${size}`);
        const id = await sock.reader.readInt32LE();
        const type = await sock.reader.readInt32LE();
        const bodyBytes = await sock.reader.readBytes(size - 8);
        const body = new TextDecoder().decode(bodyBytes.subarray(0, Math.max(0, bodyBytes.length - 2)));
        return { id, type, body };
      };
      await sock.writer.write(rconPacket(1, SERVERDATA_AUTH, config.password));
      const authed = await withTimeout((async () => {
        for (let i = 0; i < 3; i++) {
          const p = await readPacket();
          if (p.type === SERVERDATA_AUTH_RESPONSE) return p.id !== -1;
        }
        throw new Error("No auth response");
      })(), ctx.timeoutMs, sock.close);
      const latencyMs = Date.now() - started;
      if (!authed) return fail("RCON authentication failed (wrong password)", { latencyMs });
      if (!config.command) return { ok: true, latencyMs, message: "RCON authenticated" };
      await sock.writer.write(rconPacket(2, SERVERDATA_EXECCOMMAND, config.command));
      const out = await withTimeout(readPacket(), ctx.timeoutMs, sock.close);
      const response = out.body.replace(/§[0-9a-fk-orx]/gi, "").trim().slice(0, 500);
      const data = { response };
      if (config.expect && !response.includes(config.expect)) return fail(`Output did not contain "${config.expect}"`, { latencyMs, data });
      return { ok: true, latencyMs, message: response.split("\n")[0]?.slice(0, 120) || "OK", data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    } finally {
      s?.close();
    }
  },
};
