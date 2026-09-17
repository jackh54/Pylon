import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";
import { assertPublicHost } from "../lib/net";

const schema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  expectedStatus: z.string().default("2xx"),
  keyword: z.string().optional(),
  notKeyword: z.string().optional(),
  headers: z.string().optional(),
  body: z.string().optional(),
  jsonPath: z.string().optional(),
  jsonExpected: z.string().optional(),
});
export type HttpConfig = z.infer<typeof schema>;

function statusMatches(status: number, spec: string): boolean {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).some((s) => {
    if (/^\dxx$/i.test(s)) return Math.floor(status / 100) === Number(s[0]);
    const range = s.match(/^(\d{3})-(\d{3})$/);
    if (range) return status >= Number(range[1]) && status <= Number(range[2]);
    return Number(s) === status;
  });
}

function parseHeaders(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.replace(/^\$\.?/, "").split(".").filter(Boolean).reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    const m = key.match(/^(\w+)\[(\d+)\]$/);
    if (m) {
      const inner = (cur as Record<string, unknown>)[m[1]!];
      return Array.isArray(inner) ? inner[Number(m[2])] : undefined;
    }
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

export const httpProbe: ProbeDefinition<HttpConfig> = {
  id: "http",
  name: "HTTP / Website",
  description: "Request a URL and assert on status code, response body keywords or a JSON value.",
  category: "generic",
  icon: "Globe",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { method: "GET", expectedStatus: "2xx" },
  fields: [
    { key: "url", label: "URL", type: "url", placeholder: "https://example.com/health", required: true },
    { key: "method", label: "Method", type: "select", options: [{ value: "GET", label: "GET" }, { value: "HEAD", label: "HEAD" }, { value: "POST", label: "POST" }], half: true },
    { key: "expectedStatus", label: "Expected status", type: "text", placeholder: "2xx or 200,204 or 200-299", half: true },
    { key: "keyword", label: "Body must contain", type: "text", placeholder: "optional" },
    { key: "notKeyword", label: "Body must NOT contain", type: "text", placeholder: "optional" },
    { key: "jsonPath", label: "JSON path", type: "text", placeholder: "data.status", half: true },
    { key: "jsonExpected", label: "Expected JSON value", type: "text", placeholder: "ok", half: true },
    { key: "headers", label: "Headers", type: "textarea", placeholder: "Authorization: Bearer ...\nX-Custom: value" },
    { key: "body", label: "Request body", type: "textarea", placeholder: "for POST" },
  ],
  dataFields: [{ key: "status", label: "HTTP status" }, { key: "size", label: "Bytes", format: "number" }],
  address: (c) => c.url,
  async run(config, ctx) {
    const started = Date.now();
    try {
      assertPublicHost(new URL(config.url).hostname);
      const res = await fetch(config.url, {
        method: config.method,
        headers: { "user-agent": "Pylon-Monitor/1.0 (+https://github.com/jackh54/Pylon)", ...parseHeaders(config.headers) },
        body: config.method === "POST" ? config.body : undefined,
        redirect: "follow",
        signal: ctx.signal,
      });
      const text = config.method === "HEAD" ? "" : await res.text();
      const latencyMs = Date.now() - started;
      const data = { status: res.status, size: text.length };
      if (!statusMatches(res.status, config.expectedStatus)) return fail(`Unexpected HTTP ${res.status} (wanted ${config.expectedStatus})`, { latencyMs, data });
      if (config.keyword && !text.includes(config.keyword)) return fail(`Keyword "${config.keyword}" not found`, { latencyMs, data });
      if (config.notKeyword && text.includes(config.notKeyword)) return fail(`Forbidden keyword "${config.notKeyword}" found`, { latencyMs, data });
      if (config.jsonPath) {
        let value: unknown;
        try { value = getPath(JSON.parse(text), config.jsonPath); } catch { return fail("Response is not valid JSON", { latencyMs, data }); }
        if (config.jsonExpected !== undefined && config.jsonExpected !== "" && String(value) !== config.jsonExpected) {
          return fail(`${config.jsonPath} was ${JSON.stringify(value)}, expected ${config.jsonExpected}`, { latencyMs, data });
        }
        if (value === undefined) return fail(`${config.jsonPath} not present in response`, { latencyMs, data });
      }
      return { ok: true, latencyMs, message: `HTTP ${res.status}`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
