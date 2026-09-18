/**
 * Pylon database schema (Cloudflare D1 / SQLite via Drizzle).
 *
 * Design notes:
 * - Raw heartbeats (one row per check) live inside each monitor's Durable Object SQLite,
 *   not in D1. D1 only stores the current snapshot on `monitors` plus per-day rollups in
 *   `daily_stats`. This keeps D1 write volume tiny and lets a status page render 90 days of
 *   uptime bars from a handful of rows.
 * - All timestamps are unix epoch milliseconds (integer) for cheap comparisons.
 * - JSON columns are typed through `$type<>()` and validated with zod at the boundary.
 */
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = () => sql`(unixepoch('subsec') * 1000)`;

export type MonitorStatus = "up" | "down" | "degraded" | "pending" | "paused";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export type IncidentImpact = "none" | "minor" | "major" | "critical";
export type OrgRole = "owner" | "admin" | "member" | "viewer";

/* ---------------------------------- auth ---------------------------------- */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  discordId: text("discord_id"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
  uniqueIndex("users_discord_idx").on(t.discordId),
]);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(now()),
  userAgent: text("user_agent"),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/* ---------------------------------- orgs ---------------------------------- */

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [uniqueIndex("orgs_slug_idx").on(t.slug)]);

export const orgMembers = sqliteTable("org_members", {
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<OrgRole>().notNull().default("member"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("org_members_user_idx").on(t.userId)]);

export const orgInvites = sqliteTable("org_invites", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<OrgRole>().notNull().default("member"),
  token: text("token").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [uniqueIndex("org_invites_token_idx").on(t.token)]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // first 8 chars, shown in UI
  keyHash: text("key_hash").notNull(), // sha256
  scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default(sql`'["read"]'`),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)]);

/* --------------------------------- relays --------------------------------- */

/** A relay is a self-hosted probe runner (Node, runs GameDig + UDP protocols) that pulls
 *  its assigned monitors and pushes results. Lets Pylon monitor protocols the edge can't. */
export const relays = sqliteTable("relays", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  region: text("region").notNull().default("default"),
  tokenHash: text("token_hash").notNull(),
  lastSeenAt: integer("last_seen_at"),
  version: text("version"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [uniqueIndex("relays_token_idx").on(t.tokenHash), index("relays_org_idx").on(t.orgId)]);

/* -------------------------------- monitors -------------------------------- */

export interface MonitorSnapshot {
  /** Latest probe payload, e.g. { players: 12, maxPlayers: 100, version: "1.21.4", motd: "..." } */
  [key: string]: unknown;
}

export const monitors = sqliteTable("monitors", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Probe type id from server/probes registry: http, tcp, minecraft-java, source, fivem, heartbeat, ... */
  type: text("type").notNull(),
  /** Probe-specific config, validated against the probe's zod schema. */
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  intervalSec: integer("interval_sec").notNull().default(60),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  /** consecutive failures required before flipping to down */
  retries: integer("retries").notNull().default(2),
  /** "degraded" if latency exceeds this (ms). null = disabled */
  degradedLatencyMs: integer("degraded_latency_ms"),
  /** where the check runs: "edge" (Cloudflare) or a relay id */
  runner: text("runner").notNull().default("edge"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status").$type<MonitorStatus>().notNull().default("pending"),
  lastCheckedAt: integer("last_checked_at"),
  lastChangedAt: integer("last_changed_at"),
  lastLatencyMs: integer("last_latency_ms"),
  lastMessage: text("last_message"),
  lastData: text("last_data", { mode: "json" }).$type<MonitorSnapshot>(),
  /** secret for push/heartbeat monitors */
  pushToken: text("push_token"),
  createdAt: integer("created_at").notNull().default(now()),
  updatedAt: integer("updated_at").notNull().default(now()),
}, (t) => [index("monitors_org_idx").on(t.orgId), uniqueIndex("monitors_push_token_idx").on(t.pushToken)]);

/** One row per monitor per UTC day. Written by the monitor's Durable Object. */
export const dailyStats = sqliteTable("daily_stats", {
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  /** YYYY-MM-DD (UTC) */
  day: text("day").notNull(),
  checks: integer("checks").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  degraded: integer("degraded").notNull().default(0),
  /** sum of latencies for successful checks (avg = latencySum / (checks - failures)) */
  latencySum: integer("latency_sum").notNull().default(0),
  latencyMax: integer("latency_max").notNull().default(0),
  /** for game servers: peak + summed player counts so we can chart avg/peak players */
  playersPeak: integer("players_peak").notNull().default(0),
  playersSum: integer("players_sum").notNull().default(0),
  /** seconds of downtime attributed to this day (from state transitions) */
  downtimeSec: integer("downtime_sec").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.monitorId, t.day] })]);

