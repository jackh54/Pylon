import type { z } from "zod";

/** Where a probe can execute. */
export type Runner = "edge" | "relay" | "push";

export interface ProbeResult {
  /** reachable and all assertions passed */
  ok: boolean;
  /**
   * No verdict: the check could not be performed for a reason unrelated to the monitored service
   * (a third-party API rate-limited or failed us). The monitor keeps its current status, and the
   * attempt is left out of uptime figures.
   */
  skip?: boolean;
  latencyMs?: number;
  /** short human summary, e.g. "12/100 players · 1.21.4" */
  message?: string;
  /** structured snapshot. Well-known keys: players, maxPlayers, version, map, name, motd */
  data?: Record<string, unknown>;
  /** failure reason when !ok */
  error?: string;
}

export interface ProbeContext {
  timeoutMs: number;
  signal: AbortSignal;
  secrets: { STEAM_API_KEY?: string };
}

export type FieldType = "text" | "number" | "password" | "select" | "boolean" | "textarea" | "url";

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** shown as a smaller field next to the previous one (e.g. host + port) */
  half?: boolean;
}

export interface DataField {
  key: string;
  label: string;
  format?: "number" | "text" | "players" | "ms" | "mb" | "percent";
}

export interface ProbeDefinition<C = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  category: "game" | "generic" | "push";
  /** short label for the game/platform badge, e.g. "Minecraft" */
  badge?: string;
  icon: string;
  runsOn: Runner[];
  schema: z.ZodType<C>;
  fields: FieldSpec[];
  defaults: Partial<C>;
  /** default interval seconds for new monitors of this type */
  defaultIntervalSec?: number;
  /** what the snapshot contains, for the status page + docs */
  dataFields?: DataField[];
  /** Markdown help shown in the monitor editor and docs */
  docs?: string;
  /** edge implementation; absent when the probe only runs on relays or is push-based */
  run?: (config: C, ctx: ProbeContext) => Promise<ProbeResult>;
  /** Builds the human-readable address for display, e.g. "play.example.com:25565" */
  address?: (config: C) => string;
}

export function fail(error: string, extra: Partial<ProbeResult> = {}): ProbeResult {
  return { ok: false, error, ...extra };
}

/** No verdict this round; see ProbeResult.skip. */
export function skip(reason: string): ProbeResult {
  return { ok: false, skip: true, message: reason };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
