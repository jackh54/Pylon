import type { Route } from "./+types/feed";
import { text } from "~/lib/server";
import { publicHeaders, resolvePublicPage } from "~/lib/public.server";
import { getDb } from "~/lib/server";
import { loadIncidentsForPage } from "@server/services/status";
import { data } from "react-router";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  if (ctx.gated) throw data("Unauthorized", { status: 401 });
  const incidents = await loadIncidentsForPage(getDb(context), ctx.page.id, { limit: 50 });
  const items = incidents.map((i) => {
    const latest = i.updates[0];
    const body = i.updates.map((u) => `<p><strong>${esc(u.status)}</strong> — ${esc(new Date(u.createdAt).toUTCString())}<br/>${esc(u.body)}</p>`).join("");
    return `<item>
  <title>${esc(`[${i.status}] ${i.title}`)}</title>
  <link>${ctx.site}/incidents/${i.id}</link>
  <guid isPermaLink="false">${i.id}:${i.updates.length}</guid>
  <pubDate>${new Date(latest?.createdAt ?? i.startedAt).toUTCString()}</pubDate>
  <category>${esc(i.impact)}</category>
  <description><![CDATA[${body}]]></description>
</item>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(ctx.page.name)} — Incidents</title>
  <link>${ctx.site}</link>
  <atom:link href="${ctx.site}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(ctx.page.description ?? `Incident history for ${ctx.page.name}`)}</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <generator>Pylon</generator>
${items}
</channel>
</rss>`;
  return text(xml, "application/rss+xml; charset=utf-8", { headers: publicHeaders(!!ctx.page.passwordHash) });
}
