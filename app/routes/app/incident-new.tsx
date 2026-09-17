import { useState } from "react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/incident-new";
import { Alert, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, SubmitButton, Textarea } from "~/components/ui";
import { appUrl, getCf, getDb, parseForm, requireAuth, requireRole } from "~/lib/server";
import { channels, maintenances, pageComponents, statusPages } from "@server/db/schema";
import { newId } from "@server/lib/ids";
import { createIncident } from "@server/services/incidents";
import { notifySubscribers } from "@server/services/subscribers";
import { purgePageCache } from "@server/services/cache";
import { pageBaseUrl } from "@server/services/page-url";
import { dispatchNotification } from "@server/notify/dispatch";

export const meta: Route.MetaFunction = () => [{ title: "New incident — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const [pages, comps] = await Promise.all([
    db.select({ id: statusPages.id, name: statusPages.name }).from(statusPages).where(eq(statusPages.orgId, auth.org.id)).all(),
    db.select({ id: pageComponents.id, pageId: pageComponents.pageId, name: pageComponents.name }).from(pageComponents).innerJoin(statusPages, eq(statusPages.id, pageComponents.pageId)).where(eq(statusPages.orgId, auth.org.id)).all(),
  ]);
  return { pages, components: comps };
}

const incidentSchema = z.object({
  kind: z.enum(["incident", "maintenance"]).default("incident"),
  pageId: z.string().min(1, "Pick a status page"),
  title: z.string().trim().min(1, "Title is required").max(140),
  status: z.enum(["investigating", "identified", "monitoring", "resolved"]).default("investigating"),
  impact: z.enum(["none", "minor", "major", "critical"]).default("minor"),
  body: z.string().trim().min(1, "Write an update").max(5000),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const { env, ctx } = getCf(context);
  const form = await request.formData();
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  const fail = (errors: Record<string, string>) => data({ errors, values }, { status: 400 });
  const parsed = parseForm(form, incidentSchema);
  if (!parsed.ok) return fail(parsed.errors);
  const page = await db.select().from(statusPages).where(and(eq(statusPages.id, parsed.data.pageId), eq(statusPages.orgId, auth.org.id))).get();
  if (!page) return fail({ pageId: "Page not found" });
  const componentIds = form.getAll("components").map(String);
  const site = appUrl(context);
  const pageUrl = pageBaseUrl(site, page);
  ctx.waitUntil(purgePageCache(env, page));

  if (parsed.data.kind === "maintenance") {
    const startsAt = Date.parse(parsed.data.startsAt ?? "");
    const endsAt = Date.parse(parsed.data.endsAt ?? "");
    if (!startsAt || !endsAt || endsAt <= startsAt) return fail({ startsAt: "Enter a valid window" });
    await db.insert(maintenances).values({ id: newId("mnt"), pageId: page.id, title: parsed.data.title, body: parsed.data.body, startsAt, endsAt, componentIds });
    ctx.waitUntil(notifySubscribers(db, env, page.id, { pageName: page.name, title: `Scheduled maintenance: ${parsed.data.title}`, status: "scheduled", impact: "maintenance", body: parsed.data.body, url: pageUrl, unsubscribeBase: `${pageUrl}/unsubscribe` }));
    throw redirect(`/app/pages/${page.id}`);
  }

  const id = await createIncident(db, { orgId: auth.org.id, pageId: page.id, title: parsed.data.title, status: parsed.data.status, impact: parsed.data.impact, body: parsed.data.body, componentIds, userId: auth.user.id });
  const incidentUrl = `${pageUrl}/incidents/${id}`;
  ctx.waitUntil(Promise.all([
    notifySubscribers(db, env, page.id, { pageName: page.name, title: parsed.data.title, status: parsed.data.status, impact: parsed.data.impact, body: parsed.data.body, url: incidentUrl, unsubscribeBase: `${pageUrl}/unsubscribe` }),
    db.select().from(channels).where(and(eq(channels.orgId, auth.org.id), eq(channels.isDefault, true), eq(channels.enabled, true))).all().then((chs) => Promise.allSettled(chs.map((c) => dispatchNotification(env, c, { event: "incident.created", incident: { id, title: parsed.data.title, status: parsed.data.status, impact: parsed.data.impact, url: incidentUrl, body: parsed.data.body }, at: Date.now(), appName: "Pylon" })))),
  ]));
  throw redirect(`/app/incidents/${id}`);
}

export default function IncidentNew({ loaderData, actionData }: Route.ComponentProps) {
  const { pages, components } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values: Record<string, string> = actionData?.values ?? {};
  const [pageId, setPageId] = useState(values.pageId ?? pages[0]?.id ?? "");
  const [kind, setKind] = useState<"incident" | "maintenance">((values.kind as "incident") ?? "incident");
  const comps = components.filter((c) => c.pageId === pageId);
  if (pages.length === 0) return <><PageHeader title="New incident" back={{ to: "/app/incidents", label: "Incidents" }} /><Alert tone="degraded">Create a <Link to="/app/pages" className="underline">status page</Link> first.</Alert></>;
  return (
    <>
      <PageHeader title={kind === "incident" ? "New incident" : "Schedule maintenance"} back={{ to: "/app/incidents", label: "Incidents" }} />
      <Form method="post" className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                {(["incident", "maintenance"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`btn ${kind === k ? "btn-primary" : "btn-secondary"} btn-sm capitalize`}>{k}</button>)}
                <input type="hidden" name="kind" value={kind} />
              </div>
              <Field label="Title" name="title" error={errors.title}><Input name="title" required defaultValue={values.title} placeholder={kind === "incident" ? "Survival server unreachable" : "Weekly restart & updates"} /></Field>
              {kind === "incident" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Status" name="status"><Select name="status" defaultValue={values.status ?? "investigating"}>{["investigating", "identified", "monitoring", "resolved"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                  <Field label="Impact" name="impact"><Select name="impact" defaultValue={values.impact ?? "minor"}>{["none", "minor", "major", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Starts (UTC)" name="startsAt" error={errors.startsAt}><Input name="startsAt" type="datetime-local" required defaultValue={values.startsAt} /></Field>
                  <Field label="Ends (UTC)" name="endsAt" error={errors.endsAt}><Input name="endsAt" type="datetime-local" required defaultValue={values.endsAt} /></Field>
                </div>
              )}
              <Field label={kind === "incident" ? "First update" : "Details"} name="body" error={errors.body} help="Markdown supported: **bold**, lists, links."><Textarea name="body" required defaultValue={values.body} className="min-h-36" placeholder="We're investigating reports of…" /></Field>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Status page" />
            <div className="p-5 space-y-4">
              <Select name="pageId" value={pageId} onChange={(e) => setPageId(e.target.value)}>{pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
              {errors.pageId && <p className="text-xs text-down">{errors.pageId}</p>}
              <p className="label">Affected components</p>
              <div className="space-y-2">{comps.length === 0 && <p className="text-xs text-fg-muted">No components on this page.</p>}{comps.map((c) => <Checkbox key={c.id} name="components" value={c.id} label={c.name} />)}</div>
            </div>
          </Card>
          <SubmitButton className="w-full" pendingText="Publishing…">{kind === "incident" ? "Publish incident" : "Schedule maintenance"}</SubmitButton>
          <p className="text-xs text-fg-muted">Subscribers and default notification channels are notified immediately.</p>
        </div>
      </Form>
    </>
  );
}
