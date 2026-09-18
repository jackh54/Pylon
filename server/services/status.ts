import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Database } from "../db";
import {
  dailyStats, incidentComponents, incidentUpdates, incidents, maintenances, monitors, pageComponents, pageSections, statusPages,
  type ComponentDisplay, type Incident, type IncidentUpdate, type Maintenance, type MonitorSnapshot, type MonitorStatus, type StatusPage,
} from "../db/schema";
import { DAY, lastDays } from "../lib/time";
import { getProbe } from "../probes/registry";

import { componentState, STATE_LABEL, type ComponentState, type OverallState } from "./status-state";
export { componentState, STATE_LABEL, type ComponentState, type OverallState };

export interface PublicHistoryDay {
  day: string;
  /** 0..100 or null when no checks */
  uptime: number | null;
  checks: number;
  failures: number;
  avgLatency: number | null;
  downtimeSec: number;
  playersPeak: number;
}

export interface PublicComponent {
  id: string;
  name: string;
  description: string | null;
  sectionId: string | null;
  position: number;
  display: ComponentDisplay;
  state: ComponentState;
  monitor: null | {
    id: string;
    type: string;
    typeName: string;
    badge: string | null;
    status: MonitorStatus;
    intervalSec: number;
    lastCheckedAt: number | null;
    lastLatencyMs: number | null;
    lastMessage: string | null;
    data: MonitorSnapshot | null;
  };
  history: PublicHistoryDay[];
  uptime: { d7: number | null; d30: number | null; d90: number | null };
}

export interface PublicIncident extends Incident {
  updates: IncidentUpdate[];
  componentIds: string[];
}

export interface PublicStatus {
  page: Pick<StatusPage, "id" | "slug" | "name" | "description" | "logoUrl" | "faviconUrl" | "theme" | "links" | "hero" | "seo" | "historyDays" | "allowSubscribers" | "customDomain" | "updatedAt"> & { protected: boolean };
  sections: { id: string; name: string; description: string | null; position: number; collapsed: boolean }[];
  components: PublicComponent[];
  activeIncidents: PublicIncident[];
  recentIncidents: PublicIncident[];
  maintenances: { active: Maintenance[]; upcoming: Maintenance[] };
  overall: { state: OverallState; label: string };
  totals: { players: number | null; maxPlayers: number | null; components: number; operational: number };
  generatedAt: number;
}

function pct(checks: number, failures: number): number | null {
  if (!checks) return null;
  return Math.round(((checks - failures) / checks) * 10000) / 100;
}

export async function findPage(db: Database, slug: string): Promise<StatusPage | undefined> {
  return db.select().from(statusPages).where(eq(statusPages.slug, slug)).get();
}

export async function loadIncidentsForPage(db: Database, pageId: string, opts: { limit?: number; sinceMs?: number; onlyOpen?: boolean } = {}): Promise<PublicIncident[]> {
  const conds = [eq(incidents.pageId, pageId)];
  if (opts.onlyOpen) conds.push(isNull(incidents.resolvedAt));
  if (opts.sinceMs) conds.push(gte(incidents.startedAt, opts.sinceMs));
  const rows = await db.select().from(incidents).where(and(...conds)).orderBy(desc(incidents.startedAt)).limit(opts.limit ?? 50).all();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [updates, comps] = await Promise.all([
    db.select().from(incidentUpdates).where(inArray(incidentUpdates.incidentId, ids)).orderBy(desc(incidentUpdates.createdAt)).all(),
    db.select().from(incidentComponents).where(inArray(incidentComponents.incidentId, ids)).all(),
  ]);
  return rows.map((inc) => ({
    ...inc,
    updates: updates.filter((u) => u.incidentId === inc.id),
    componentIds: comps.filter((c) => c.incidentId === inc.id).map((c) => c.componentId),
  }));
}

