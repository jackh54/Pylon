import { and, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/relay-results";
import { getDb, getEnv, json } from "~/lib/server";
import { authenticateRelay } from "./relay-auth.server";
import { monitors } from "@server/db/schema";
import { runnerStub } from "@server/services/monitors";
import type { ProbeResult } from "@server/probes/types";

interface Incoming extends ProbeResult { monitorId: string }

export async function action({ request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const env = getEnv(context);
  const relay = await authenticateRelay(db, request);
  if (!relay) return json({ error: "Invalid relay token" }, { status: 401 });
  let body: { results?: Incoming[] };
  try { body = (await request.json()) as { results?: Incoming[] }; } catch { return json({ error: "Invalid JSON" }, { status: 400 }); }
  const results = (body.results ?? []).slice(0, 200);
  if (!results.length) return json({ accepted: 0 });
  const allowed = new Set((await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.runner, relay.id), inArray(monitors.id, results.map((r) => r.monitorId)))).all()).map((r) => r.id));
  let accepted = 0;
  await Promise.allSettled(results.filter((r) => allowed.has(r.monitorId)).map(async (r) => {
    await runnerStub(env, r.monitorId).ingest({ ok: !!r.ok, latencyMs: typeof r.latencyMs === "number" ? r.latencyMs : undefined, message: r.message, error: r.error, data: r.data && typeof r.data === "object" ? r.data : undefined }, "relay");
    accepted++;
  }));
  return json({ accepted, rejected: results.length - accepted });
}

export function loader() {
  return json({ error: "POST results here" }, { status: 405 });
}
