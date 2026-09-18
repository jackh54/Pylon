import { DurableObject } from "cloudflare:workers";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createDb } from "../db";
import { channels, dailyStats, events, incidentComponents, incidentUpdates, incidents, monitorChannels, monitors, statusPages, type MonitorStatus } from "../db/schema";
import { purgePageCache } from "../services/cache";
import { newId } from "../lib/ids";
import { DAY, MINUTE, SECOND, utcDay } from "../lib/time";
import { getProbe, probeAddress, runProbe } from "../probes/registry";
import type { ProbeResult } from "../probes/types";
import type { NotificationPayload } from "../notify";
import { dispatchNotification } from "../notify/dispatch";
import { pageLinksForMonitor } from "../services/monitors";

export interface RunnerPageLink { pageId: string; componentId: string; autoIncidents: boolean }

export interface RunnerConfig {
  monitorId: string;
  orgId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  intervalSec: number;
  timeoutMs: number;
  retries: number;
  degradedLatencyMs: number | null;
  runner: string;
  enabled: boolean;
  pages: RunnerPageLink[];
}

interface DayAcc {
  day: string;
  checks: number;
  failures: number;
  degraded: number;
  latencySum: number;
  latencyMax: number;
  playersPeak: number;
  playersSum: number;
  downtimeSec: number;
}

interface RunnerState {
  status: MonitorStatus;
  consecutiveFails: number;
  lastChangedAt: number | null;
  lastResultAt: number | null;
  lastFlushAt: number;
  checksSincePrune: number;
  acc: DayAcc;
}

export interface HeartbeatRow {
  ts: number;
  ok: boolean;
  status: MonitorStatus;
  latency: number | null;
  message: string | null;
  data: Record<string, unknown> | null;
}

export interface HistoryBucket {
  t: number;
  checks: number;
  failures: number;
  avgLatency: number | null;
  maxLatency: number | null;
  avgPlayers: number | null;
  maxPlayers: number | null;
}

/** Explicit RPC surface of the DO (avoids the generic Rpc typing collapsing to never on unknown-typed JSON). */
export interface MonitorRunnerStub {
  forgetDay(day: string): Promise<{ checks: number; failures: number }>;
  configure(cfg: RunnerConfig): Promise<void>;
  destroy(): Promise<void>;
  pause(): Promise<void>;
  check(): Promise<{ result: ProbeResult; status: MonitorStatus }>;
  ingest(result: ProbeResult, source: "push" | "relay"): Promise<MonitorStatus>;
  history(opts?: { sinceMs?: number; limit?: number }): Promise<HeartbeatRow[]>;
  buckets(opts: { sinceMs: number; bucketMs: number }): Promise<HistoryBucket[]>;
  status(): Promise<{ status: MonitorStatus; lastResultAt: number | null; lastChangedAt: number | null; consecutiveFails: number; nextAlarm: number | null }>;
}

export interface LiveHubStub {
  broadcast(message: Record<string, unknown>): Promise<number>;
  viewers(): Promise<number>;
}

const RAW_RETENTION_MS = 30 * DAY;
const FLUSH_EVERY_MS = 5 * MINUTE;

function freshAcc(day: string): DayAcc {
  return { day, checks: 0, failures: 0, degraded: 0, latencySum: 0, latencyMax: 0, playersPeak: 0, playersSum: 0, downtimeSec: 0 };
}

/**
 * One Durable Object per monitor. Owns the schedule (alarm), the raw heartbeat history (SQLite in
 * the DO), and state transitions. Writes small snapshots + daily rollups to D1.
 */
