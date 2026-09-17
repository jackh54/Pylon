import { eq } from "drizzle-orm";
import type { Route } from "./+types/v1-monitors";
import { getDb, json } from "~/lib/server";
import { authenticateApiKey } from "@server/auth/api-keys";
import { monitors } from "@server/db/schema";
import { getProbe, probeAddress } from "@server/probes/registry";

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const auth = await authenticateApiKey(db, request);
  if (!auth) return json({ error: "Unauthorized. Send Authorization: Bearer <api key>." }, { status: 401 });
  const rows = await db.select().from(monitors).where(eq(monitors.orgId, auth.org.id)).orderBy(monitors.name).all();
  return json({
    monitors: rows.map((m) => ({ id: m.id, name: m.name, type: m.type, typeName: getProbe(m.type)?.name ?? m.type, address: probeAddress(m.type, m.config), status: m.status, enabled: m.enabled, intervalSec: m.intervalSec, runner: m.runner, lastCheckedAt: m.lastCheckedAt, lastChangedAt: m.lastChangedAt, lastLatencyMs: m.lastLatencyMs, lastMessage: m.lastMessage, data: m.lastData })),
  }, { headers: { "Cache-Control": "no-store" } });
}