/** Assemble everything a public status page needs in ~5 queries. Serialisable. */
export async function loadPublicStatus(db: Database, page: StatusPage, opts: { maxHistoryDays?: number } = {}): Promise<PublicStatus> {
  const now = Date.now();
  const historyDays = Math.min(Math.max(page.historyDays, 7), 90, opts.maxHistoryDays ?? 90);
  const days = lastDays(historyDays, now);
  const [sections, comps] = await Promise.all([
    db.select().from(pageSections).where(eq(pageSections.pageId, page.id)).orderBy(pageSections.position).all(),
    db.select().from(pageComponents).where(eq(pageComponents.pageId, page.id)).orderBy(pageComponents.position).all(),
  ]);
  const monitorIds = [...new Set(comps.map((c) => c.monitorId).filter((x): x is string => !!x))];
  const [mons, stats, active, recent, maint] = await Promise.all([
    monitorIds.length ? db.select().from(monitors).where(inArray(monitors.id, monitorIds)).all() : Promise.resolve([]),
    monitorIds.length ? db.select().from(dailyStats).where(and(inArray(dailyStats.monitorId, monitorIds), gte(dailyStats.day, days[0]!))).all() : Promise.resolve([]),
    loadIncidentsForPage(db, page.id, { onlyOpen: true, limit: 20 }),
    loadIncidentsForPage(db, page.id, { sinceMs: now - 14 * DAY, limit: 30 }),
    db.select().from(maintenances).where(and(eq(maintenances.pageId, page.id), gte(maintenances.endsAt, now), lte(maintenances.startsAt, now + 30 * DAY))).orderBy(maintenances.startsAt).all(),
  ]);
  const monById = new Map(mons.map((m) => [m.id, m]));
  const activeMaint = maint.filter((m) => m.startsAt <= now && m.endsAt >= now);
  const upcomingMaint = maint.filter((m) => m.startsAt > now);
  const maintComponentIds = new Set(activeMaint.flatMap((m) => m.componentIds));

  const components: PublicComponent[] = comps.map((c) => {
    const m = c.monitorId ? monById.get(c.monitorId) : undefined;
    const rows = m ? stats.filter((s) => s.monitorId === m.id) : [];
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const history: PublicHistoryDay[] = days.map((day) => {
      const r = byDay.get(day);
      if (!r) return { day, uptime: null, checks: 0, failures: 0, avgLatency: null, downtimeSec: 0, playersPeak: 0 };
      const ok = r.checks - r.failures;
      return { day, uptime: pct(r.checks, r.failures), checks: r.checks, failures: r.failures, avgLatency: ok ? Math.round(r.latencySum / ok) : null, downtimeSec: r.downtimeSec, playersPeak: r.playersPeak };
    });
    const window = (n: number) => {
      const slice = history.slice(-n);
      const checks = slice.reduce((a, d) => a + d.checks, 0);
      const failures = slice.reduce((a, d) => a + d.failures, 0);
      return pct(checks, failures);
    };
    const def = m ? getProbe(m.type) : undefined;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      sectionId: c.sectionId,
      position: c.position,
      display: c.display,
      state: componentState(m?.status, maintComponentIds.has(c.id)),
      monitor: m ? {
        id: m.id, type: m.type, typeName: def?.name ?? m.type, badge: def?.badge ?? null, status: m.status,
        intervalSec: m.intervalSec,
        lastCheckedAt: m.lastCheckedAt, lastLatencyMs: m.lastLatencyMs, lastMessage: m.lastMessage, data: m.lastData,
      } : null,
      history,
      uptime: { d7: window(7), d30: window(30), d90: window(90) },
    };
  });

  // overall
  const states = components.map((c) => c.state);
  const activeImpact = active.map((i) => i.impact);
  let overall: OverallState = "operational";
  if (states.includes("down") || activeImpact.includes("critical") || activeImpact.includes("major")) overall = "down";
  else if (states.includes("degraded") || activeImpact.includes("minor")) overall = "degraded";
  else if (activeMaint.length) overall = "maintenance";
  else if (components.length && states.every((s) => s === "unknown")) overall = "unknown";

  let players: number | null = null;
  let maxPlayers: number | null = null;
  for (const c of components) {
    const d = c.monitor?.data;
    if (d && typeof d.players === "number" && c.monitor?.status !== "down") {
      players = (players ?? 0) + d.players;
      if (typeof d.maxPlayers === "number") maxPlayers = (maxPlayers ?? 0) + d.maxPlayers;
    }
  }

  return {
    page: {
      id: page.id, slug: page.slug, name: page.name, description: page.description, logoUrl: page.logoUrl, faviconUrl: page.faviconUrl,
      theme: page.theme, links: page.links, hero: page.hero, seo: page.seo, historyDays, allowSubscribers: page.allowSubscribers,
      customDomain: page.customDomain, updatedAt: page.updatedAt, protected: !!page.passwordHash,
    },
    sections: sections.map((s) => ({ id: s.id, name: s.name, description: s.description, position: s.position, collapsed: s.collapsed })),
    components,
    activeIncidents: active,
    recentIncidents: recent.filter((i) => i.resolvedAt),
    maintenances: { active: activeMaint, upcoming: upcomingMaint },
    overall: { state: overall, label: STATE_LABEL[overall] },
    totals: { players, maxPlayers, components: components.length, operational: states.filter((s) => s === "operational").length },
    generatedAt: now,
  };
}

