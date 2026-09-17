import { eq } from "drizzle-orm";
import type { Route } from "./+types/llms-full";
import { appUrl, getCf, getDb, text } from "~/lib/server";
import { statusPages } from "@server/db/schema";
import { loadPublicStatus, statusToMarkdown } from "@server/services/status";
import { DOCS } from "~/lib/docs";
import { pageBaseUrl } from "@server/services/page-url";
import { BRAND } from "~/lib/brand";

export async function loader({ context }: Route.LoaderArgs) {
  const cf = getCf(context);
  const db = getDb(context);
  const site = appUrl(context);
  const out: string[] = [];
  if (cf.customDomainSlug) {
    const page = await db.select().from(statusPages).where(eq(statusPages.slug, cf.customDomainSlug)).get();
    if (page && page.published && !page.passwordHash) out.push(statusToMarkdown(await loadPublicStatus(db, page), `https://${page.customDomain}`));
  } else {
    out.push(`# ${BRAND.name} — full context`, "", BRAND.description, "");
    for (const d of DOCS) out.push("", "---", "", d.body.trim(), "");
    const pages = await db.select().from(statusPages).where(eq(statusPages.published, true)).limit(50).all();
    for (const p of pages) {
      if (p.seo.noindex || p.passwordHash || p.seo.aiPolicy === "disallow") continue;
      const base = pageBaseUrl(site, p);
      out.push("", "---", "", statusToMarkdown(await loadPublicStatus(db, p), base));
    }
  }
  return text(out.join("\n") + "\n", "text/markdown; charset=utf-8", { headers: { "Cache-Control": "public, max-age=0, s-maxage=300" } });
}
