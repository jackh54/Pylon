import { eq } from "drizzle-orm";
import type { Route } from "./+types/llms";
import { appUrl, getCf, getDb, text } from "~/lib/server";
import { statusPages } from "@server/db/schema";
import { DOCS } from "~/lib/docs";
import { pageBaseUrl } from "@server/services/page-url";
import { BRAND } from "~/lib/brand";

/** llms.txt (https://llmstxt.org): a curated index for LLM agents. Scoped to the page on custom domains. */
export async function loader({ context }: Route.LoaderArgs) {
  const cf = getCf(context);
  const db = getDb(context);
  const site = appUrl(context);
  const out: string[] = [];
  if (cf.customDomainSlug) {
    const page = await db.select().from(statusPages).where(eq(statusPages.slug, cf.customDomainSlug)).get();
    if (page) {
      const base = `https://${page.customDomain}`;
      out.push(`# ${page.name} Status`, "", `> ${page.description ?? `Live service status, player counts and incident history for ${page.name}.`}`, "",
        "This site is a status page. Fetch the Markdown or JSON twin for a compact, always-current snapshot.", "",
        "## Status", "", `- [Current status (Markdown)](${base}/status.md): overall state, components, players, incidents`, `- [Current status (JSON)](${base}/status.json): same data, machine-readable`, `- [Incident feed (RSS)](${base}/feed.xml)`, `- [Incident history](${base}/incidents)`, "",
        "## Optional", "", `- [MCP endpoint](${site}/mcp): tools get_status, list_incidents (Streamable HTTP)`, `- [OpenAPI](${site}/api/openapi.json)`);
    }
  } else {
    out.push(`# ${BRAND.name}`, "", `> ${BRAND.description}`, "",
      `${BRAND.name} is an open-source (AGPL-3.0) status page and uptime monitor for game servers, built on Cloudflare Workers. Every status page has Markdown and JSON twins, an RSS feed and a badge. Request any page with \`Accept: text/markdown\` to get Markdown.`, "",
      "## Docs", "");
    for (const d of DOCS) out.push(`- [${d.title}](${site}/docs/${d.slug}.md): ${d.summary.slice(0, 120)}`);
    out.push("", "## API", "", `- [OpenAPI 3.1 spec](${site}/api/openapi.json)`, `- [MCP endpoint](${site}/mcp): Streamable HTTP, tools: list_status_pages, get_status, list_incidents`, `- Public status JSON: \`${site}/api/v1/status/{slug}\``, "");
    const pages = await db.select({ name: statusPages.name, slug: statusPages.slug, description: statusPages.description, customDomain: statusPages.customDomain, customDomainVerifiedAt: statusPages.customDomainVerifiedAt, seo: statusPages.seo, passwordHash: statusPages.passwordHash }).from(statusPages).where(eq(statusPages.published, true)).limit(500).all();
    const visible = pages.filter((p) => !p.seo.noindex && !p.passwordHash && p.seo.aiPolicy !== "disallow");
    if (visible.length) {
      out.push("## Status pages", "");
      for (const p of visible) {
        const base = pageBaseUrl(site, p);
        out.push(`- [${p.name}](${base}/status.md): ${p.description ?? "live status"}`);
      }
    }
    out.push("", "## Optional", "", `- [Full docs and every status page in one file](${site}/llms-full.txt)`, `- [Source code](${BRAND.repo})`);
  }
  return text(out.join("\n") + "\n", "text/markdown; charset=utf-8", { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } });
}
