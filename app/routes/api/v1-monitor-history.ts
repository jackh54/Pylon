import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/v1-monitor-history";
import { getDb, getEnv, json } from "~/lib/server";
import { authenticateApiKey } from "@server/auth/api-keys";
import { monitors } from "@server/db/schema";
import { runnerStub } from "@server/services/monitors";
import { HOUR } from "@server/lib/time";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const auth = await authenticateApiKey(db, request);
  if (!auth) return json({ error: "Unauthorized" }, { status: 401 });
  const m = await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.id, params.id), eq(monitors.orgId, auth.org.id))).get();
  if (!m) return json({ error: "Not found" }, { status: 404 });
  const hours = Math.min(24 * 30, Math.max(1, Number(new URL(request.url).searchParams.get("hours") ?? 24)));
  const stub = runnerStub(getEnv(context), m.id);
  const [history, buckets] = await Promise.all([
    stub.history({ sinceMs: Date.now() - hours * HOUR, limit: 2000 }),
    stub.buckets({ sinceMs: Date.now() - hours * HOUR, bucketMs: hours <= 24 ? 15 * 60_000 : hours <= 24 * 7 ? 2 * HOUR : 8 * HOUR }),
  ]);
  return json({ monitorId: m.id, hours, checks: history, buckets }, { headers: { "Cache-Control": "no-store" } });
}
