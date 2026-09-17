import { eq } from "drizzle-orm";
import type { Database } from "@server/db";
import { relays } from "@server/db/schema";
import type { Relay } from "@server/db/schema";
import { sha256Hex } from "@server/lib/ids";

export async function authenticateRelay(db: Database, request: Request): Promise<Relay | null> {
  const m = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(prl_[A-Za-z0-9_-]+)$/i);
  if (!m) return null;
  const relay = await db.select().from(relays).where(eq(relays.tokenHash, await sha256Hex(m[1]!))).get();
  if (!relay) return null;
  const version = request.headers.get("x-pylon-relay-version");
  await db.update(relays).set({ lastSeenAt: Date.now(), ...(version ? { version: version.slice(0, 20) } : {}) }).where(eq(relays.id, relay.id));
  return relay;
}
