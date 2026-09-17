import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { ExternalLink, FileText, Plus } from "lucide-react";
import type { Route } from "./+types/pages";
import { Alert, Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, SubmitButton } from "~/components/ui";
import { appUrl, getDb, getEnv, parseForm, requireAuth, requireRole } from "~/lib/server";
import { orgUsage } from "@server/services/usage";
import { pageBaseUrl } from "@server/services/page-url";
import { limitMessage, planFor } from "@server/plans";
import { pageComponents, statusPages } from "@server/db/schema";
import { newId, randomString, slugify } from "@server/lib/ids";

export const meta: Route.MetaFunction = () => [{ title: "Status pages — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const rows = await db.select({ page: statusPages, components: sql<number>`(select count(*) from ${pageComponents} where ${pageComponents.pageId} = ${statusPages.id})` }).from(statusPages).where(eq(statusPages.orgId, auth.org.id)).orderBy(statusPages.name).all();
  return { site: appUrl(context), canEdit: auth.org.role !== "viewer", pages: rows.map((r) => ({ id: r.page.id, name: r.page.name, slug: r.page.slug, published: r.page.published, url: pageBaseUrl(appUrl(context), r.page), pendingDomain: r.page.customDomain && !r.page.customDomainVerifiedAt ? r.page.customDomain : null, components: r.components })) };
}

const schema = z.object({ name: z.string().trim().min(1, "Name your page").max(80), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]*$/, "Lowercase letters, numbers and dashes only").max(48).optional() });

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const parsed = parseForm(await request.formData(), schema);
  if (!parsed.ok) return data({ errors: parsed.errors, values: parsed.values }, { status: 400 });
  const env = getEnv(context);
  const limit = limitMessage(env, planFor(env, auth.org), (await orgUsage(db, auth.org.id)).statusPages, "statusPages", "status pages");
  if (limit) return data({ errors: { _: limit }, values: parsed.values }, { status: 400 });
  let slug = parsed.data.slug || slugify(parsed.data.name);
  const clash = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.slug, slug)).get();
  if (clash) {
    if (parsed.data.slug) return data({ errors: { slug: "That URL is already taken." }, values: parsed.values }, { status: 400 });
    slug = `${slug}-${randomString(4)}`;
  }
  const id = newId("pg");
  await db.insert(statusPages).values({ id, orgId: auth.org.id, name: parsed.data.name, slug, hero: { showPlayers: true } });
  throw redirect(`/app/pages/${id}`);
}

export default function Pages({ loaderData, actionData }: Route.ComponentProps) {
  const { pages, site, canEdit } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values: Record<string, string> = actionData?.values ?? {};
  return (
    <>
      <PageHeader title="Status pages" description="Public pages your players can check." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {pages.length === 0 ? (
            <EmptyState icon={<FileText className="size-5" />} title="No status pages yet" description="Create one, add your monitors as components, then share the link or point a custom domain at it." />
          ) : (
            <ul className="space-y-3">
              {pages.map((p) => (
                <li key={p.id} className="card flex items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <Link to={`/app/pages/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                    <p className="text-xs text-fg-muted truncate">{p.url}{p.pendingDomain ? ` · ${p.pendingDomain} waiting for DNS` : ""} · {p.components} components</p>
                  </div>
                  {!p.published && <Badge>draft</Badge>}
                  <a href={`/s/${p.slug}`} target="_blank" rel="noopener" className="btn-secondary btn-sm"><ExternalLink className="size-3.5" />Open</a>
                  <Link to={`/app/pages/${p.id}`} className="btn-primary btn-sm">Edit</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {canEdit && (
          <Card>
            <CardHeader title="New status page" />
            <Form method="post" className="p-5 space-y-4">
              {errors._ && <Alert tone="degraded">{errors._}</Alert>}
              <Field label="Name" name="name" error={errors.name}><Input name="name" required placeholder="Example Network" defaultValue={values.name} /></Field>
              <Field label="URL slug" name="slug" error={errors.slug} help={<>Optional. {site}/s/<b>your-slug</b></>}><Input name="slug" placeholder="example-network" defaultValue={values.slug} /></Field>
              <SubmitButton className="w-full"><Plus className="size-4" />Create page</SubmitButton>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