export class MonitorRunner extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Which status pages show this monitor, re-read from D1 periodically (see currentPages). */
  private pagesCache: { at: number; links: RunnerPageLink[] } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      status TEXT NOT NULL,
      latency INTEGER,
      message TEXT,
      data TEXT
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS heartbeats_ts ON heartbeats(ts)`);
  }

  private db() { return createDb(this.env.DB); }

  /**
   * Page placement changes without this object being told (components added through the editor
   * or directly in D1), so the list captured at configure() time can go stale. Re-read it every
   * few minutes; fall back to the configured list if D1 is unavailable.
   */
  private async currentPages(cfg: RunnerConfig): Promise<RunnerPageLink[]> {
    const now = Date.now();
    if (this.pagesCache && now - this.pagesCache.at < 5 * MINUTE) return this.pagesCache.links;
    try {
      const links = await pageLinksForMonitor(this.db(), cfg.monitorId);
      this.pagesCache = { at: now, links };
      return links;
    } catch {
      return this.pagesCache?.links ?? cfg.pages;
    }
  }

  private async getConfig(): Promise<RunnerConfig | undefined> {
    return this.ctx.storage.get<RunnerConfig>("config");
  }

  private async getState(): Promise<RunnerState> {
    const s = await this.ctx.storage.get<RunnerState>("state");
    return s ?? { status: "pending", consecutiveFails: 0, lastChangedAt: null, lastResultAt: null, lastFlushAt: 0, checksSincePrune: 0, acc: freshAcc(utcDay()) };
  }

  /* ------------------------------------------------------------------ RPC */

  /** Install or update the monitor definition. Idempotent; (re)schedules the alarm. */
  async configure(cfg: RunnerConfig): Promise<void> {
    this.pagesCache = { at: Date.now(), links: cfg.pages };
    const prev = await this.getConfig();
    await this.ctx.storage.put("config", cfg);
    if (!cfg.enabled) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const alarm = await this.ctx.storage.getAlarm();
    const definitionChanged = !prev || prev.type !== cfg.type || JSON.stringify(prev.config) !== JSON.stringify(cfg.config) || prev.intervalSec !== cfg.intervalSec || prev.runner !== cfg.runner || !prev.enabled;
    if (cfg.runner === "edge") {
      // run soon after (re)configuration, otherwise keep the existing cadence
      if (definitionChanged || alarm === null) await this.ctx.storage.setAlarm(Date.now() + 2 * SECOND);
    } else if (alarm === null || definitionChanged) {
      await this.ctx.storage.setAlarm(Date.now() + this.watchdogMs(cfg));
    }
  }

  /** Stop checking and forget everything (monitor deleted). */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Pause: keep history, stop alarms, mark paused in D1. */
  async pause(): Promise<void> {
    const cfg = await this.getConfig();
    if (cfg) await this.ctx.storage.put("config", { ...cfg, enabled: false });
    await this.ctx.storage.deleteAlarm();
    const state = await this.getState();
    state.status = "paused";
    await this.ctx.storage.put("state", state);
    await this.db().update(monitors).set({ status: "paused" }).where(eq(monitors.id, cfg?.monitorId ?? ""));
  }

  /** Run a check right now (edge monitors) and return the outcome. */
  async check(): Promise<{ result: ProbeResult; status: MonitorStatus }> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error("Monitor is not configured");
    if (cfg.runner !== "edge") {
      const state = await this.getState();
      return { result: { ok: state.status === "up" || state.status === "degraded", message: "Push/relay monitor – waiting for results" }, status: state.status };
    }
    const result = await this.execute(cfg);
    const status = await this.record(cfg, result, "edge");
    return { result, status };
  }

  /** Ingest a result produced elsewhere (push heartbeat or relay). */
  async ingest(result: ProbeResult, source: "push" | "relay"): Promise<MonitorStatus> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error("Monitor is not configured");
    const status = await this.record(cfg, result, source);
    if (cfg.enabled) await this.ctx.storage.setAlarm(Date.now() + this.watchdogMs(cfg));
    return status;
  }

  /**
   * Erase recorded failures for one UTC day: used when an outage was not the monitored service's
   * fault (a false alarm). Checks still count, so uptime for that day becomes 100%.
   */
  async forgetDay(day: string): Promise<{ checks: number; failures: number }> {
    const cfg = await this.getConfig();
    if (!cfg) throw new Error("Monitor is not configured");
    const start = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(start)) throw new Error(`Invalid day "${day}"`);
    const end = start + DAY;

    this.sql.exec("DELETE FROM heartbeats WHERE ok = 0 AND ts >= ? AND ts < ?", start, end);

    const state = await this.getState();
    if (state.acc.day === day) {
      state.acc.failures = 0;
      state.acc.degraded = 0;
      state.acc.downtimeSec = 0;
      state.consecutiveFails = 0;
      await this.ctx.storage.put("state", state);
      const db = this.db();
      await db.insert(dailyStats).values({ monitorId: cfg.monitorId, day, ...pick(state.acc) })
        .onConflictDoUpdate({ target: [dailyStats.monitorId, dailyStats.day], set: pick(state.acc) });
      return { checks: state.acc.checks, failures: 0 };
    }
    const db = this.db();
    await db.update(dailyStats).set({ failures: 0, degraded: 0, downtimeSec: 0 })
      .where(and(eq(dailyStats.monitorId, cfg.monitorId), eq(dailyStats.day, day)));
    const row = await db.select().from(dailyStats).where(and(eq(dailyStats.monitorId, cfg.monitorId), eq(dailyStats.day, day))).get();
    return { checks: row?.checks ?? 0, failures: 0 };
  }

  /** Raw heartbeats, newest first. */
  async history(opts: { sinceMs?: number; limit?: number } = {}): Promise<HeartbeatRow[]> {
    const since = opts.sinceMs ?? Date.now() - DAY;
    const limit = Math.min(opts.limit ?? 200, 2000);
    const rows = this.sql.exec<{ ts: number; ok: number; status: string; latency: number | null; message: string | null; data: string | null }>(
      "SELECT ts, ok, status, latency, message, data FROM heartbeats WHERE ts >= ? ORDER BY ts DESC LIMIT ?", since, limit,
    ).toArray();
    return rows.map((r) => ({ ts: r.ts, ok: !!r.ok, status: r.status as MonitorStatus, latency: r.latency, message: r.message, data: r.data ? safeJson(r.data) : null }));
  }

  /** Time-bucketed aggregates for charts. */
  async buckets(opts: { sinceMs: number; bucketMs: number }): Promise<HistoryBucket[]> {
    const rows = this.sql.exec<{ t: number; checks: number; failures: number; avgLatency: number | null; maxLatency: number | null; avgPlayers: number | null; maxPlayers: number | null }>(
      `SELECT (ts / ?1) * ?1 AS t,
              COUNT(*) AS checks,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
              AVG(CASE WHEN ok = 1 THEN latency END) AS avgLatency,
              MAX(CASE WHEN ok = 1 THEN latency END) AS maxLatency,
              AVG(json_extract(data, '$.players')) AS avgPlayers,
              MAX(json_extract(data, '$.players')) AS maxPlayers
       FROM heartbeats WHERE ts >= ?2 GROUP BY t ORDER BY t ASC`, opts.bucketMs, opts.sinceMs,
    ).toArray();
    return rows;
  }

  async status(): Promise<{ status: MonitorStatus; lastResultAt: number | null; lastChangedAt: number | null; consecutiveFails: number; nextAlarm: number | null }> {
    const s = await this.getState();
    return { status: s.status, lastResultAt: s.lastResultAt, lastChangedAt: s.lastChangedAt, consecutiveFails: s.consecutiveFails, nextAlarm: await this.ctx.storage.getAlarm() };
  }

  /* ---------------------------------------------------------------- alarm */

  override async alarm(info?: { retryCount: number; isRetry: boolean }): Promise<void> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.enabled) return;
    // schedule next tick first so a crash below cannot stall the monitor
    const intervalMs = Math.max(10, cfg.intervalSec) * SECOND;
    if (cfg.runner === "edge") {
      await this.ctx.storage.setAlarm(Date.now() + intervalMs);
      try {
        const result = await this.execute(cfg);
        await this.record(cfg, result, "edge");
      } catch (e) {
        console.error(`[monitor ${cfg.monitorId}] alarm failed`, e, info);
      }
      return;
    }
    // push / relay watchdog: the alarm only fires when no result arrived in time
    await this.ctx.storage.setAlarm(Date.now() + intervalMs);
    const state = await this.getState();
    const graceMs = this.watchdogMs(cfg);
    if (state.lastResultAt && Date.now() - state.lastResultAt < graceMs) return;
    const waited = state.lastResultAt ? Math.round((Date.now() - state.lastResultAt) / SECOND) : null;
    try {
      await this.record(cfg, { ok: false, error: waited === null ? "No heartbeat received yet" : `No heartbeat for ${waited}s (expected every ${cfg.intervalSec}s)` }, "watchdog");
    } catch (e) {
      console.error(`[monitor ${cfg.monitorId}] watchdog failed`, e);
    }
  }

  private watchdogMs(cfg: RunnerConfig): number {
    const grace = Number((cfg.config as { graceSec?: number }).graceSec ?? 30);
    return (cfg.intervalSec + grace) * SECOND;
  }

  private async execute(cfg: RunnerConfig): Promise<ProbeResult> {
    return runProbe(cfg.type, cfg.config, { timeoutMs: cfg.timeoutMs, secrets: { STEAM_API_KEY: (this.env as unknown as { STEAM_API_KEY?: string }).STEAM_API_KEY } });
  }

  /* --------------------------------------------------------------- record */

  private async record(cfg: RunnerConfig, result: ProbeResult, source: string): Promise<MonitorStatus> {
    const now = Date.now();
    const state = await this.getState();

    // No verdict (a third party rate-limited or failed us): keep the current status and leave
    // uptime untouched, but record that we tried.
    if (result.skip) {
      state.lastResultAt = now;
      await this.ctx.storage.put("state", state);
      try {
        await this.db().update(monitors).set({ lastCheckedAt: now, lastMessage: (result.message ?? "No verdict").slice(0, 500) }).where(eq(monitors.id, cfg.monitorId));
      } catch (e) {
        console.error(`[monitor ${cfg.monitorId}] skip write failed`, e);
      }
      console.log(`[monitor ${cfg.monitorId}] skipped (${source}): ${result.message ?? ""}`);
      return state.status;
    }

    const prevStatus = state.status;
    const elapsedSec = state.lastResultAt ? Math.min((now - state.lastResultAt) / SECOND, cfg.intervalSec * 2) : cfg.intervalSec;

    // --- state machine
    let next: MonitorStatus;
    if (result.ok) {
      state.consecutiveFails = 0;
      next = cfg.degradedLatencyMs && result.latencyMs !== undefined && result.latencyMs > cfg.degradedLatencyMs ? "degraded" : "up";
    } else {
      state.consecutiveFails += 1;
      next = state.consecutiveFails >= Math.max(1, cfg.retries) || prevStatus === "down" ? "down" : (prevStatus === "pending" || prevStatus === "paused" ? "pending" : prevStatus);
    }

    // --- day accumulator
    const today = utcDay(now);
    const flushes: DayAcc[] = [];
    if (state.acc.day !== today) { flushes.push(state.acc); state.acc = freshAcc(today); }
    const acc = state.acc;
    acc.checks += 1;
    if (!result.ok) acc.failures += 1;
    if (next === "degraded") acc.degraded += 1;
    if (result.ok && result.latencyMs !== undefined) { acc.latencySum += result.latencyMs; acc.latencyMax = Math.max(acc.latencyMax, result.latencyMs); }
    const players = typeof result.data?.players === "number" ? result.data.players : null;
    if (players !== null) { acc.playersSum += players; acc.playersPeak = Math.max(acc.playersPeak, players); }
    if (next === "down") acc.downtimeSec += Math.round(elapsedSec);

    // --- raw heartbeat
    const message = result.ok ? result.message ?? null : result.error ?? result.message ?? "Check failed";
    this.sql.exec("INSERT INTO heartbeats (ts, ok, status, latency, message, data) VALUES (?, ?, ?, ?, ?, ?)",
      now, result.ok ? 1 : 0, next, result.latencyMs ?? null, message?.slice(0, 500) ?? null, result.data ? JSON.stringify(result.data) : null);
    state.checksSincePrune += 1;
    if (state.checksSincePrune >= 500) {
      this.sql.exec("DELETE FROM heartbeats WHERE ts < ?", now - RAW_RETENTION_MS);
      state.checksSincePrune = 0;
    }

    const changed = next !== prevStatus;
    if (changed) state.lastChangedAt = now;
    state.status = next;
    state.lastResultAt = now;

    const shouldFlush = changed || flushes.length > 0 || now - state.lastFlushAt >= FLUSH_EVERY_MS;
    if (shouldFlush) { flushes.push(acc); state.lastFlushAt = now; }
    await this.ctx.storage.put("state", state);

    // --- D1 writes (snapshot every check, rollups periodically)
    const db = this.db();
    const snapshot: Record<string, unknown> = { ...(result.data ?? {}) };
    const statements = [
      db.update(monitors).set({
        status: next,
        lastCheckedAt: now,
        lastLatencyMs: result.latencyMs ?? null,
        lastMessage: message?.slice(0, 500) ?? null,
        lastData: snapshot,
        ...(changed ? { lastChangedAt: now } : {}),
      }).where(eq(monitors.id, cfg.monitorId)),
      ...flushes.map((f) => db.insert(dailyStats).values({ monitorId: cfg.monitorId, day: f.day, ...pick(f) }).onConflictDoUpdate({
        target: [dailyStats.monitorId, dailyStats.day],
        set: pick(f),
      })),
      ...(changed && prevStatus !== "paused" ? [db.insert(events).values({ id: newId("evt"), monitorId: cfg.monitorId, fromStatus: prevStatus, toStatus: next, message: message?.slice(0, 500) ?? null })] : []),
    ] as const;
    try {
      await db.batch([statements[0], ...statements.slice(1)] as unknown as Parameters<typeof db.batch>[0]);
    } catch (e) {
      console.error(`[monitor ${cfg.monitorId}] D1 write failed`, e);
    }

    // --- live broadcast to every status page showing this monitor
    const event = { type: "monitor", monitorId: cfg.monitorId, status: next, latencyMs: result.latencyMs ?? null, message, data: snapshot, checkedAt: now, changed, source };
    const pages = await this.currentPages(cfg);
    for (const link of pages) {
      const hub = this.env.LIVE.get(this.env.LIVE.idFromName(link.pageId)) as unknown as LiveHubStub;
      void hub.broadcast({ ...event, componentId: link.componentId }).catch(() => {});
    }

    // --- transitions: purge cached pages, incidents + notifications
    if (changed && pages.length) {
      try {
        const pageRows = await db.select({ slug: statusPages.slug, customDomain: statusPages.customDomain }).from(statusPages).where(inArray(statusPages.id, pages.map((p) => p.pageId))).all();
        await Promise.allSettled(pageRows.map((p) => purgePageCache(this.env, p)));
      } catch { /* best effort */ }
    }
    if (changed && this.isAlertable(prevStatus, next)) {
      await Promise.allSettled([
        this.handleAutoIncidents({ ...cfg, pages }, prevStatus, next, message),
        this.notify(cfg, prevStatus, next, result, message),
      ]);
    }
    return next;
  }

  private isAlertable(from: MonitorStatus, to: MonitorStatus): boolean {
    if (from === "pending" && (to === "up" || to === "degraded")) return false; // first successful check
    if (from === "paused") return false;
    return from !== to;
  }

  private async handleAutoIncidents(cfg: RunnerConfig, _from: MonitorStatus, to: MonitorStatus, message: string | null): Promise<void> {
    const db = this.db();
    const now = Date.now();
    if (to === "down") {
      for (const link of cfg.pages.filter((p) => p.autoIncidents)) {
        const open = await db.select({ id: incidents.id }).from(incidents)
          .where(and(eq(incidents.monitorId, cfg.monitorId), eq(incidents.pageId, link.pageId), eq(incidents.auto, true), isNull(incidents.resolvedAt))).get();
        if (open) continue;
        const id = newId("inc");
        await db.batch([
          db.insert(incidents).values({ id, orgId: cfg.orgId, pageId: link.pageId, title: `${cfg.name} is down`, status: "investigating", impact: "major", auto: true, monitorId: cfg.monitorId, startedAt: now }),
          db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: id, status: "investigating", body: `Automated monitoring detected an outage${message ? `: ${message}` : "."}` }),
          db.insert(incidentComponents).values({ incidentId: id, componentId: link.componentId }),
        ]);
      }
    } else if (to === "up" || to === "degraded") {
      const open = await db.select({ id: incidents.id }).from(incidents)
        .where(and(eq(incidents.monitorId, cfg.monitorId), eq(incidents.auto, true), isNull(incidents.resolvedAt))).all();
      for (const inc of open) {
        await db.batch([
          db.update(incidents).set({ status: "resolved", resolvedAt: now, updatedAt: now }).where(eq(incidents.id, inc.id)),
          db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: inc.id, status: "resolved", body: "Monitoring confirms the service has recovered." }),
        ]);
      }
    }
  }

  private async notify(cfg: RunnerConfig, from: MonitorStatus, to: MonitorStatus, result: ProbeResult, message: string | null): Promise<void> {
    const db = this.db();
    const rows = await db.select({ channel: channels }).from(channels)
      .leftJoin(monitorChannels, and(eq(monitorChannels.channelId, channels.id), eq(monitorChannels.monitorId, cfg.monitorId)))
      .where(and(eq(channels.orgId, cfg.orgId), eq(channels.enabled, true), or(eq(channels.isDefault, true), sql`${monitorChannels.monitorId} IS NOT NULL`)))
      .all();
    if (!rows.length) return;
    const appUrl = this.env.APP_URL.replace(/\/$/, "");
    const payload: NotificationPayload = {
      event: "monitor.status_changed",
      monitor: { id: cfg.monitorId, name: cfg.name, type: getProbe(cfg.type)?.name ?? cfg.type, address: probeAddress(cfg.type, cfg.config), url: `${appUrl}/app/monitors/${cfg.monitorId}` },
      from, to,
      message: message ?? undefined,
      latencyMs: result.latencyMs,
      data: result.data,
      at: Date.now(),
      appName: "Pylon",
    };
    const seen = new Set<string>();
    await Promise.allSettled(rows.map(async ({ channel }) => {
      if (seen.has(channel.id)) return;
      seen.add(channel.id);
      try { await dispatchNotification(this.env, channel, payload); }
      catch (e) { console.error(`[notify ${channel.id}] failed`, e); }
    }));
  }
}

function pick(f: DayAcc) {
  return { checks: f.checks, failures: f.failures, degraded: f.degraded, latencySum: f.latencySum, latencyMax: f.latencyMax, playersPeak: f.playersPeak, playersSum: f.playersSum, downtimeSec: f.downtimeSec };
}

function safeJson(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}
