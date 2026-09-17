import { and, eq, lt, or, isNull, sql } from "drizzle-orm";
import { createDb } from "../db";
import { events, dailyStats, monitors, orgInvites, sessions } from "../db/schema";
import { DAY, MINUTE } from "../lib/time";
import { buildRunnerConfig, runnerStub } from "./monitors";
import { recheckVerifiedDomains, releaseStaleClaims, verifyPendingDomains } from "./domains";

/** Every 5 minutes: make sure every enabled monitor has a live alarm (self-healing). */
export async function reconcileMonitors(env: Env): Promise<{ checked: number; resynced: number; domains: number }> {
  const db = createDb(env.DB);
  const now = Date.now();
  const stale = await db.select().from(monitors)
    .where(and(eq(monitors.enabled, true), or(isNull(monitors.lastCheckedAt), lt(monitors.lastCheckedAt, sql`${now} - (${monitors.intervalSec} * 3000) - ${MINUTE}`))))
    .limit(250)
    .all();
  let resynced = 0;
  for (const m of stale) {
    try {
      await runnerStub(env, m.id).configure(await buildRunnerConfig(db, m));
      resynced++;
    } catch (e) {
      console.error(`[reconcile] ${m.id} failed`, e);
    }
  }
  let domains = 0;
  try { domains = await verifyPendingDomains(env, db); } catch (e) { console.error("[reconcile] domain verification failed", e); }
  return { checked: stale.length, resynced, domains };
}

/** Daily: trim tables that only grow. */
export async function runRetention(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = Date.now();
  await db.batch([
    db.delete(sessions).where(lt(sessions.expiresAt, now)),
    db.delete(orgInvites).where(lt(orgInvites.expiresAt, now)),
    db.delete(events).where(lt(events.createdAt, now - 180 * DAY)),
    db.delete(dailyStats).where(lt(dailyStats.day, new Date(now - 400 * DAY).toISOString().slice(0, 10))),
  ]);
  const lost = await recheckVerifiedDomains(env, db);
  if (lost) console.log(`[retention] ${lost} custom domains no longer point here and were deactivated`);
  await releaseStaleClaims(db);
}
