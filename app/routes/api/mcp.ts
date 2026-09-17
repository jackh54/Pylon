import { eq } from "drizzle-orm";
import type { Route } from "./+types/mcp";
import { appUrl, getDb, json } from "~/lib/server";
import { statusPages } from "@server/db/schema";
import { findPage, loadIncidentsForPage, loadPublicStatus, statusToMarkdown } from "@server/services/status";
import { BRAND } from "~/lib/brand";
import { pageBaseUrl } from "@server/services/page-url";
import { DAY } from "@server/lib/time";

/**
 * Minimal, stateless Model Context Protocol server over Streamable HTTP (spec 2025-06-18).
 * Lets AI agents ask "is play.example.gg up?" without scraping. No auth: only public data is exposed.
 */
const PROTOCOL = "2025-06-18";

const TOOLS = [
  { name: "list_status_pages", description: "List public status pages hosted on this Pylon instance with their slugs.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_status", description: "Get the current status of a status page: overall state, components with uptime and live game data (players, version, map), active incidents and maintenance. Returns Markdown plus structured JSON.", inputSchema: { type: "object", properties: { slug: { type: "string", description: "Status page slug (from list_status_pages) or custom domain" } }, required: ["slug"] } },
  { name: "list_incidents", description: "List incidents for a status page, newest first.", inputSchema: { type: "object", properties: { slug: { type: "string" }, limit: { type: "integer", default: 10, maximum: 50 }, includeResolved: { type: "boolean", default: true }, days: { type: "integer", default: 90 } }, required: ["slug"] } },
];

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "content-type, mcp-session-id, mcp-protocol-version, authorization", "Access-Control-Expose-Headers": "mcp-session-id", "Cache-Control": "no-store" };

async function resolve(context: Route.ActionArgs["context"], slugOrDomain: string) {
  const db = getDb(context);
  const s = slugOrDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const page = (await findPage(db, s)) ?? (await db.select().from(statusPages).where(eq(statusPages.customDomain, s)).get());
  if (!page || !page.published || page.passwordHash || page.seo.aiPolicy === "disallow") return null;
  return page;
}

async function callTool(context: Route.ActionArgs["context"], name: string, args: Record<string, unknown>) {
  const db = getDb(context);
  const site = appUrl(context);
  const textResult = (text: string, structuredContent?: unknown) => ({ content: [{ type: "text", text }], ...(structuredContent ? { structuredContent } : {}) });
  switch (name) {
    case "list_status_pages": {
      const pages = await db.select({ name: statusPages.name, slug: statusPages.slug, description: statusPages.description, customDomain: statusPages.customDomain, customDomainVerifiedAt: statusPages.customDomainVerifiedAt, seo: statusPages.seo, passwordHash: statusPages.passwordHash }).from(statusPages).where(eq(statusPages.published, true)).limit(200).all();
      const list = pages.filter((p) => !p.passwordHash && p.seo.aiPolicy !== "disallow").map((p) => ({ name: p.name, slug: p.slug, url: pageBaseUrl(site, p), description: p.description }));
      return textResult(list.length ? list.map((p) => `- ${p.name} (slug: ${p.slug}) — ${p.url}${p.description ? `: ${p.description}` : ""}`).join("\n") : "No public status pages.", { pages: list });
    }
    case "get_status": {
      const page = await resolve(context, String(args.slug ?? ""));
      if (!page) return { content: [{ type: "text", text: "Status page not found or not public." }], isError: true };
      const status = await loadPublicStatus(db, page);
      const base = pageBaseUrl(site, page);
      return textResult(statusToMarkdown(status, base), { overall: status.overall, totals: status.totals, components: status.components.map((c) => ({ name: c.name, state: c.state, uptime30d: c.uptime.d30, data: c.monitor?.data ?? null, latencyMs: c.monitor?.lastLatencyMs ?? null })), activeIncidents: status.activeIncidents.map((i) => ({ id: i.id, title: i.title, status: i.status, impact: i.impact, startedAt: i.startedAt })), generatedAt: status.generatedAt, url: base });
    }
    case "list_incidents": {
      const page = await resolve(context, String(args.slug ?? ""));
      if (!page) return { content: [{ type: "text", text: "Status page not found or not public." }], isError: true };
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10)));
      const days = Math.min(365, Math.max(1, Number(args.days ?? 90)));
      const incs = await loadIncidentsForPage(db, page.id, { limit, sinceMs: Date.now() - days * DAY, onlyOpen: args.includeResolved === false });
      const base = pageBaseUrl(site, page);
      const md = incs.length ? incs.map((i) => `### ${i.title}\n${i.status} · ${i.impact} · started ${new Date(i.startedAt).toISOString()}${i.resolvedAt ? ` · resolved ${new Date(i.resolvedAt).toISOString()}` : ""}\n${i.updates.map((u) => `- **${u.status}** ${new Date(u.createdAt).toISOString()}: ${u.body}`).join("\n")}\n${base}/incidents/${i.id}`).join("\n\n") : "No incidents in this window.";
      return textResult(md, { incidents: incs.map((i) => ({ id: i.id, title: i.title, status: i.status, impact: i.impact, startedAt: i.startedAt, resolvedAt: i.resolvedAt, updates: i.updates.map((u) => ({ status: u.status, body: u.body, createdAt: u.createdAt })), url: `${base}/incidents/${i.id}` })) });
    }
  }
  return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
}

async function handle(msg: Rpc, context: Route.ActionArgs["context"]) {
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg.id, -32600, "Invalid request");
  switch (msg.method) {
    case "initialize": return ok(msg.id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: BRAND.name, title: `${BRAND.name} status`, version: "1.0.0" }, instructions: "Use list_status_pages to discover slugs, then get_status(slug) for live status or list_incidents(slug) for history." });
    case "ping": return ok(msg.id, {});
    case "tools/list": return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const p = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!p.name) return err(msg.id, -32602, "Missing tool name");
      try { return ok(msg.id, await callTool(context, p.name, p.arguments ?? {})); }
      catch (e) { return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }); }
    }
    case "resources/list": return ok(msg.id, { resources: [] });
    case "prompts/list": return ok(msg.id, { prompts: [] });
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method === "DELETE") return new Response(null, { status: 200, headers: HEADERS });
  let body: Rpc | Rpc[];
  try { body = (await request.json()) as Rpc | Rpc[]; } catch { return json(err(null, -32700, "Parse error"), { status: 400, headers: HEADERS }); }
  const msgs = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(msgs.map((m) => handle(m, context)))).filter((r) => r !== null);
  if (!responses.length) return new Response(null, { status: 202, headers: HEADERS });
  return json(Array.isArray(body) ? responses : responses[0], { headers: { ...HEADERS, "content-type": "application/json" } });
}

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  // No server-initiated stream in this stateless implementation.
  return json({ name: BRAND.name, protocol: "mcp", transport: "streamable-http", protocolVersion: PROTOCOL, tools: TOOLS.map((t) => t.name), hint: "POST JSON-RPC 2.0 messages to this URL." }, { status: 405, headers: { ...HEADERS, Allow: "POST, DELETE, OPTIONS" } });
}
