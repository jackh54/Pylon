import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ExternalLink, Trash2 } from "lucide-react";
import type { Route } from "./+types/incident-detail";
import { Badge, Card, CardHeader, Field, PageHeader, Select, SubmitButton, Textarea, toneFor } from "~/components/ui";
import { Markdown } from "~/lib/markdown";
import { formatDate } from "~/lib/format";
import { appUrl, getCf, getDb, parseForm, requireAuth, requireRole } from "~/lib/server";
import { incidentComponents, incidentUpdates, incidents, pageComponents, statusPages, users } from "@server/db/schema";
import { addIncidentUpdate } from "@server/services/incidents";
import { notifySubscribers } from "@server/services/subscribers";
import { purgePageCache } from "@server/services/cache";
import { pageBaseUrl } from "@server/services/page-url";

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.incident.title ?? "Incident"} — Pylon` }];

export async function loader({ params, context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const inc = await db.select().from(incidents).where(and(eq(incidents.id, params.id), eq(incidents.orgId, auth.org.id))).get();
  if (!inc) throw data("Incident not found", { status: 404 });
  const [updates, comps, page] = await Promise.all([
    db.select({ update: incidentUpdates, author: users.name }).from(incidentUpdates).leftJoin(users, eq(users.id, incidentUpdates.createdBy)).where(eq(incidentUpdates.incidentId, inc.id)).orderBy(asc(incidentUpdates.createdAt)).all(),
    db.select({ id: incidentComponents.componentId }).from(incidentComponents).where(eq(incidentComponents.incidentId, inc.id)).all(),
    inc.pageId ? db.select({ id: statusPages.id, name: statusPages.name, slug: statusPages.slug, customDomain: statusPages.customDomain, customDomainVerifiedAt: statusPages.customDomainVerifiedAt }).from(statusPages).where(eq(statusPages.id, inc.pageId)).get() : Promise.resolve(undefined),
  ]);
  const compNames = comps.length ? await db.select({ name: pageComponents.name }).from(pageComponents).where(inArray(pageComponents.id, comps.map((c) => c.id))).all() : [];
  const site = appUrl(context);
  return { incident: inc, updates: updates.map((u) => ({ ...u.update, author: u.author })), components: compNames.map((c) => c.name), page: page ?? null, publicUrl: page ? `${pageBaseUrl(site, page)}/incidents/${inc.id}` : null, canEdit: auth.org.role !== "viewer" };
}

const schema = z.object({ status: z.enum(["investigating", "identified", "monitoring", "resolved"]), body: z.string().trim().min(1, "Write an update").max(5000) });

export async function action({ request, params, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const { env, ctx } = getCf(context);
  const inc = await db.select().from(incidents).where(and(eq(incidents.id, params.id), eq(incidents.orgId, auth.org.id))).get();
  if (!inc) throw data("Not found", { status: 404 });
  const form = await request.formData();
  if (form.get("intent") === "delete") { await db.delete(incidents).where(eq(incidents.id, inc.id)); throw redirect("/app/incidents"); }
  const parsed = parseForm(form, schema);
  if (!parsed.ok) return data({ errors: parsed.errors as Record<string, string> }, { status: 400 });
  await addIncidentUpdate(db, { incidentId: inc.id, status: parsed.data.status, body: parsed.data.body, userId: auth.user.id });
  if (inc.pageId) {
    const page = await db.select().from(statusPages).where(eq(statusPages.id, inc.pageId)).get();
    if (page) {
      ctx.waitUntil(purgePageCache(env, page));
      const site = appUrl(context);
      const pageUrl = pageBaseUrl(site, page);
      ctx.waitUntil(notifySubscribers(db, env, page.id, { pageName: page.name, title: inc.title, status: parsed.data.status, impact: inc.impact, body: parsed.data.body, url: `${pageUrl}/incidents/${inc.id}`, unsubscribeBase: `${pageUrl}/unsubscribe` }));
    }
  }
  return data({ errors: {} as Record<string, string> });
}

export default function IncidentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { incident: inc, updates, components, page, publicUrl, canEdit } = loaderData;
  return (
    <>
      <PageHeader back={{ to: "/app/incidents", label: "Incidents" }} title={inc.title}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={toneFor(inc.status)}>{inc.status}</Badge><Badge tone={toneFor(inc.impact)}>{inc.impact} impact</Badge>{inc.auto && <Badge>auto-created</Badge>}{page && <span>on {page.name}</span>}<span>· started {formatDate(inc.startedAt)}</span></span>}
        actions={<>{publicUrl && <a href={publicUrl} target="_blank" rel="noopener" className="btn-secondary btn-sm"><ExternalLink className="size-3.5" />Public page</a>}{canEdit && <Form method="post" onSubmit={(e) => { if (!confirm("Delete this incident?")) e.preventDefault(); }}><button name="intent" value="delete" className="btn-danger btn-sm"><Trash2 className="size-3.5" />Delete</button></Form>}</>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Timeline" />
            <ol className="p-5 space-y-5">
              {[...updates].reverse().map((u) => (
                <li key={u.id} className="relative pl-6">
                  <span className="absolute left-0 top-1.5 size-2.5 rounded-full" style={{ background: `var(--${toneFor(u.status)})` }} />
                  <p className="text-xs text-fg-muted"><span className="font-medium text-fg capitalize">{u.status}</span> · {formatDate(u.createdAt)}{u.author ? ` · ${u.author}` : ""}</p>
                  <Markdown text={u.body} className="prose-doc text-sm mt-1 [&_p]:my-1" />
                </li>
              ))}
            </ol>
          </Card>
          {canEdit && inc.status !== "resolved" && (
            <Card>
              <CardHeader title="Post an update" />
              <Form method="post" className="p-5 space-y-4">
                <Field label="Status" name="status"><Select name="status" defaultValue={inc.status === "investigating" ? "identified" : inc.status === "identified" ? "monitoring" : "resolved"}>{["investigating", "identified", "monitoring", "resolved"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                <Field label="Update" name="body" error={actionData?.errors?.body}><Textarea name="body" required className="min-h-28" placeholder="Markdown supported" /></Field>
                <SubmitButton pendingText="Posting…">Post update</SubmitButton>
              </Form>
            </Card>
          )}
          {canEdit && inc.status === "resolved" && (
            <Card>
              <CardHeader title="Add a postmortem note" />
              <Form method="post" className="p-5 space-y-4">
                <input type="hidden" name="status" value="resolved" />
                <Textarea name="body" required className="min-h-24" placeholder="Root cause, what changed…" />
                <SubmitButton variant="secondary">Add note</SubmitButton>
              </Form>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader title="Affected components" />
          <ul className="p-5 text-sm space-y-1">{components.length === 0 ? <li className="text-fg-muted">None linked</li> : components.map((c) => <li key={c}>• {c}</li>)}</ul>
        </Card>
      </div>
    </>
  );
}
