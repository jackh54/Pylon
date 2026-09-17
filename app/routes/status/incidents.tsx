import { Link, data } from "react-router";
import type { Route } from "./+types/incidents";
import { findShellData, useStatusLayout, statusMeta } from "./_shared";
import { Badge, toneFor } from "~/components/ui";
import { formatDate } from "~/lib/format";
import { getDb } from "~/lib/server";
import { resolvePublicPage } from "~/lib/public.server";
import { loadIncidentsForPage } from "@server/services/status";
import { DAY } from "@server/lib/time";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  if (ctx.gated) return { incidents: [] };
  const incidents = await loadIncidentsForPage(getDb(context), ctx.page.id, { sinceMs: Date.now() - 90 * DAY, limit: 200 });
  return data({ incidents }, { headers: { "Cache-Control": ctx.page.passwordHash ? "private, no-store" : "public, max-age=0, s-maxage=20" } });
}

export const meta: Route.MetaFunction = ({ matches }) => {
  const shell = findShellData(matches);
  if (!shell?.status) return [{ title: "Incident history" }];
  const s = shell.status;
  const layout = { loaderData: { site: shell.canonical } };
  return [...statusMeta(s, layout.loaderData.site, "/incidents", { title: `Incident history — ${s.page.name}`, description: `Past incidents and maintenance for ${s.page.name} over the last 90 days.` }),
    { "script:ld+json": { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Status", item: layout.loaderData.site }, { "@type": "ListItem", position: 2, name: "Incident history", item: `${layout.loaderData.site}/incidents` }] } }];
};

export default function StatusIncidents({ loaderData }: Route.ComponentProps) {
  const { basePath } = useStatusLayout();
  const groups = new Map<string, typeof loaderData.incidents>();
  for (const i of loaderData.incidents) {
    const key = new Date(i.startedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return (
    <div className="space-y-8">
      <div><Link to={basePath || "/"} className="text-xs text-fg-muted hover:text-fg">← Current status</Link><h1 className="mt-2 text-2xl font-semibold">Incident history</h1><p className="text-sm text-fg-muted">Last 90 days</p></div>
      {groups.size === 0 && <p className="card px-5 py-6 text-sm text-fg-muted">No incidents in the last 90 days. 🎉</p>}
      {[...groups.entries()].map(([month, items]) => (
        <section key={month}>
          <h2 className="mb-3 text-sm font-medium text-fg-muted">{month}</h2>
          <ul className="card divide-y divide-line">
            {items.map((i) => (
              <li key={i.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={toneFor(i.impact)}>{i.impact}</Badge>
                  <Link to={`${basePath}/incidents/${i.id}`} className="font-medium hover:underline">{i.title}</Link>
                  <Badge tone={toneFor(i.status)} className="ml-auto">{i.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-fg-muted"><time dateTime={new Date(i.startedAt).toISOString()}>{formatDate(i.startedAt)}</time>{i.resolvedAt && <> → resolved <time dateTime={new Date(i.resolvedAt).toISOString()}>{formatDate(i.resolvedAt)}</time></>}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
