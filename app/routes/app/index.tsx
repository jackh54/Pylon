import { Form, Link, redirect } from "react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { Activity, FileText, Plus, Sparkles, ArrowRight } from "lucide-react";
import type { Route } from "./+types/index";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, StatusDot, SubmitButton, toneFor } from "~/components/ui";
import { ProbeIcon } from "~/components/icons";
import { relativeTime } from "~/lib/format";
import { getDb, getEnv, requireAuth } from "~/lib/server";
import { events, monitors, pageComponents, statusPages } from "@server/db/schema";
import { getProbe } from "@server/probes/registry";
import { seedDemo } from "@server/services/demo";

export const meta: Route.MetaFunction = () => [{ title: "Overview — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const orgId = auth.org.id;
  const [mons, pages, recent] = await Promise.all([
    db.select().from(monitors).where(eq(monitors.orgId, orgId)).orderBy(monitors.name).all(),
    db.select({ page: statusPages, components: sql<number>`(select count(*) from ${pageComponents} where ${pageComponents.pageId} = ${statusPages.id})` }).from(statusPages).where(eq(statusPages.orgId, orgId)).all(),
    db.select({ event: events, monitorName: monitors.name, monitorType: monitors.type }).from(events).innerJoin(monitors, eq(monitors.id, events.monitorId)).where(eq(monitors.orgId, orgId)).orderBy(desc(events.createdAt)).limit(12).all(),
  ]);
  const counts = { up: 0, down: 0, degraded: 0, pending: 0, paused: 0 };
  for (const m of mons) counts[m.status] = (counts[m.status] ?? 0) + 1;
  const players = mons.reduce((a, m) => a + (typeof m.lastData?.players === "number" && m.status !== "down" ? m.lastData.players : 0), 0);
  return {
    counts, players, total: mons.length,
    monitors: mons.slice(0, 8).map((m) => ({ id: m.id, name: m.name, type: m.type, icon: getProbe(m.type)?.icon ?? "Activity", status: m.status, lastCheckedAt: m.lastCheckedAt, latency: m.lastLatencyMs, data: m.lastData })),
    pages: pages.map((p) => ({ id: p.page.id, name: p.page.name, slug: p.page.slug, published: p.page.published, components: p.components })),
    recent: recent.map((r) => ({ id: r.event.id, monitorName: r.monitorName, icon: getProbe(r.monitorType)?.icon ?? "Activity", from: r.event.fromStatus, to: r.event.toStatus, message: r.event.message, at: r.event.createdAt })),
    now: Date.now(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  const form = await request.formData();
  if (form.get("intent") === "seed-demo") {
    const db = getDb(context);
    const existing = await db.select({ n: sql<number>`count(*)` }).from(monitors).where(and(eq(monitors.orgId, auth.org.id))).get();
    if ((existing?.n ?? 0) > 0) throw redirect("/app");
    const { pageId } = await seedDemo(getEnv(context), db, auth.org.id, auth.org.slug);
    throw redirect(`/app/pages/${pageId}`);
  }
  return null;
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { counts, players, total, monitors: mons, pages, recent, now } = loaderData;
  if (total === 0) {
    return (
      <>
        <PageHeader title="Welcome to Pylon" description="Let's get your first monitor running." />
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent/15 text-accent"><Sparkles className="size-5" /></div>
            <h2 className="mt-4 font-semibold">Try it with demo data</h2>
            <p className="mt-1 text-sm text-fg-muted">Creates monitors for a few large public Minecraft networks, a website check and a heartbeat, plus a ready-made status page. Delete anytime.</p>
            <Form method="post" className="mt-5"><input type="hidden" name="intent" value="seed-demo" /><SubmitButton variant="accent" pendingText="Seeding…">Create demo setup</SubmitButton></Form>
          </Card>
          <Card className="p-6">
            <div className="flex size-10 items-center justify-center rounded-lg bg-surface-2 text-fg-muted"><Activity className="size-5" /></div>
            <h2 className="mt-4 font-semibold">Start from scratch</h2>
            <p className="mt-1 text-sm text-fg-muted">Add a monitor for your own server. Minecraft, Steam games, FiveM, Rust, Pterodactyl, HTTP, heartbeats and more.</p>
            <Link to="/app/monitors/new" className="btn-primary mt-5"><Plus className="size-4" />Add monitor</Link>
          </Card>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Overview" description="Everything at a glance." actions={<Link to="/app/monitors/new" className="btn-primary btn-sm"><Plus className="size-4" />Add monitor</Link>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Up" value={counts.up} tone="up" />
        <Stat label="Down" value={counts.down} tone={counts.down ? "down" : "neutral"} />
        <Stat label="Degraded" value={counts.degraded} tone={counts.degraded ? "degraded" : "neutral"} />
        <Stat label="Paused / pending" value={counts.paused + counts.pending} />
        <Stat label="Players online" value={players.toLocaleString()} hint="across game monitors" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Monitors" actions={<Link to="/app/monitors" className="text-xs text-fg-muted hover:text-fg inline-flex items-center gap-1">View all<ArrowRight className="size-3" /></Link>} />
          <ul className="divide-y divide-line">
            {mons.map((m) => (
              <li key={m.id}>
                <Link to={`/app/monitors/${m.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/50">
                  <StatusDot tone={toneFor(m.status)} />
                  <ProbeIcon name={m.icon} className="size-4 text-fg-muted" />
                  <span className="flex-1 truncate text-sm font-medium">{m.name}</span>
                  {typeof m.data?.players === "number" && <span className="text-xs text-fg-muted tabular-nums">{m.data.players}{typeof m.data.maxPlayers === "number" ? `/${m.data.maxPlayers}` : ""} players</span>}
                  {m.latency !== null && <span className="text-xs text-fg-muted tabular-nums hidden sm:inline">{m.latency} ms</span>}
                  <span className="text-xs text-fg-faint w-16 text-right">{m.lastCheckedAt ? relativeTime(m.lastCheckedAt, now) : "—"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Status pages" actions={<Link to="/app/pages" className="text-xs text-fg-muted hover:text-fg">Manage</Link>} />
            {pages.length ? (
              <ul className="divide-y divide-line">
                {pages.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <FileText className="size-4 text-fg-muted" />
                    <Link to={`/app/pages/${p.id}`} className="flex-1 truncate text-sm font-medium hover:underline">{p.name}</Link>
                    <span className="text-xs text-fg-muted">{p.components} components</span>
                    <a href={`/s/${p.slug}`} target="_blank" rel="noopener" className="text-xs text-accent hover:underline">{p.published ? "View" : "Draft"}</a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5"><EmptyState title="No status pages yet" action={<Link to="/app/pages" className="btn-primary btn-sm">Create one</Link>} /></div>
            )}
          </Card>
          <Card>
            <CardHeader title="Recent events" />
            {recent.length ? (
              <ul className="divide-y divide-line">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                    <StatusDot tone={toneFor(e.to)} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate"><span className="font-medium">{e.monitorName}</span> <span className="text-fg-muted">went</span> <Badge tone={toneFor(e.to)}>{e.to}</Badge></p>
                      {e.message && <p className="truncate text-xs text-fg-muted">{e.message}</p>}
                    </div>
                    <span className="text-xs text-fg-faint whitespace-nowrap">{relativeTime(e.at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-6 text-sm text-fg-muted">No status changes yet.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