/** Status transitions (up -> down etc). Small table; drives incident auto-creation + history. */
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  fromStatus: text("from_status").$type<MonitorStatus>().notNull(),
  toStatus: text("to_status").$type<MonitorStatus>().notNull(),
  message: text("message"),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [index("events_monitor_idx").on(t.monitorId, t.createdAt)]);

/* ------------------------------ status pages ------------------------------ */

export interface StatusPageTheme {
  /** "system" | "light" | "dark" */
  mode: "system" | "light" | "dark";
  /** hex accent, e.g. "#22c55e" */
  accent: string;
  /** optional hex background override */
  background?: string;
  /** "rounded" | "sharp" | "pill" */
  radius: "rounded" | "sharp" | "pill";
  /** "bars" | "dots" | "line" – how the 90-day history renders */
  historyStyle: "bars" | "dots";
  font?: "inter" | "system" | "mono";
  customCss?: string;
  /** remove the "Powered by" footer (plan-gated on hosted instances) */
  hideBranding?: boolean;
}

export interface StatusPageLinks {
  website?: string;
  discord?: string;
  store?: string;
  twitter?: string;
  github?: string;
  /** free-form extra links */
  extra?: { label: string; url: string }[];
}

export interface StatusPageHero {
  /** Big "connect" block: e.g. play.example.com with copy button */
  connectAddress?: string;
  connectLabel?: string;
  tagline?: string;
  showPlayers?: boolean;
  bannerUrl?: string;
}

export interface StatusPageSeo {
  title?: string;
  description?: string;
  keywords?: string[];
  /** disallow search indexing */
  noindex?: boolean;
  /** explicit AI crawler policy for robots.txt / Content-Signal */
  aiPolicy?: "allow" | "search-only" | "disallow";
  ogImageUrl?: string;
}

export const statusPages = sqliteTable("status_pages", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  customDomain: text("custom_domain"),
  /** set once DNS for customDomain points at this instance; only verified domains are served */
  customDomainVerifiedAt: integer("custom_domain_verified_at"),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  theme: text("theme", { mode: "json" }).$type<StatusPageTheme>().notNull().default(sql`'{"mode":"system","accent":"#22c55e","radius":"rounded","historyStyle":"bars"}'`),
  links: text("links", { mode: "json" }).$type<StatusPageLinks>().notNull().default(sql`'{}'`),
  hero: text("hero", { mode: "json" }).$type<StatusPageHero>().notNull().default(sql`'{}'`),
  seo: text("seo", { mode: "json" }).$type<StatusPageSeo>().notNull().default(sql`'{}'`),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  /** optional password for private pages (sha256) */
  passwordHash: text("password_hash"),
  historyDays: integer("history_days").notNull().default(90),
  allowSubscribers: integer("allow_subscribers", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().default(now()),
  updatedAt: integer("updated_at").notNull().default(now()),
}, (t) => [
  uniqueIndex("status_pages_slug_idx").on(t.slug),
  uniqueIndex("status_pages_domain_idx").on(t.customDomain),
  index("status_pages_org_idx").on(t.orgId),
]);

