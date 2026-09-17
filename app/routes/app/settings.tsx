import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { KeyRound, Trash2, Users } from "lucide-react";
import type { Route } from "./+types/settings";
import { Alert, Badge, Card, CardHeader, Code, CopyButton, Field, Input, PageHeader, Select, SubmitButton } from "~/components/ui";
import { formatDate, relativeTime } from "~/lib/format";
import { appUrl, getDb, getEnv, parseForm, requireAuth, requireRole } from "~/lib/server";
import { apiKeys, orgInvites, orgMembers, organizations, users } from "@server/db/schema";
import type { OrgRole } from "@server/db/schema";
import { newId, randomToken } from "@server/lib/ids";
import { DAY } from "@server/lib/time";
import { createApiKey } from "@server/auth/api-keys";
import { orgUsage } from "@server/services/usage";
import { billingUrl, fmtLimit, isHosted, limitMessage, planFor, upgradeHint } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Settings — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const [members, invites, keys] = await Promise.all([
    db.select({ userId: users.id, name: users.name, email: users.email, role: orgMembers.role }).from(orgMembers).innerJoin(users, eq(users.id, orgMembers.userId)).where(eq(orgMembers.orgId, auth.org.id)).all(),
    db.select().from(orgInvites).where(eq(orgInvites.orgId, auth.org.id)).all(),
    db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, lastUsedAt: apiKeys.lastUsedAt, createdAt: apiKeys.createdAt }).from(apiKeys).where(eq(apiKeys.orgId, auth.org.id)).all(),
  ]);
  const env = getEnv(context);
  const plan = planFor(env, auth.org);
  const usage = await orgUsage(db, auth.org.id);
  return {
    org: auth.org, me: auth.user.id, members, invites, keys, site: appUrl(context), now: Date.now(), isAdmin: auth.org.role === "admin" || auth.org.role === "owner", isOwner: auth.org.role === "owner",
    plan: { id: plan.id, name: plan.name, hosted: isHosted(env), billing: billingUrl(env), hint: upgradeHint(env), features: plan.features,
      rows: (["monitors", "statusPages", "relays", "channels", "members", "apiKeys"] as const).map((k) => ({ key: k, label: { monitors: "Monitors", statusPages: "Status pages", relays: "Relays", channels: "Alert channels", members: "Team members", apiKeys: "API keys" }[k], used: usage[k], limit: fmtLimit(plan.limits[k]), pct: Number.isFinite(plan.limits[k]) ? Math.min(100, Math.round((usage[k] / plan.limits[k]) * 100)) : 0 })),
      minIntervalSec: plan.limits.minIntervalSec, historyDays: plan.limits.historyDays, customDomain: plan.limits.customDomain, hideBranding: plan.limits.hideBranding },
  };
}

