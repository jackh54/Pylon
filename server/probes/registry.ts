import type { ProbeContext, ProbeDefinition, ProbeResult, Runner } from "./types";
import { httpProbe } from "./http";
import { tcpProbe } from "./tcp";
import { dnsProbe } from "./dns";
import { heartbeatProbe } from "./heartbeat";
import { gamedigProbe } from "./gamedig";
import { minecraftJavaProbe } from "./minecraft-java";
import { minecraftBedrockProbe } from "./minecraft-bedrock";
import { sourceProbe } from "./source";
import { fivemProbe } from "./fivem";
import { rconProbe } from "./rcon";
import { rustWebRconProbe } from "./rust-webrcon";
import { pterodactylProbe } from "./pterodactyl";
import { discordProbe } from "./discord";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PROBES: ProbeDefinition<any>[] = [
  minecraftJavaProbe,
  minecraftBedrockProbe,
  sourceProbe,
  fivemProbe,
  rustWebRconProbe,
  rconProbe,
  pterodactylProbe,
  gamedigProbe,
  discordProbe,
  httpProbe,
  tcpProbe,
  dnsProbe,
  heartbeatProbe,
];

const byId = new Map(PROBES.map((p) => [p.id, p]));

export function getProbe(id: string): ProbeDefinition<any> | undefined {
  return byId.get(id);
}

export function probeIds(): string[] {
  return PROBES.map((p) => p.id);
}

/** Validate + normalise a config object for a probe type. Throws ZodError. */
export function parseProbeConfig(type: string, raw: unknown): Record<string, unknown> {
  const def = getProbe(type);
  if (!def) throw new Error(`Unknown monitor type "${type}"`);
  return def.schema.parse(raw) as Record<string, unknown>;
}

export function probeAddress(type: string, config: Record<string, unknown>): string {
  const def = getProbe(type);
  if (!def?.address) return "";
  try { return def.address(config); } catch { return ""; }
}

export function probeRunsOn(type: string, runner: Runner): boolean {
  return getProbe(type)?.runsOn.includes(runner) ?? false;
}

/** Execute a probe on the edge with a hard timeout. Never throws. */
export async function runProbe(type: string, config: Record<string, unknown>, opts: { timeoutMs: number; secrets: ProbeContext["secrets"] }): Promise<ProbeResult> {
  const def = getProbe(type);
  if (!def) return { ok: false, error: `Unknown monitor type "${type}"` };
  if (!def.run) return { ok: false, error: `"${def.name}" cannot run on the edge` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  const ctx: ProbeContext = { timeoutMs: opts.timeoutMs, signal: controller.signal, secrets: opts.secrets };
  try {
    let parsed: Record<string, unknown>;
    try { parsed = def.schema.parse(config) as Record<string, unknown>; } catch (e) { return { ok: false, error: `Invalid config: ${e instanceof Error ? e.message : String(e)}` }; }
    const result = await Promise.race([
      def.run(parsed, ctx),
      new Promise<ProbeResult>((resolve) => setTimeout(() => resolve({ ok: false, error: `Timed out after ${opts.timeoutMs}ms` }), opts.timeoutMs + 1000)),
    ]);
    return result;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Serialisable view of the registry for the UI (no functions). */
export function probeCatalog() {
  return PROBES.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    badge: p.badge ?? null,
    icon: p.icon,
    runsOn: p.runsOn,
    fields: p.fields,
    defaults: p.defaults,
    defaultIntervalSec: p.defaultIntervalSec ?? 60,
    dataFields: p.dataFields ?? [],
    docs: p.docs ?? null,
  }));
}
export type ProbeCatalogEntry = ReturnType<typeof probeCatalog>[number];
