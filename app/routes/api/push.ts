import { eq } from "drizzle-orm";
import type { Route } from "./+types/push";
import { getDb, getEnv, json } from "~/lib/server";
import { monitors } from "@server/db/schema";
import { runnerStub } from "@server/services/monitors";
import type { ProbeResult } from "@server/probes/types";
import { rateLimit } from "@server/lib/ratelimit";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Cache-Control": "no-store" };

async function handle(request: Request, token: string, context: Route.LoaderArgs["context"]) {
  const db = getDb(context);
  const env = getEnv(context);
  const m = await db.select({ id: monitors.id, enabled: monitors.enabled, runner: monitors.runner }).from(monitors).where(eq(monitors.pushToken, token)).get();
  if (!m) return json({ ok: false, error: "Unknown push token" }, { status: 404, headers: CORS });
  if (!m.enabled) return json({ ok: false, error: "Monitor is paused" }, { status: 409, headers: CORS });
  if (!(await rateLimit(env, "PUSH_LIMITER", `push:${token}`))) return json({ ok: false, error: "Rate limited: max 120 pushes per minute per monitor" }, { status: 429, headers: CORS });
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") ?? "";
    try {
      if (ct.includes("application/json")) body = (await request.json()) as Record<string, unknown>;
      else if (ct.includes("form")) body = Object.fromEntries((await request.formData()).entries()) as Record<string, unknown>;
    } catch { return json({ ok: false, error: "Invalid body" }, { status: 400, headers: CORS }); }
  }
  const status = String(body.status ?? url.searchParams.get("status") ?? "up").toLowerCase();
  const msg = String(body.msg ?? body.message ?? url.searchParams.get("msg") ?? "");
  const latencyRaw = body.latency ?? body.ping ?? url.searchParams.get("latency") ?? url.searchParams.get("ping");
  const latencyMs = latencyRaw !== null && latencyRaw !== undefined && latencyRaw !== "" ? Number(latencyRaw) : undefined;
  const data: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (["status", "msg", "message", "latency", "ping"].includes(k)) continue;
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 200)) { data[k] = v; if (++n >= 30) break; }
  }
  const ok = status !== "down" && status !== "fail" && status !== "0";
  const result: ProbeResult = { ok, latencyMs: Number.isFinite(latencyMs) ? latencyMs : undefined, message: msg || (ok ? "Heartbeat received" : undefined), error: ok ? undefined : msg || "Reported down", data: Object.keys(data).length ? data : undefined };
  const newStatus = await runnerStub(env, m.id).ingest(result, "push");
  return json({ ok: true, status: newStatus }, { headers: CORS });
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return handle(request, params.token, context);
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handle(request, params.token, context);
}
