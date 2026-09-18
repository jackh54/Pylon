import { useState } from "react";
import { Form, Link, data, redirect, useSearchParams } from "react-router";
import { and, asc, eq, sql } from "drizzle-orm";
import { ChevronDown, ChevronUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import type { Route } from "./+types/page-editor";
import { Alert, Badge, Card, CardHeader, Checkbox, Code, CopyButton, Field, Input, PageHeader, Select, SubmitButton, Table, Tabs, Td, Textarea, Th } from "~/components/ui";
import { ProbeIcon } from "~/components/icons";
import { appUrl, getCf, getDb, requireAuth, requireRole } from "~/lib/server";
import { monitors, pageComponents, pageSections, statusPages, subscribers } from "@server/db/schema";
import type { StatusPageTheme } from "@server/db/schema";
import { newId } from "@server/lib/ids";
import { hashPassword, pbkdf2Iterations } from "@server/auth/password";
import { getProbe } from "@server/probes/registry";
import { syncMonitorsForPage } from "@server/services/monitors";
import { purgePageCache } from "@server/services/cache";
import { isHosted, planFor, upgradeHint } from "@server/plans";
import { checkDomainDns, edgeConfig, normalizeHostname, setVerified } from "@server/services/domains";
import { pageBaseUrl } from "@server/services/page-url";

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.page.name ?? "Status page"} — Pylon` }];

export async function loader({ params, context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const page = await db.select().from(statusPages).where(and(eq(statusPages.id, params.id), eq(statusPages.orgId, auth.org.id))).get();
  if (!page) throw data("Page not found", { status: 404 });
  const [sections, comps, mons, subs] = await Promise.all([
    db.select().from(pageSections).where(eq(pageSections.pageId, page.id)).orderBy(asc(pageSections.position)).all(),
    db.select().from(pageComponents).where(eq(pageComponents.pageId, page.id)).orderBy(asc(pageComponents.position)).all(),
    db.select({ id: monitors.id, name: monitors.name, type: monitors.type, status: monitors.status }).from(monitors).where(eq(monitors.orgId, auth.org.id)).orderBy(monitors.name).all(),
    db.select({ n: sql<number>`count(*)` }).from(subscribers).where(and(eq(subscribers.pageId, page.id), eq(subscribers.confirmed, true))).get(),
  ]);
  const site = appUrl(context);
  const env = getCf(context).env;
  const plan = planFor(env, auth.org);
  return {
    plan: { name: plan.name, hosted: isHosted(env), customDomain: plan.limits.customDomain, hideBranding: plan.limits.hideBranding, historyDays: plan.limits.historyDays, hint: upgradeHint(env) },
    domain: (() => { const e = edgeConfig(env); return { mode: e.mode, target: e.target, ip: e.ips.find((ip) => !ip.includes(":")) ?? null, ipv6: e.ips.find((ip) => ip.includes(":")) ?? null }; })(),
    publicUrl: pageBaseUrl(site, page),
    page: { ...page, passwordHash: undefined, hasPassword: !!page.passwordHash },
    sections, components: comps,
    monitors: mons.map((m) => ({ ...m, icon: getProbe(m.type)?.icon ?? "Activity" })),
    subscribers: subs?.n ?? 0,
    site, appHost: new URL(site).host, canEdit: auth.org.role !== "viewer",
  };
}

const str = (f: FormData, k: string) => { const v = f.get(k); return typeof v === "string" ? v.trim() : ""; };
const bool = (f: FormData, k: string) => f.get(k) === "on";
const HEX = /^#[0-9a-f]{6}$/i;

export async function action({ request, params, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const { env, ctx } = getCf(context);
  const page = await db.select().from(statusPages).where(and(eq(statusPages.id, params.id), eq(statusPages.orgId, auth.org.id))).get();
  if (!page) throw data("Not found", { status: 404 });
  ctx.waitUntil(purgePageCache(env, page));
  const plan = planFor(env, auth.org);
  const form = await request.formData();
  const intent = str(form, "intent");
  const touch = { updatedAt: Date.now() };
  const ok = (message: string, tab?: string) => data({ message, error: null as string | null, tab });
  const fail = (error: string, tab?: string) => data({ message: null as string | null, error, tab }, { status: 400 });

  switch (intent) {
    case "general": {
      const name = str(form, "name");
      const slug = str(form, "slug").toLowerCase();
      if (!name) return fail("Name is required", "general");
      if (!/^[a-z0-9-]{1,48}$/.test(slug)) return fail("Slug must be lowercase letters, numbers and dashes", "general");
      if (slug !== page.slug) {
        const clash = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.slug, slug)).get();
        if (clash) return fail("That slug is already in use", "general");
      }
      await db.update(statusPages).set({ name, slug, description: str(form, "description") || null, published: bool(form, "published"), allowSubscribers: bool(form, "allowSubscribers"), historyDays: Math.min(plan.limits.historyDays, Math.max(7, Number(str(form, "historyDays")) || 90)), ...touch }).where(eq(statusPages.id, page.id));
      return ok("Saved", "general");
    }
    case "hero": {
      await db.update(statusPages).set({ hero: { connectAddress: str(form, "connectAddress") || undefined, connectLabel: str(form, "connectLabel") || undefined, tagline: str(form, "tagline") || undefined, bannerUrl: str(form, "bannerUrl") || undefined, showPlayers: bool(form, "showPlayers") }, ...touch }).where(eq(statusPages.id, page.id));
      return ok("Saved", "hero");
    }
    case "theme": {
      const accent = str(form, "accent");
      if (!HEX.test(accent)) return fail("Accent must be a hex color like #22c55e", "theme");
      const background = str(form, "background");
      if (background && !HEX.test(background)) return fail("Background must be a hex color", "theme");
      const theme: StatusPageTheme = {
        mode: (["system", "light", "dark"].includes(str(form, "mode")) ? str(form, "mode") : "system") as StatusPageTheme["mode"],
        accent, background: background || undefined,
        radius: (["rounded", "sharp", "pill"].includes(str(form, "radius")) ? str(form, "radius") : "rounded") as StatusPageTheme["radius"],
        historyStyle: str(form, "historyStyle") === "dots" ? "dots" : "bars",
        font: (["inter", "system", "mono"].includes(str(form, "font")) ? str(form, "font") : "inter") as StatusPageTheme["font"],
        customCss: str(form, "customCss").replace(/<\/style/gi, "").slice(0, 20000) || undefined,
        hideBranding: plan.limits.hideBranding && bool(form, "hideBranding"),
      };
      let logoUrl = str(form, "logoUrl") || null;
      const file = form.get("logo");
      if (file instanceof File && file.size > 0) {
        if (file.size > 2 * 1024 * 1024) return fail("Logo must be under 2 MB", "theme");
        if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) return fail("Logo must be PNG, JPEG, WebP, GIF or SVG", "theme");
        const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1]!.replace("jpeg", "jpg");
        const key = `logos/${page.id}-${Date.now()}.${ext}`;
        await env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
        logoUrl = `/uploads/${key}`;
      }
      await db.update(statusPages).set({ theme, logoUrl, faviconUrl: str(form, "faviconUrl") || null, ...touch }).where(eq(statusPages.id, page.id));
      return ok("Theme saved", "theme");
    }
    case "links": {
      await db.update(statusPages).set({ links: { website: str(form, "website") || undefined, discord: str(form, "discord") || undefined, store: str(form, "store") || undefined, twitter: str(form, "twitter") || undefined, github: str(form, "github") || undefined }, ...touch }).where(eq(statusPages.id, page.id));
      return ok("Links saved", "links");
    }
    case "seo": {
      const aiPolicy = str(form, "aiPolicy");
      await db.update(statusPages).set({ seo: { title: str(form, "title") || undefined, description: str(form, "seoDescription") || undefined, keywords: str(form, "keywords").split(",").map((s) => s.trim()).filter(Boolean), noindex: bool(form, "noindex"), aiPolicy: (["allow", "search-only", "disallow"].includes(aiPolicy) ? aiPolicy : "allow") as "allow", ogImageUrl: str(form, "ogImageUrl") || undefined }, ...touch }).where(eq(statusPages.id, page.id));
      return ok("SEO settings saved", "seo");
    }
    case "domain": {
      const raw = str(form, "customDomain");
      if (!raw) {
        await db.update(statusPages).set({ customDomain: null, customDomainVerifiedAt: null, ...touch }).where(eq(statusPages.id, page.id));
        return ok("Custom domain removed", "domain");
      }
      if (!plan.limits.customDomain) return fail(`Custom domains are a Pro feature. ${upgradeHint(env)}`, "domain");
      const domain = normalizeHostname(raw);
      if (!domain) return fail("Enter a hostname like status.example.com", "domain");
      if (domain === new URL(env.APP_URL).hostname || (edgeConfig(env).target && domain === edgeConfig(env).target)) return fail("That hostname belongs to this service.", "domain");
      const clash = await db.select({ id: statusPages.id }).from(statusPages).where(eq(statusPages.customDomain, domain)).get();
      if (clash && clash.id !== page.id) return fail("That domain is already connected to another status page.", "domain");
      const mode = edgeConfig(env).mode;
      const changed = domain !== page.customDomain;
      await db.update(statusPages).set({ customDomain: domain, ...(changed ? { customDomainVerifiedAt: mode === "manual" ? Date.now() : null } : {}), ...touch }).where(eq(statusPages.id, page.id));
      if (mode === "manual") return ok(`Saved. Add ${domain} as a Custom Domain on this Worker in Cloudflare.`, "domain");
      const check = await checkDomainDns(env, domain);
      await setVerified(db, page.id, check.ok);
      return check.ok ? ok(`${domain} is connected. The HTTPS certificate is issued on the first visit.`, "domain") : ok(`Saved. ${check.reason ?? "Waiting for DNS."} We check again every few minutes.`, "domain");
    }
    case "domain-verify": {
      if (!page.customDomain) return fail("Add a hostname first.", "domain");
      const check = await checkDomainDns(env, page.customDomain);
      await setVerified(db, page.id, check.ok);
      if (check.ok) return ok(`${page.customDomain} is connected.`, "domain");
      return fail(`${check.reason ?? "Not pointing here yet."}${check.found.length ? ` Found: ${check.found.join(", ")}.` : ""}`, "domain");
    }
    case "password": {
      const pw = str(form, "password");
      await db.update(statusPages).set({ passwordHash: pw ? await hashPassword(pw, pbkdf2Iterations(env)) : null, ...touch }).where(eq(statusPages.id, page.id));
      return ok(pw ? "Password set" : "Password removed", "access");
    }
    case "section-add": {
      const name = str(form, "name"); if (!name) return fail("Section name is required", "components");
      const max = await db.select({ m: sql<number>`coalesce(max(${pageSections.position}), -1)` }).from(pageSections).where(eq(pageSections.pageId, page.id)).get();
      await db.insert(pageSections).values({ id: newId("sec"), pageId: page.id, name, position: (max?.m ?? -1) + 1 });
      return ok("Section added", "components");
    }
    case "section-delete": {
      const id = str(form, "id");
      await db.update(pageComponents).set({ sectionId: null }).where(and(eq(pageComponents.pageId, page.id), eq(pageComponents.sectionId, id)));
      await db.delete(pageSections).where(and(eq(pageSections.id, id), eq(pageSections.pageId, page.id)));
      return ok("Section removed", "components");
    }
    case "section-rename": {
      await db.update(pageSections).set({ name: str(form, "name") || "Section" }).where(and(eq(pageSections.id, str(form, "id")), eq(pageSections.pageId, page.id)));
      return ok("Renamed", "components");
    }
    case "section-move": {
      const rows = await db.select().from(pageSections).where(eq(pageSections.pageId, page.id)).orderBy(asc(pageSections.position)).all();
      const i = rows.findIndex((r) => r.id === str(form, "id"));
      const j = str(form, "dir") === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= rows.length) return ok("", "components");
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
      await db.batch(rows.map((r, idx) => db.update(pageSections).set({ position: idx }).where(eq(pageSections.id, r.id))) as unknown as Parameters<typeof db.batch>[0]);
      return ok("", "components");
    }
    case "component-add": {
      const monitorId = str(form, "monitorId");
      const mon = monitorId ? await db.select({ id: monitors.id, name: monitors.name }).from(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.orgId, auth.org.id))).get() : null;
      const name = str(form, "name") || mon?.name;
      if (!name) return fail("Pick a monitor or enter a name", "components");
      const sectionId = str(form, "sectionId") || null;
      const max = await db.select({ m: sql<number>`coalesce(max(${pageComponents.position}), -1)` }).from(pageComponents).where(eq(pageComponents.pageId, page.id)).get();
      await db.insert(pageComponents).values({ id: newId("cmp"), pageId: page.id, sectionId, monitorId: mon?.id ?? null, name, position: (max?.m ?? -1) + 1 });
      await syncMonitorsForPage(env, db, page.id);
      return ok("Component added", "components");
    }
    case "component-update": {
      const id = str(form, "id");
      const monitorId = str(form, "monitorId") || null;
      if (monitorId) {
        const mon = await db.select({ id: monitors.id }).from(monitors).where(and(eq(monitors.id, monitorId), eq(monitors.orgId, auth.org.id))).get();
        if (!mon) return fail("Monitor not found", "components");
      }
      await db.update(pageComponents).set({
        name: str(form, "name") || "Component", description: str(form, "description") || null, sectionId: str(form, "sectionId") || null, monitorId,
        display: { showLatency: bool(form, "showLatency"), showPlayers: bool(form, "showPlayers"), showVersion: bool(form, "showVersion"), showHistory: bool(form, "showHistory"), countInTotal: bool(form, "countInTotal"), fields: str(form, "fields").split(",").map((s) => s.trim()).filter(Boolean) },
      }).where(and(eq(pageComponents.id, id), eq(pageComponents.pageId, page.id)));
      await syncMonitorsForPage(env, db, page.id);
      return ok("Component saved", "components");
    }
    case "component-delete": {
      await db.delete(pageComponents).where(and(eq(pageComponents.id, str(form, "id")), eq(pageComponents.pageId, page.id)));
      await syncMonitorsForPage(env, db, page.id);
      return ok("Component removed", "components");
    }
    case "component-move": {
      const rows = await db.select().from(pageComponents).where(eq(pageComponents.pageId, page.id)).orderBy(asc(pageComponents.position)).all();
      const i = rows.findIndex((r) => r.id === str(form, "id"));
      const j = str(form, "dir") === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= rows.length) return ok("", "components");
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
      await db.batch(rows.map((r, idx) => db.update(pageComponents).set({ position: idx }).where(eq(pageComponents.id, r.id))) as unknown as Parameters<typeof db.batch>[0]);
      return ok("", "components");
    }
    case "page-delete": {
      await db.delete(statusPages).where(eq(statusPages.id, page.id));
      throw redirect("/app/pages");
    }
  }
  return null;
}

const TABS = [
  { id: "components", label: "Components" }, { id: "general", label: "General" }, { id: "hero", label: "Hero" }, { id: "theme", label: "Branding" },
  { id: "links", label: "Links" }, { id: "seo", label: "SEO & AI" }, { id: "domain", label: "Domain" }, { id: "access", label: "Access" },
];

export default function PageEditor({ loaderData, actionData }: Route.ComponentProps) {
  const { page, sections, components, monitors: mons, subscribers: subCount, site, appHost, canEdit, plan, domain, publicUrl } = loaderData;
  const [params, setParams] = useSearchParams();
  const tab = actionData?.tab ?? params.get("tab") ?? "components";
  const setTab = (t: string) => setParams({ tab: t }, { preventScrollReset: true, replace: true });
  const bySection = (sid: string | null) => components.filter((c) => c.sectionId === sid);
  const monitorOptions = mons.map((m) => <option key={m.id} value={m.id}>{m.name}</option>);
  const [openComponent, setOpenComponent] = useState<string | null>(null);
  const disabled = !canEdit;

  return (
    <>
      <PageHeader back={{ to: "/app/pages", label: "Status pages" }} title={page.name}
        description={<span className="flex flex-wrap items-center gap-2"><a href={publicUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-accent hover:underline">{publicUrl}<ExternalLink className="size-3" /></a>{!page.published && <Badge>draft</Badge>}<span>· {subCount} subscribers</span></span>}
        actions={<a href={`/s/${page.slug}`} target="_blank" rel="noopener" className="btn-secondary btn-sm"><ExternalLink className="size-3.5" />Preview</a>} />
      {actionData?.message && <Alert tone="up" className="mb-4">{actionData.message}</Alert>}
      {actionData?.error && <Alert tone="down" className="mb-4">{actionData.error}</Alert>}
      <Tabs tabs={TABS} current={tab} onChange={setTab} />

      {tab === "components" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {[...sections.map((s) => ({ id: s.id as string | null, name: s.name, position: s.position })), { id: null, name: "Ungrouped", position: 9999 }].map((sec, idx, arr) => {
              const items = bySection(sec.id);
              if (sec.id === null && items.length === 0) return null;
              return (
                <Card key={sec.id ?? "none"}>
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
                    {sec.id ? (
                      <Form method="post" className="flex-1 flex items-center gap-2"><input type="hidden" name="intent" value="section-rename" /><input type="hidden" name="id" value={sec.id} /><Input name="name" defaultValue={sec.name} className="max-w-xs font-medium" disabled={disabled} onBlur={(e) => { if (e.target.value !== sec.name) e.target.form?.requestSubmit(); }} /></Form>
                    ) : <p className="flex-1 font-medium text-sm">{sec.name}</p>}
                    {sec.id && canEdit && (
                      <>
                        <Form method="post"><input type="hidden" name="intent" value="section-move" /><input type="hidden" name="id" value={sec.id} /><button name="dir" value="up" className="btn-ghost btn-sm" disabled={idx === 0} aria-label="Move up"><ChevronUp className="size-4" /></button><button name="dir" value="down" className="btn-ghost btn-sm" disabled={idx >= arr.length - 2} aria-label="Move down"><ChevronDown className="size-4" /></button></Form>
                        <Form method="post" onSubmit={(e) => { if (!confirm("Remove this section? Components move to Ungrouped.")) e.preventDefault(); }}><input type="hidden" name="intent" value="section-delete" /><input type="hidden" name="id" value={sec.id} /><button className="btn-ghost btn-sm text-down" aria-label="Delete section"><Trash2 className="size-4" /></button></Form>
                      </>
                    )}
                  </div>
                  <ul className="divide-y divide-line">
                    {items.length === 0 && <li className="px-4 py-4 text-sm text-fg-muted">No components in this section yet.</li>}
                    {items.map((c) => {
                      const mon = mons.find((m) => m.id === c.monitorId);
                      const open = openComponent === c.id;
                      return (
                        <li key={c.id} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <ProbeIcon name={mon?.icon ?? "Activity"} className="size-4 text-fg-muted" />
                            <button type="button" className="flex-1 text-left" onClick={() => setOpenComponent(open ? null : c.id)}>
                              <p className="text-sm font-medium">{c.name}</p>
                              <p className="text-xs text-fg-muted">{mon ? mon.name : "No monitor linked (static)"}</p>
                            </button>
                            {canEdit && (
                              <>
                                <Form method="post"><input type="hidden" name="intent" value="component-move" /><input type="hidden" name="id" value={c.id} /><button name="dir" value="up" className="btn-ghost btn-sm" aria-label="Move up"><ChevronUp className="size-4" /></button><button name="dir" value="down" className="btn-ghost btn-sm" aria-label="Move down"><ChevronDown className="size-4" /></button></Form>
                                <Form method="post" onSubmit={(e) => { if (!confirm("Remove this component?")) e.preventDefault(); }}><input type="hidden" name="intent" value="component-delete" /><input type="hidden" name="id" value={c.id} /><button className="btn-ghost btn-sm text-down" aria-label="Delete"><Trash2 className="size-4" /></button></Form>
                              </>
                            )}
                          </div>
                          {open && (
                            <Form method="post" className="mt-3 grid gap-3 sm:grid-cols-2 rounded-lg bg-surface-2/60 p-4">
                              <input type="hidden" name="intent" value="component-update" /><input type="hidden" name="id" value={c.id} />
                              <Field label="Display name" name={`name-${c.id}`}><Input name="name" defaultValue={c.name} disabled={disabled} /></Field>
                              <Field label="Monitor" name={`monitorId-${c.id}`}><Select name="monitorId" defaultValue={c.monitorId ?? ""} disabled={disabled}><option value="">— none —</option>{monitorOptions}</Select></Field>
                              <Field label="Description" name={`description-${c.id}`} className="sm:col-span-2"><Input name="description" defaultValue={c.description ?? ""} placeholder="Shown under the name" disabled={disabled} /></Field>
                              <Field label="Section" name={`sectionId-${c.id}`}><Select name="sectionId" defaultValue={c.sectionId ?? ""} disabled={disabled}><option value="">Ungrouped</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                              <Field label="Extra fields" name={`fields-${c.id}`} help="Comma-separated snapshot keys, e.g. map, tps"><Input name="fields" defaultValue={(c.display.fields ?? []).join(", ")} disabled={disabled} /></Field>
                              <div className="sm:col-span-2 flex flex-wrap gap-4">
                                <Checkbox name="showHistory" defaultChecked={c.display.showHistory !== false} label="Uptime history" disabled={disabled} />
                                <Checkbox name="showPlayers" defaultChecked={c.display.showPlayers !== false} label="Players" disabled={disabled} />
                                <Checkbox name="showLatency" defaultChecked={c.display.showLatency !== false} label="Latency" disabled={disabled} />
                                <Checkbox name="showVersion" defaultChecked={c.display.showVersion !== false} label="Version" disabled={disabled} />
                                <Checkbox name="countInTotal" defaultChecked={c.display.countInTotal !== false} label="Count in players total" disabled={disabled} />
                              </div>
                              {canEdit && <div className="sm:col-span-2"><SubmitButton variant="secondary" className="btn-sm">Save component</SubmitButton></div>}
                            </Form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
          {canEdit && (
            <div className="space-y-4">
              <Card>
                <CardHeader title="Add component" description="Link a monitor to show live status." />
                <Form method="post" className="p-5 space-y-3">
                  <input type="hidden" name="intent" value="component-add" />
                  <Field label="Monitor" name="add-monitor"><Select name="monitorId" defaultValue=""><option value="">— static component —</option>{monitorOptions}</Select></Field>
                  <Field label="Display name" name="add-name" help="Defaults to the monitor name"><Input name="name" placeholder="Survival" /></Field>
                  <Field label="Section" name="add-section"><Select name="sectionId" defaultValue=""><option value="">Ungrouped</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                  <SubmitButton className="w-full"><Plus className="size-4" />Add</SubmitButton>
                </Form>
              </Card>
              <Card>
                <CardHeader title="Add section" description="Group components, e.g. Game servers / Web." />
                <Form method="post" className="p-5 flex gap-2">
                  <input type="hidden" name="intent" value="section-add" />
                  <Input name="name" placeholder="Game servers" required />
                  <SubmitButton variant="secondary">Add</SubmitButton>
                </Form>
              </Card>
              {mons.length === 0 && <Alert tone="degraded">You have no monitors yet. <Link to="/app/monitors/new" className="underline">Create one</Link> to link it here.</Alert>}
            </div>
          )}
        </div>
      )}

      {tab === "general" && (
        <Card className="max-w-2xl">
          <Form method="post" className="p-5 space-y-4">
            <input type="hidden" name="intent" value="general" />
            <Field label="Name" name="name"><Input name="name" defaultValue={page.name} required disabled={disabled} /></Field>
            <Field label="Slug" name="slug" help={`${site}/s/${page.slug}`}><Input name="slug" defaultValue={page.slug} pattern="[a-z0-9-]+" required disabled={disabled} /></Field>
            <Field label="Description" name="description" help="Used for meta description and the page intro."><Textarea name="description" defaultValue={page.description ?? ""} disabled={disabled} /></Field>
            <Field label="History window (days)" name="historyDays" help={plan.hosted ? `Up to ${plan.historyDays} days on the ${plan.name} plan` : undefined}><Input name="historyDays" type="number" min={7} max={plan.historyDays} defaultValue={Math.min(page.historyDays, plan.historyDays)} disabled={disabled} /></Field>
            <div className="flex flex-wrap gap-5"><Checkbox name="published" defaultChecked={page.published} label="Published (public)" disabled={disabled} /><Checkbox name="allowSubscribers" defaultChecked={page.allowSubscribers} label="Allow email / webhook subscribers" disabled={disabled} /></div>
            {canEdit && <SubmitButton>Save</SubmitButton>}
          </Form>
          {canEdit && (
            <div className="border-t border-line p-5">
              <p className="text-sm font-medium text-down">Danger zone</p>
              <Form method="post" className="mt-2" onSubmit={(e) => { if (!confirm(`Delete "${page.name}" and all its incidents?`)) e.preventDefault(); }}><input type="hidden" name="intent" value="page-delete" /><button className="btn-danger btn-sm"><Trash2 className="size-3.5" />Delete page</button></Form>
            </div>
          )}
        </Card>
      )}

      {tab === "hero" && (
        <Card className="max-w-2xl">
          <CardHeader title="Hero block" description="The big connect box players see first." />
          <Form method="post" className="p-5 space-y-4">
            <input type="hidden" name="intent" value="hero" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Connect address" name="connectAddress" help="Shown with a copy button"><Input name="connectAddress" defaultValue={page.hero.connectAddress ?? ""} placeholder="play.example.gg" disabled={disabled} /></Field>
              <Field label="Address label" name="connectLabel"><Input name="connectLabel" defaultValue={page.hero.connectLabel ?? ""} placeholder="Java IP" disabled={disabled} /></Field>
            </div>
            <Field label="Tagline" name="tagline"><Input name="tagline" defaultValue={page.hero.tagline ?? ""} placeholder="Playable on 1.8 – 1.21 · Bedrock supported" disabled={disabled} /></Field>
            <Field label="Banner image URL" name="bannerUrl" help="Optional wide image behind the hero"><Input name="bannerUrl" type="url" defaultValue={page.hero.bannerUrl ?? ""} disabled={disabled} /></Field>
            <Checkbox name="showPlayers" defaultChecked={page.hero.showPlayers !== false} label="Show total players online" disabled={disabled} />
            {canEdit && <div><SubmitButton>Save</SubmitButton></div>}
          </Form>
        </Card>
      )}

      {tab === "theme" && (
        <Card className="max-w-2xl">
          <CardHeader title="Branding & theme" />
          <Form method="post" encType="multipart/form-data" className="p-5 space-y-4">
            <input type="hidden" name="intent" value="theme" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Logo" name="logo" help="PNG, SVG, WebP · max 2 MB"><input name="logo" type="file" accept="image/*" className="block w-full text-sm file:mr-3 file:btn-secondary file:btn-sm" disabled={disabled} /></Field>
              <Field label="…or logo URL" name="logoUrl"><Input name="logoUrl" defaultValue={page.logoUrl ?? ""} placeholder="https://…/logo.png" disabled={disabled} /></Field>
              <Field label="Favicon URL" name="faviconUrl" help="Browser tab icon. Leave empty to use the logo."><Input name="faviconUrl" defaultValue={page.faviconUrl ?? ""} placeholder="https://…/favicon.png" disabled={disabled} /></Field>
              <Field label="Accent color" name="accent"><div className="flex gap-2"><input type="color" defaultValue={page.theme.accent} onChange={(e) => { const t = e.currentTarget.form?.elements.namedItem("accent") as HTMLInputElement | null; if (t) t.value = e.currentTarget.value; }} className="h-9 w-12 rounded border border-line bg-surface" disabled={disabled} /><Input name="accent" defaultValue={page.theme.accent} pattern="#[0-9a-fA-F]{6}" disabled={disabled} /></div></Field>
              <Field label="Mode" name="mode"><Select name="mode" defaultValue={page.theme.mode} disabled={disabled}><option value="system">Follow visitor's system</option><option value="light">Always light</option><option value="dark">Always dark</option></Select></Field>
              <Field label="Background override" name="background" help="Optional hex"><Input name="background" defaultValue={page.theme.background ?? ""} placeholder="#0a0d13" disabled={disabled} /></Field>
              <Field label="Corners" name="radius"><Select name="radius" defaultValue={page.theme.radius} disabled={disabled}><option value="rounded">Rounded</option><option value="sharp">Sharp</option><option value="pill">Pill</option></Select></Field>
              <Field label="History style" name="historyStyle"><Select name="historyStyle" defaultValue={page.theme.historyStyle} disabled={disabled}><option value="bars">Bars</option><option value="dots">Dots</option></Select></Field>
              <Field label="Font" name="font"><Select name="font" defaultValue={page.theme.font ?? "inter"} disabled={disabled}><option value="inter">Inter</option><option value="system">System UI</option><option value="mono">Monospace</option></Select></Field>
            </div>
            <Field label="Custom CSS" name="customCss" help="Injected into the page. Use CSS variables --accent, --bg, --surface, --fg."><Textarea name="customCss" defaultValue={page.theme.customCss ?? ""} className="font-mono text-xs min-h-32" placeholder={".status-root { --radius: 0; }"} disabled={disabled} /></Field>
            <div><Checkbox name="hideBranding" defaultChecked={!!page.theme.hideBranding} disabled={disabled || !plan.hideBranding} label={<span>Hide the “Powered by Pylon” footer{!plan.hideBranding && <span className="text-xs text-fg-faint"> · Pro feature</span>}</span>} /></div>
            {canEdit && <SubmitButton>Save theme</SubmitButton>}
          </Form>
        </Card>
      )}

      {tab === "links" && (
        <Card className="max-w-2xl">
          <CardHeader title="Links" description="Shown in the page header and as sameAs in structured data." />
          <Form method="post" className="p-5 grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="intent" value="links" />
            <Field label="Website" name="website"><Input name="website" type="url" defaultValue={page.links.website ?? ""} disabled={disabled} /></Field>
            <Field label="Discord invite" name="discord"><Input name="discord" type="url" defaultValue={page.links.discord ?? ""} placeholder="https://discord.gg/…" disabled={disabled} /></Field>
            <Field label="Store" name="store"><Input name="store" type="url" defaultValue={page.links.store ?? ""} disabled={disabled} /></Field>
            <Field label="Twitter / X" name="twitter"><Input name="twitter" type="url" defaultValue={page.links.twitter ?? ""} disabled={disabled} /></Field>
            <Field label="GitHub" name="github"><Input name="github" type="url" defaultValue={page.links.github ?? ""} disabled={disabled} /></Field>
            {canEdit && <div className="sm:col-span-2"><SubmitButton>Save links</SubmitButton></div>}
          </Form>
        </Card>
      )}

      {tab === "seo" && (
        <Card className="max-w-2xl">
          <CardHeader title="SEO & AI crawlers" description="Every page ships JSON-LD, OG image, sitemap entry, RSS, a Markdown twin and llms.txt listing automatically." />
          <Form method="post" className="p-5 space-y-4">
            <input type="hidden" name="intent" value="seo" />
            <Field label="Title override" name="title"><Input name="title" defaultValue={page.seo.title ?? ""} placeholder={`${page.name} Status`} disabled={disabled} /></Field>
            <Field label="Meta description" name="seoDescription"><Textarea name="seoDescription" defaultValue={page.seo.description ?? ""} placeholder={page.description ?? ""} disabled={disabled} /></Field>
            <Field label="Keywords" name="keywords" help="Comma-separated"><Input name="keywords" defaultValue={(page.seo.keywords ?? []).join(", ")} placeholder="minecraft server status, example network" disabled={disabled} /></Field>
            <Field label="Custom OG image URL" name="ogImageUrl" help="Leave empty to use the generated image"><Input name="ogImageUrl" type="url" defaultValue={page.seo.ogImageUrl ?? ""} disabled={disabled} /></Field>
            <Field label="AI crawler policy" name="aiPolicy" help="Applied on the custom domain's robots.txt (Content-Signal) and via meta tags."><Select name="aiPolicy" defaultValue={page.seo.aiPolicy ?? "allow"} disabled={disabled}><option value="allow">Allow search, AI answers and training</option><option value="search-only">Search and AI answers, no training</option><option value="disallow">Disallow AI crawlers</option></Select></Field>
            <Checkbox name="noindex" defaultChecked={!!page.seo.noindex} label="Hide from search engines (noindex)" disabled={disabled} />
            <div className="rounded-lg bg-surface-2/60 border border-line p-3 text-xs text-fg-muted space-y-1">
              <p>Machine-readable twins of this page:</p>
              <p><Code>{`${publicUrl}/status.json`}</Code> <Code>{`${publicUrl}/status.md`}</Code> <Code>{`${publicUrl}/feed.xml`}</Code> <Code>{`${publicUrl}/badge.svg`}</Code></p>
            </div>
            {canEdit && <SubmitButton>Save</SubmitButton>}
          </Form>
        </Card>
      )}

      {tab === "domain" && (
        <Card className="max-w-2xl">
          <CardHeader title="Custom domain" description="Serve this page from your own hostname, with HTTPS handled for you."
            actions={page.customDomain ? (page.customDomainVerifiedAt ? <Badge tone="up">Connected</Badge> : <Badge tone="degraded">Waiting for DNS</Badge>) : undefined} />
          <div className="p-5 space-y-5">
            {!plan.customDomain && <Alert tone="degraded">Custom domains are a Pro feature. {plan.hint}</Alert>}
            <Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="domain" />
              <Field label="Hostname" name="customDomain" className="flex-1 min-w-56"><Input name="customDomain" defaultValue={page.customDomain ?? ""} placeholder="status.example.gg" disabled={disabled || !plan.customDomain} /></Field>
              {canEdit && plan.customDomain && <SubmitButton>Save</SubmitButton>}
            </Form>

            {domain.mode === "edge" ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Add this DNS record at your DNS provider</p>
                <Table className="text-xs">
                  <thead><tr><Th>Type</Th><Th>Name</Th><Th>Target</Th><Th /></tr></thead>
                  <tbody>
                    <tr><Td className="font-mono">CNAME</Td><Td className="font-mono break-all">{page.customDomain ?? "status"}</Td><Td className="font-mono break-all">{domain.target}</Td><Td><CopyButton value={domain.target ?? ""} /></Td></tr>
                    {domain.ip && <tr><Td className="font-mono">A</Td><Td className="font-mono text-fg-muted">apex only</Td><Td className="font-mono">{domain.ip}</Td><Td><CopyButton value={domain.ip} /></Td></tr>}
                  </tbody>
                </Table>
                <ul className="text-xs text-fg-muted list-disc pl-5 space-y-1">
                  <li>Use the CNAME for subdomains like <Code>status.example.gg</Code>. Use the A record only for a bare domain.</li>
                  <li>On Cloudflare DNS, set the record to <b>DNS only</b> (grey cloud).</li>
                  <li>We check DNS every few minutes. The HTTPS certificate is issued automatically on the first visit. Claims that never connect are released after 7 days.</li>
                </ul>
                {page.customDomain && canEdit && (
                  <Form method="post" className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="intent" value="domain-verify" />
                    <SubmitButton variant="secondary" pendingText="Checking…">Check DNS now</SubmitButton>
                    {page.customDomainVerifiedAt && <a href={`https://${page.customDomain}`} target="_blank" rel="noopener" className="text-xs text-accent hover:underline inline-flex items-center gap-1">https://{page.customDomain}<ExternalLink className="size-3" /></a>}
                  </Form>
                )}
              </div>
            ) : (
              <ol className="text-sm text-fg-muted list-decimal pl-5 space-y-1">
                <li>Add the hostname as a <b>Custom Domain</b> on this Worker in your Cloudflare dashboard (Workers → your worker → Domains &amp; Routes). The domain must be on the same Cloudflare account.</li>
                <li>Cloudflare creates the DNS record and certificate. The page is served at <Code>/</Code> on that hostname, with its own robots.txt, sitemap, llms.txt and feeds.</li>
                <li>Serving many customer domains? Configure the edge proxy in <Code>deploy/edge</Code> and set <Code>CUSTOM_DOMAIN_TARGET</Code>. Current app host: <Code>{appHost}</Code>.</li>
              </ol>
            )}
          </div>
        </Card>
      )}

      {tab === "access" && (
        <Card className="max-w-2xl">
          <CardHeader title="Password protection" description="Visitors must enter a password. Crawlers and the JSON API are blocked too." />
          <Form method="post" className="p-5 space-y-4">
            <input type="hidden" name="intent" value="password" />
            <p className="text-sm">{page.hasPassword ? <Badge tone="accent">Password is set</Badge> : <Badge>Public</Badge>}</p>
            <Field label="New password" name="password" help="Leave empty to remove protection."><Input name="password" type="password" autoComplete="new-password" disabled={disabled} /></Field>
            {canEdit && <SubmitButton>Update</SubmitButton>}
          </Form>
        </Card>
      )}
    </>
  );
}
