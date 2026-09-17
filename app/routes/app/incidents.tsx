import { Link } from "react-router";
import { desc, eq } from "drizzle-orm";
import { Plus, Siren } from "lucide-react";
import type { Route } from "./+types/incidents";
import { Badge, EmptyState, PageHeader, Table, Td, Th, toneFor } from "~/components/ui";
import { formatDate, relativeTime } from "~/lib/format";
import { getDb, requireAuth } from "~/lib/server";
import { incidents, statusPages } from "@server/db/schema";

export const meta: Route.MetaFunction = () => [{ title: "Incidents — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const rows = await db.select({ incident: incidents, pageName: statusPages.name, pageSlug: statusPages.slug }).from(incidents).leftJoin(statusPages, eq(statusPages.id, incidents.pageId)).where(eq(incidents.orgId, auth.org.id)).orderBy(desc(incidents.startedAt)).limit(100).all();
  return { now: Date.now(), canEdit: auth.org.role !== "viewer", incidents: rows.map((r) => ({ ...r.incident, pageName: r.pageName, pageSlug: r.pageSlug })) };
}

export default function Incidents({ loaderData }: Route.ComponentProps) {
  const { incidents: rows, now, canEdit } = loaderData;
  const open = rows.filter((r) => !r.resolvedAt);
  const closed = rows.filter((r) => r.resolvedAt);
  const list = (items: typeof rows) => (
    <Table>
      <thead><tr><Th>Incident</Th><Th className="hidden sm:table-cell">Page</Th><Th>Status</Th><Th className="hidden md:table-cell">Impact</Th><Th>Started</Th></tr></thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="hover:bg-surface-2/40">
            <Td><Link to={`/app/incidents/${i.id}`} className="font-medium hover:underline">{i.title}</Link>{i.auto && <Badge className="ml-2">auto</Badge>}</Td>
            <Td className="hidden sm:table-cell text-fg-muted">{i.pageName ?? "—"}</Td>
            <Td><Badge tone={toneFor(i.status)}>{i.status}</Badge></Td>
            <Td className="hidden md:table-cell"><Badge tone={toneFor(i.impact)}>{i.impact}</Badge></Td>
            <Td className="text-xs text-fg-muted whitespace-nowrap" ><span title={formatDate(i.startedAt)}>{relativeTime(i.startedAt, now)}</span></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
  return (
    <>
      <PageHeader title="Incidents" description="Communicate outages and maintenance to your players." actions={canEdit && <Link to="/app/incidents/new" className="btn-primary btn-sm"><Plus className="size-4" />New incident</Link>} />
      {rows.length === 0 ? <EmptyState icon={<Siren className="size-5" />} title="No incidents" description="Monitors open incidents automatically when a component goes down. You can also post manual updates or schedule maintenance." /> : (
        <div className="space-y-8">
          {open.length > 0 && <section><h2 className="mb-2 text-sm font-medium text-fg-muted">Open ({open.length})</h2>{list(open)}</section>}
          {closed.length > 0 && <section><h2 className="mb-2 text-sm font-medium text-fg-muted">Resolved</h2>{list(closed)}</section>}
        </div>
      )}
    </>
  );
}
