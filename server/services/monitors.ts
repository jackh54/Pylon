import { eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { monitors, pageComponents, statusPages, type Monitor } from "../db/schema";
import type { MonitorRunnerStub, RunnerConfig, RunnerPageLink } from "../do/monitor-runner";

export async function pageLinksForMonitor(db: Database, monitorId: string): Promise<RunnerPageLink[]> {
  const rows = await db
    .select({ pageId: pageComponents.pageId, componentId: pageComponents.id, published: statusPages.published })
    .from(pageComponents)
    .innerJoin(statusPages, eq(statusPages.id, pageComponents.pageId))
    .where(eq(pageComponents.monitorId, monitorId))
    .all();
  return rows.map((r) => ({ pageId: r.pageId, componentId: r.componentId, autoIncidents: true }));
}

export async function buildRunnerConfig(db: Database, m: Monitor): Promise<RunnerConfig> {
  return {
    monitorId: m.id,
    orgId: m.orgId,
    name: m.name,
    type: m.type,
    config: m.config,
    intervalSec: m.intervalSec,
    timeoutMs: m.timeoutMs,
    retries: m.retries,
    degradedLatencyMs: m.degradedLatencyMs,
    runner: m.runner,
    enabled: m.enabled,
    pages: await pageLinksForMonitor(db, m.id),
  };
}

export function runnerStub(env: Env, monitorId: string): MonitorRunnerStub {
  return env.MONITOR.get(env.MONITOR.idFromName(monitorId)) as unknown as MonitorRunnerStub;
}

/** Push the current D1 definition of a monitor into its Durable Object. */
export async function syncMonitor(env: Env, db: Database, monitorId: string): Promise<void> {
  const m = await db.select().from(monitors).where(eq(monitors.id, monitorId)).get();
  if (!m) return;
  const cfg = await buildRunnerConfig(db, m);
  if (!m.enabled) await runnerStub(env, m.id).pause();
  else await runnerStub(env, m.id).configure(cfg);
}

/** Re-sync every monitor referenced by a status page (after components change). */
export async function syncMonitorsForPage(env: Env, db: Database, pageId: string): Promise<void> {
  const rows = await db.select({ monitorId: pageComponents.monitorId }).from(pageComponents).where(eq(pageComponents.pageId, pageId)).all();
  const ids = [...new Set(rows.map((r) => r.monitorId).filter((x): x is string => !!x))];
  await Promise.allSettled(ids.map((id) => syncMonitor(env, db, id)));
}

export async function deleteMonitor(env: Env, db: Database, monitorId: string): Promise<void> {
  await runnerStub(env, monitorId).destroy().catch(() => {});
  await db.delete(monitors).where(eq(monitors.id, monitorId));
}

export async function monitorsByIds(db: Database, ids: string[]): Promise<Monitor[]> {
  if (!ids.length) return [];
  return db.select().from(monitors).where(inArray(monitors.id, ids)).all();
}
