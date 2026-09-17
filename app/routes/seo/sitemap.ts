import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/sitemap";
import { appUrl, getCf, getDb, text } from "~/lib/server";
import { incidents, statusPages } from "@server/db/schema";
import { pageBaseUrl } from "@server/services/page-url";
import { DOCS } from "~/lib/docs";

const url = (loc: string, lastmod?: number, changefreq = "hourly", priority = "0.8") => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

export async function loader({ context }: Route.LoaderArgs) {
  const cf = getCf(context);
  const db = getDb(context);
  const site = appUrl(context);
  const entries: string[] = [];
  if (cf.customDomainSlug) {
    const page = await db.select().from(statusPages).where(eq(statusPages.slug, cf.customDomainSlug)).get();
    if (page && page.published && !page.seo.noindex) {
      const base = `https://${page.customDomain}`;
      entries.push(url(`${base}/`, page.updatedAt, "hourly", "1.0"), url(`${base}/incidents`, page.updatedAt, "daily", "0.6"));
      const incs = await db.select({ id: incidents.id, updatedAt: incidents.updatedAt }).from(incidents).where(eq(incidents.pageId, page.id)).orderBy(desc(incidents.startedAt)).limit(200).all();
      for (const i of incs) entries.push(url(`${base}/incidents/${i.id}`, i.updatedAt, "weekly", "0.4"));
    }
  } else {
    entries.push(url(`${site}/`, undefined, "weekly", "1.0"));
    for (const d of DOCS) entries.push(url(`${site}/docs/${d.slug}`, undefined, "weekly", "0.7"));
    const pages = await db.select().from(statusPages).where(eq(statusPages.published, true)).limit(5000).all();
    for (const p of pages) {
      if (p.seo.noindex || p.passwordHash) continue;
      const base = pageBaseUrl(site, p);
      entries.push(url(base, p.updatedAt, "hourly", "0.8"), url(`${base}/incidents`, p.updatedAt, "daily", "0.5"));
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;
  return text(xml, "application/xml; charset=utf-8", { headers: { "Cache-Control": "public, max-age=0, s-maxage=600" } });
}
