import type { Route } from "./+types/openapi";
import { appUrl, json } from "~/lib/server";
import { probeCatalog } from "@server/probes/registry";

export function loader({ context }: Route.LoaderArgs) {
  const site = appUrl(context);
  const spec = {
    openapi: "3.1.0",
    info: { title: "Pylon API", version: "1.0.0", description: "Public status data, push heartbeats and read access to monitors. Status pages also expose /status.json, /status.md, /feed.xml and /badge.svg.", license: { name: "AGPL-3.0", url: "https://www.gnu.org/licenses/agpl-3.0.html" } },
    servers: [{ url: site }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "Organization API key (pyl_…), created under Settings." }, relayToken: { type: "http", scheme: "bearer", description: "Relay token (prl_…)" } },
      schemas: {
        PublicStatus: { type: "object", description: "Snapshot of a status page", properties: { page: { type: "object" }, overall: { type: "object", properties: { state: { type: "string", enum: ["operational", "degraded", "down", "maintenance", "unknown"] }, label: { type: "string" } } }, components: { type: "array", items: { type: "object" } }, activeIncidents: { type: "array", items: { type: "object" } }, totals: { type: "object", properties: { players: { type: ["integer", "null"] }, maxPlayers: { type: ["integer", "null"] } } }, generatedAt: { type: "integer" } } },
        ProbeResult: { type: "object", properties: { ok: { type: "boolean" }, latencyMs: { type: "integer" }, message: { type: "string" }, data: { type: "object" }, error: { type: "string" } }, required: ["ok"] },
      },
    },
    paths: {
      "/api/v1/status/{slug}": { get: { summary: "Public status snapshot", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/PublicStatus" } } } }, "404": { description: "Unknown page" } } } },
      "/s/{slug}/status.md": { get: { summary: "Markdown twin of a status page (also served for Accept: text/markdown on /s/{slug})", responses: { "200": { description: "Markdown", content: { "text/markdown": {} } } } } },
      "/api/push/{token}": {
        get: { summary: "Heartbeat ping", parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string", enum: ["up", "down"] } }, { name: "msg", in: "query", schema: { type: "string" } }, { name: "latency", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Accepted" } } },
        post: { summary: "Heartbeat with metrics", requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["up", "down"] }, msg: { type: "string" }, latency: { type: "integer" }, players: { type: "integer" }, maxPlayers: { type: "integer" }, tps: { type: "number" } }, additionalProperties: true } } } }, responses: { "200": { description: "Accepted" } } },
      },
      "/api/v1/monitors": { get: { summary: "List monitors of the organization", security: [{ apiKey: [] }], responses: { "200": { description: "OK" } } } },
      "/api/v1/monitors/{id}/history": { get: { summary: "Raw check history of a monitor", security: [{ apiKey: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "hours", in: "query", schema: { type: "integer", default: 24 } }], responses: { "200": { description: "OK" } } } },
      "/api/relay/config": { get: { summary: "Relay: fetch assigned monitors", security: [{ relayToken: [] }], responses: { "200": { description: "OK" } } } },
      "/api/relay/results": { post: { summary: "Relay: submit check results", security: [{ relayToken: [] }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { results: { type: "array", items: { allOf: [{ $ref: "#/components/schemas/ProbeResult" }, { type: "object", properties: { monitorId: { type: "string" } }, required: ["monitorId"] }] } } } } } } }, responses: { "200": { description: "OK" } } } },
      "/mcp": { post: { summary: "Model Context Protocol endpoint (Streamable HTTP, stateless)", description: "Tools: list_status_pages, get_status(slug), list_incidents(slug, limit, includeResolved).", responses: { "200": { description: "JSON-RPC response" } } } },
    },
    "x-monitor-types": probeCatalog().map((p) => ({ id: p.id, name: p.name, runsOn: p.runsOn, fields: p.fields.map((f) => f.key) })),
  };
  return json(spec, { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