const ROLES: OrgRole[] = ["viewer", "member", "admin", "owner"];

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ok = (message: string, extra: Record<string, unknown> = {}) => data({ message, error: null as string | null, ...extra });
  const fail = (error: string) => data({ message: null as string | null, error }, { status: 400 });
  switch (intent) {
    case "org": {
      requireRole(auth, "admin");
      const p = parseForm(form, z.object({ name: z.string().trim().min(1).max(60) }));
      if (!p.ok) return fail("Name is required");
      await db.update(organizations).set({ name: p.data.name }).where(eq(organizations.id, auth.org.id));
      return ok("Saved");
    }
    case "invite": {
      requireRole(auth, "admin");
      const p = parseForm(form, z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["viewer", "member", "admin"]) }));
      if (!p.ok) return fail("Enter a valid email");
      { const env = getEnv(context); const limit = limitMessage(env, planFor(env, auth.org), (await orgUsage(db, auth.org.id)).members, "members", "team members"); if (limit) return fail(limit); }
      const token = randomToken(24);
      await db.insert(orgInvites).values({ id: newId("inv"), orgId: auth.org.id, email: p.data.email, role: p.data.role, token, expiresAt: Date.now() + 7 * DAY });
      return ok("Invite created", { inviteUrl: `${appUrl(context)}/invite/${token}` });
    }
    case "invite-delete": requireRole(auth, "admin"); await db.delete(orgInvites).where(and(eq(orgInvites.id, String(form.get("id"))), eq(orgInvites.orgId, auth.org.id))); return ok("Invite revoked");
    case "member-role": {
      requireRole(auth, "owner");
      const userId = String(form.get("userId"));
      const role = String(form.get("role")) as OrgRole;
      if (!ROLES.includes(role) || userId === auth.user.id) return fail("Invalid change");
      await db.update(orgMembers).set({ role }).where(and(eq(orgMembers.orgId, auth.org.id), eq(orgMembers.userId, userId)));
      return ok("Role updated");
    }
    case "member-remove": {
      requireRole(auth, "admin");
      const userId = String(form.get("userId"));
      if (userId === auth.user.id) return fail("You can't remove yourself");
      await db.delete(orgMembers).where(and(eq(orgMembers.orgId, auth.org.id), eq(orgMembers.userId, userId)));
      return ok("Member removed");
    }
    case "key-create": {
      requireRole(auth, "admin");
      { const env = getEnv(context); const limit = limitMessage(env, planFor(env, auth.org), (await orgUsage(db, auth.org.id)).apiKeys, "apiKeys", "API keys"); if (limit) return fail(limit); }
      const name = String(form.get("name") ?? "").trim() || "API key";
      const { key } = await createApiKey(db, auth.org.id, name);
      return ok("API key created", { apiKey: key });
    }
    case "key-delete": requireRole(auth, "admin"); await db.delete(apiKeys).where(and(eq(apiKeys.id, String(form.get("id"))), eq(apiKeys.orgId, auth.org.id))); return ok("Key revoked");
    case "org-delete": {
      requireRole(auth, "owner");
      if (String(form.get("confirm")) !== auth.org.slug) return fail("Type the team slug to confirm");
      await db.delete(organizations).where(eq(organizations.id, auth.org.id));
      throw redirect("/onboarding");
    }
  }
  return null;
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { org, me, members, invites, keys, now, isAdmin, isOwner, plan } = loaderData;
  const extra = actionData as (typeof actionData & { inviteUrl?: string; apiKey?: string }) | undefined;
  return (
    <>
      <PageHeader title="Settings" description={org.name} />
      {actionData?.message && <Alert tone="up" className="mb-4">{actionData.message}</Alert>}
      {actionData?.error && <Alert tone="down" className="mb-4">{actionData.error}</Alert>}
      {extra?.inviteUrl && <Alert tone="accent" className="mb-4"><p>Send this link (valid 7 days):</p><div className="mt-1 flex flex-wrap items-center gap-2"><Code>{extra.inviteUrl}</Code><CopyButton value={extra.inviteUrl} /></div></Alert>}
      {extra?.apiKey && <Alert tone="accent" className="mb-4"><p>Your new API key — copy it now, it won't be shown again:</p><div className="mt-1 flex flex-wrap items-center gap-2"><Code>{extra.apiKey}</Code><CopyButton value={extra.apiKey} /></div></Alert>}
      {plan.hosted && (
        <Card className="mb-6">
          <CardHeader title={<span className="flex items-center gap-2">Plan & usage <Badge tone={plan.id === "pro" ? "accent" : "neutral"}>{plan.name}</Badge></span>}
            description={`Checks every ${plan.minIntervalSec}s or slower · ${plan.historyDays}-day history${plan.customDomain ? " · custom domains" : ""}${plan.hideBranding ? " · white-label" : ""}`}
            actions={plan.id !== "pro" ? (plan.billing ? <a href={plan.billing} className="btn-accent btn-sm" target="_blank" rel="noopener">Upgrade to Pro</a> : <span className="text-xs text-fg-muted">{plan.hint}</span>) : undefined} />
          <ul className="grid gap-x-8 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {plan.rows.map((r) => (
              <li key={r.key}>
                <div className="flex justify-between text-sm"><span>{r.label}</span><span className="tabular-nums text-fg-muted">{r.used} / {r.limit}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className={`h-1.5 rounded-full ${r.pct >= 100 ? "bg-down" : r.pct >= 80 ? "bg-degraded" : "bg-accent"}`} style={{ width: `${r.pct}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Team" />
          <Form method="post" className="p-5 flex gap-2 items-end">
            <input type="hidden" name="intent" value="org" />
            <Field label="Team name" name="name" className="flex-1"><Input name="name" defaultValue={org.name} disabled={!isAdmin} /></Field>
            {isAdmin && <SubmitButton variant="secondary">Save</SubmitButton>}
          </Form>
          <div className="px-5 pb-5 text-xs text-fg-muted">Slug: <Code>{org.slug}</Code>{plan.hosted && <> · Plan: <Badge>{plan.name}</Badge></>}{!plan.hosted && <> · Self-hosted, no limits</>}</div>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Users className="size-4" />Members</span>} />
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium truncate">{m.name}{m.userId === me && <span className="text-fg-muted font-normal"> (you)</span>}</p><p className="text-xs text-fg-muted truncate">{m.email}</p></div>
                {isOwner && m.userId !== me ? (
                  <Form method="post" className="flex items-center gap-1"><input type="hidden" name="intent" value="member-role" /><input type="hidden" name="userId" value={m.userId} /><Select name="role" defaultValue={m.role} className="w-28 py-1 text-xs" onChange={(e) => e.currentTarget.form?.requestSubmit()}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</Select></Form>
                ) : <Badge>{m.role}</Badge>}
                {isAdmin && m.userId !== me && <Form method="post" onSubmit={(e) => { if (!confirm(`Remove ${m.name}?`)) e.preventDefault(); }}><input type="hidden" name="intent" value="member-remove" /><input type="hidden" name="userId" value={m.userId} /><button className="btn-ghost btn-sm text-down"><Trash2 className="size-3.5" /></button></Form>}
              </li>
            ))}
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="truncate">{i.email}</p><p className="text-xs text-fg-muted">Invited · {i.role} · expires {relativeTime(i.expiresAt, now)}</p></div>
                <Badge tone="degraded">pending</Badge>
                {isAdmin && <Form method="post"><input type="hidden" name="intent" value="invite-delete" /><input type="hidden" name="id" value={i.id} /><button className="btn-ghost btn-sm text-down"><Trash2 className="size-3.5" /></button></Form>}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <Form method="post" className="border-t border-line p-5 flex flex-wrap gap-2 items-end">
              <input type="hidden" name="intent" value="invite" />
              <Field label="Invite by email" name="email" className="flex-1 min-w-48"><Input name="email" type="email" required placeholder="teammate@example.com" /></Field>
              <Field label="Role" name="role"><Select name="role" defaultValue="member"><option value="viewer">viewer</option><option value="member">member</option><option value="admin">admin</option></Select></Field>
              <SubmitButton variant="secondary">Create invite link</SubmitButton>
            </Form>
          )}
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="size-4" />API keys</span>} description="Read access to /api/v1. Send as Authorization: Bearer <key>." />
          <ul className="divide-y divide-line">
            {keys.length === 0 && <li className="px-5 py-4 text-sm text-fg-muted">No API keys.</li>}
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{k.name}</p><p className="text-xs text-fg-muted"><Code>{`${k.prefix}…`}</Code> · created {formatDate(k.createdAt, { dateStyle: "medium" })}{k.lastUsedAt ? ` · used ${relativeTime(k.lastUsedAt, now)}` : ""}</p></div>
                {isAdmin && <Form method="post" onSubmit={(e) => { if (!confirm("Revoke this key?")) e.preventDefault(); }}><input type="hidden" name="intent" value="key-delete" /><input type="hidden" name="id" value={k.id} /><button className="btn-ghost btn-sm text-down"><Trash2 className="size-3.5" /></button></Form>}
              </li>
            ))}
          </ul>
          {isAdmin && <Form method="post" className="border-t border-line p-5 flex gap-2 items-end"><input type="hidden" name="intent" value="key-create" /><Field label="Key name" name="name" className="flex-1"><Input name="name" placeholder="Discord bot" /></Field><SubmitButton variant="secondary">Create key</SubmitButton></Form>}
        </Card>
        {isOwner && (
          <Card>
            <CardHeader title="Danger zone" />
            <Form method="post" className="p-5 space-y-3" onSubmit={(e) => { if (!confirm("Delete the whole team, all monitors, pages and incidents?")) e.preventDefault(); }}>
              <input type="hidden" name="intent" value="org-delete" />
              <Field label={`Type "${org.slug}" to delete this team`} name="confirm"><Input name="confirm" placeholder={org.slug} /></Field>
              <SubmitButton variant="danger">Delete team</SubmitButton>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
