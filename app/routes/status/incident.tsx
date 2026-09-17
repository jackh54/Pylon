import { Link, data } from "react-router";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/incident";
import { findShellData, useStatusLayout, statusMeta } from "./_shared";
import { Badge, toneFor } from "~/components/ui";
import { Markdown } from "~/lib/markdown";
import { formatDate, formatDuration } from "~/lib/format";
import { getDb } from "~/lib/server";
import { resolvePublicPage } from "~/lib/public.server";
import { incidentComponents, incidentUpdates, incidents, pageComponents } from "@server/db/schema";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  if (ctx.gated) throw data("Not found", { status: 404 });
  const db = getDb(context);
  const inc = await db.select().from(incidents).where(and(eq(incidents.id, params.id), eq(incidents.pageId, ctx.page.id))).get();
  if (!inc) throw data("Incident not found", { status: 404 });
  const [updates, comps] = await Promise.all([
    db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, inc.id)).orderBy(asc(incidentUpdates.createdAt)).all(),
    db.select({ id: incidentComponents.componentId }).from(incidentComponents).where(eq(incidentComponents.incidentId, inc.id)).all(),
  ]);
  const names = comps.length ? await db.select({ name: pageComponents.name }).from(pageComponents).where(inArray(pageComponents.id, comps.map((c) => c.id))).all() : [];
  return data({ incident: inc, updates, components: names.map((n) => n.name) }, { headers: { "Cache-Control": ctx.page.passwordHash ? "private, no-store" : "public, max-age=0, s-maxage=20" } });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const shell = findShellData(matches);
  if (!shell?.status || !loaderData) return [{ title: "Incident" }];
  const s = shell.status;
  const layout = { loaderData: { site: shell.canonical } };
  const inc = loaderData.incident;
  const last = loaderData.updates[loaderData.updates.length - 1];
  return [
    ...statusMeta(s, layout.loaderData.site, `/incidents/${inc.id}`, { title: `${inc.title} — ${s.page.name} Status`, description: last ? last.body.slice(0, 200) : inc.title }),
    { "script:ld+json": { "@context": "https://schema.org", "@type": "NewsArticle", headline: inc.title, datePublished: new Date(inc.startedAt).toISOString(), dateModified: new Date(inc.updatedAt).toISOString(), articleSection: "Incidents", author: { "@type": "Organization", name: s.page.name }, publisher: { "@type": "Organization", name: s.page.name }, mainEntityOfPage: `${layout.loaderData.site}/incidents/${inc.id}`, description: last?.body.slice(0, 300) } },
  ];
};

export default function StatusIncident({ loaderData }: Route.ComponentProps) {
  const { basePath } = useStatusLayout();
  const { incident: inc, updates, components } = loaderData;
  return (
    <article className="space-y-6">
      <div>
        <Link to={`${basePath}/incidents`} className="text-xs text-fg-muted hover:text-fg">← Incident history</Link>
        <h1 className="mt-2 text-2xl font-semibold">{inc.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge tone={toneFor(inc.status)}>{inc.status}</Badge><Badge tone={toneFor(inc.impact)}>{inc.impact} impact</Badge>
          <span>Started <time dateTime={new Date(inc.startedAt).toISOString()}>{formatDate(inc.startedAt)}</time></span>
          {inc.resolvedAt && <span>· Resolved after {formatDuration(inc.resolvedAt - inc.startedAt)}</span>}
        </p>
        {components.length > 0 && <p className="mt-2 text-xs text-fg-muted">Affected: {components.join(", ")}</p>}
      </div>
      <ol className="card divide-y divide-line">
        {[...updates].reverse().map((u) => (
          <li key={u.id} className="px-5 py-4">
            <p className="text-xs text-fg-muted"><span className="font-medium capitalize text-fg">{u.status}</span> · <time dateTime={new Date(u.createdAt).toISOString()}>{formatDate(u.createdAt)}</time></p>
            <Markdown text={u.body} className="prose-doc mt-1 [&_p]:my-1 [&_p]:text-sm" />
          </li>
        ))}
      </ol>
    </article>
  );
}