export const pageSections = sqliteTable("page_sections", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => statusPages.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
}, (t) => [index("page_sections_page_idx").on(t.pageId)]);

export interface ComponentDisplay {
  showLatency?: boolean;
  showPlayers?: boolean;
  showVersion?: boolean;
  showHistory?: boolean;
  /** extra snapshot keys to render as chips, e.g. ["map","tps"] */
  fields?: string[];
  /**
   * Include this component's players in the page's "Players online" total. Turn off for backend
   * servers behind a proxy, whose players are already counted by the proxy's component.
   */
  countInTotal?: boolean;
}

export const pageComponents = sqliteTable("page_components", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => statusPages.id, { onDelete: "cascade" }),
  sectionId: text("section_id").references(() => pageSections.id, { onDelete: "set null" }),
  monitorId: text("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  display: text("display", { mode: "json" }).$type<ComponentDisplay>().notNull().default(sql`'{"showLatency":true,"showPlayers":true,"showHistory":true}'`),
}, (t) => [index("page_components_page_idx").on(t.pageId), index("page_components_monitor_idx").on(t.monitorId)]);

/* -------------------------------- incidents ------------------------------- */

export const incidents = sqliteTable("incidents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pageId: text("page_id").references(() => statusPages.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").$type<IncidentStatus>().notNull().default("investigating"),
  impact: text("impact").$type<IncidentImpact>().notNull().default("minor"),
  /** true when opened automatically by a monitor going down */
  auto: integer("auto", { mode: "boolean" }).notNull().default(false),
  monitorId: text("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
  startedAt: integer("started_at").notNull().default(now()),
  resolvedAt: integer("resolved_at"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(now()),
  updatedAt: integer("updated_at").notNull().default(now()),
}, (t) => [index("incidents_page_idx").on(t.pageId, t.startedAt), index("incidents_org_idx").on(t.orgId)]);

export const incidentUpdates = sqliteTable("incident_updates", {
  id: text("id").primaryKey(),
  incidentId: text("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  status: text("status").$type<IncidentStatus>().notNull(),
  /** markdown (restricted subset) */
  body: text("body").notNull(),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [index("incident_updates_incident_idx").on(t.incidentId, t.createdAt)]);

export const incidentComponents = sqliteTable("incident_components", {
  incidentId: text("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  componentId: text("component_id").notNull().references(() => pageComponents.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.incidentId, t.componentId] })]);

export const maintenances = sqliteTable("maintenances", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => statusPages.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  startsAt: integer("starts_at").notNull(),
  endsAt: integer("ends_at").notNull(),
  componentIds: text("component_ids", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [index("maintenances_page_idx").on(t.pageId, t.startsAt)]);

/* ------------------------------ notifications ----------------------------- */

export type ChannelType = "discord" | "slack" | "webhook" | "email" | "telegram";

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").$type<ChannelType>().notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** if true, every monitor in the org alerts here without explicit linking */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [index("channels_org_idx").on(t.orgId)]);

export const monitorChannels = sqliteTable("monitor_channels", {
  monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.monitorId, t.channelId] })]);

/** Public status-page subscribers (email / webhook). */
export const subscribers = sqliteTable("subscribers", {
  id: text("id").primaryKey(),
  pageId: text("page_id").notNull().references(() => statusPages.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"email" | "webhook" | "discord">().notNull(),
  target: text("target").notNull(),
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  token: text("token").notNull(),
  createdAt: integer("created_at").notNull().default(now()),
}, (t) => [uniqueIndex("subscribers_token_idx").on(t.token), index("subscribers_page_idx").on(t.pageId)]);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type StatusPage = typeof statusPages.$inferSelect;
export type PageSection = typeof pageSections.$inferSelect;
export type PageComponent = typeof pageComponents.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type IncidentUpdate = typeof incidentUpdates.$inferSelect;
export type Maintenance = typeof maintenances.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type DailyStat = typeof dailyStats.$inferSelect;
export type Relay = typeof relays.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