/** Markdown rendering of a status page: served to AI agents and at /status.md */
export function statusToMarkdown(s: PublicStatus, absoluteUrl: string): string {
  const lines: string[] = [];
  lines.push(`# ${s.page.name} — Status`);
  if (s.page.description) lines.push("", s.page.description);
  lines.push("", `**${s.overall.label}** (as of ${new Date(s.generatedAt).toISOString()})`);
  if (s.totals.players !== null) lines.push("", `Players online: ${s.totals.players}${s.totals.maxPlayers !== null ? ` / ${s.totals.maxPlayers}` : ""}`);
  if (s.page.hero.connectAddress) lines.push("", `Connect: \`${s.page.hero.connectAddress}\``);
  if (s.activeIncidents.length) {
    lines.push("", "## Active incidents");
    for (const i of s.activeIncidents) {
      lines.push("", `### ${i.title}`, `Status: ${i.status} · Impact: ${i.impact} · Started: ${new Date(i.startedAt).toISOString()}`);
      for (const u of i.updates) lines.push("", `- **${u.status}** (${new Date(u.createdAt).toISOString()}): ${u.body}`);
    }
  }
  if (s.maintenances.active.length || s.maintenances.upcoming.length) {
    lines.push("", "## Maintenance");
    for (const m of [...s.maintenances.active, ...s.maintenances.upcoming]) lines.push(`- ${m.title}: ${new Date(m.startsAt).toISOString()} → ${new Date(m.endsAt).toISOString()}${m.body ? ` — ${m.body}` : ""}`);
  }
  lines.push("", "## Components", "", "| Component | Status | Uptime (30d) | Details |", "|---|---|---|---|");
  const sectionName = (id: string | null) => s.sections.find((x) => x.id === id)?.name;
  for (const c of s.components) {
    const d = c.monitor?.data;
    const details: string[] = [];
    if (d && typeof d.players === "number") details.push(`${d.players}${typeof d.maxPlayers === "number" ? `/${d.maxPlayers}` : ""} players`);
    if (d && typeof d.version === "string") details.push(String(d.version));
    if (c.monitor?.lastLatencyMs !== null && c.monitor?.lastLatencyMs !== undefined) details.push(`${c.monitor.lastLatencyMs} ms`);
    const group = sectionName(c.sectionId);
    lines.push(`| ${group ? `${group} / ` : ""}${c.name} | ${c.state} | ${c.uptime.d30 === null ? "n/a" : `${c.uptime.d30}%`} | ${details.join(", ")} |`);
  }
  if (s.recentIncidents.length) {
    lines.push("", "## Recently resolved");
    for (const i of s.recentIncidents.slice(0, 10)) lines.push(`- ${i.title} (${new Date(i.startedAt).toISOString().slice(0, 10)}, ${i.impact})`);
  }
  lines.push("", "---", `JSON: ${absoluteUrl}/status.json · RSS: ${absoluteUrl}/feed.xml · HTML: ${absoluteUrl}`);
  return lines.join("\n") + "\n";
}
