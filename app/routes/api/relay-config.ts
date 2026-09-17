import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/relay-config";
import { getDb, json } from "~/lib/server";
import { authenticateRelay } from "./relay-auth.server";
import { monitors } from "@server/db/schema";

/** Relays poll this every ~60s to learn which monitors to run. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const relay = await authenticateRelay(db, request);
  if (!relay) return json({ error: "Invalid relay token" }, { status: 401 });
  const rows = await db.select().from(monitors).where(and(eq(monitors.runner, relay.id), eq(monitors.enabled, true))).all();
  return json({
    relay: { id: relay.id, name: relay.name, region: relay.region },
    pollSec: 60,
    monitors: rows.map((m) => ({ id: m.id, name: m.name, type: m.type, config: m.config, intervalSec: m.intervalSec, timeoutMs: m.timeoutMs })),
  }, { headers: { "Cache-Control": "no-store" } });
}
