import { useState } from "react";
import { Form, data, useFetcher } from "react-router";
import { and, eq } from "drizzle-orm";
import { Bell, Plus, Send, Trash2 } from "lucide-react";
import type { Route } from "./+types/channels";
import { Alert, Badge, Card, CardHeader, Checkbox, EmptyState, Field, Input, PageHeader, Select, SubmitButton } from "~/components/ui";
import { getDb, getEnv, requireAuth, requireRole } from "~/lib/server";
import { channels } from "@server/db/schema";
import type { ChannelType } from "@server/db/schema";
import { newId } from "@server/lib/ids";
import { CHANNEL_TYPES, sendToChannel } from "@server/notify";
import { orgUsage } from "@server/services/usage";
import { limitMessage, planFor } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Notifications — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const rows = await db.select().from(channels).where(eq(channels.orgId, auth.org.id)).orderBy(channels.name).all();
  return { canEdit: auth.org.role !== "viewer", types: CHANNEL_TYPES, channels: rows.map((c) => ({ id: c.id, name: c.name, type: c.type, enabled: c.enabled, isDefault: c.isDefault, summary: c.type === "email" ? c.config.to : c.type === "telegram" ? `chat ${c.config.chatId}` : (c.config.webhookUrl ?? c.config.url ?? "").replace(/^https?:\/\//, "").slice(0, 48) + "…" })) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const secrets = env as unknown as { RESEND_API_KEY?: string; EMAIL_FROM?: string };
  if (intent === "create") {
    const type = String(form.get("type") ?? "") as ChannelType;
    const def = CHANNEL_TYPES.find((t) => t.id === type);
    const name = String(form.get("name") ?? "").trim();
    if (!def || !name) return data({ error: "Name and type are required", tested: null as null | { id: string; ok: boolean; message: string } }, { status: 400 });
    const limit = limitMessage(env, planFor(env, auth.org), (await orgUsage(db, auth.org.id)).channels, "channels", "alert channels");
    if (limit) return data({ error: limit, tested: null }, { status: 400 });
    const config: Record<string, string> = {};
    for (const f of def.fields) {
      const v = String(form.get(`config.${f.key}`) ?? "").trim();
      if (f.required && !v) return data({ error: `${f.label} is required`, tested: null }, { status: 400 });
      if (v) config[f.key] = v;
    }
    await db.insert(channels).values({ id: newId("ch"), orgId: auth.org.id, name, type, config, isDefault: form.get("isDefault") === "on" });
    return data({ error: null, tested: null });
  }
  const id = String(form.get("id") ?? "");
  const ch = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.orgId, auth.org.id))).get();
  if (!ch) throw data("Not found", { status: 404 });
  switch (intent) {
    case "delete": await db.delete(channels).where(eq(channels.id, id)); return data({ error: null, tested: null });
    case "toggle-default": await db.update(channels).set({ isDefault: !ch.isDefault }).where(eq(channels.id, id)); return data({ error: null, tested: null });
    case "toggle-enabled": await db.update(channels).set({ enabled: !ch.enabled }).where(eq(channels.id, id)); return data({ error: null, tested: null });
    case "test": {
      try {
        await sendToChannel(ch, { event: "test", at: Date.now(), appName: "Pylon", message: `Test notification from ${auth.org.name}. If you can read this, ${ch.name} works.` }, secrets);
        return data({ error: null, tested: { id, ok: true, message: "Delivered" } });
      } catch (e) {
        return data({ error: null, tested: { id, ok: false, message: e instanceof Error ? e.message : String(e) } });
      }
    }
  }
  return null;
}

function ChannelRow({ c, canEdit }: { c: Route.ComponentProps["loaderData"]["channels"][number]; canEdit: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const tested = fetcher.data?.tested?.id === c.id ? fetcher.data.tested : null;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Bell className="size-4 text-fg-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{c.name} <span className="text-xs text-fg-muted font-normal">{c.type}</span>{c.isDefault && <Badge tone="accent" className="ml-2">default</Badge>}{!c.enabled && <Badge className="ml-2">disabled</Badge>}</p>
        <p className="text-xs text-fg-muted truncate">{c.summary}</p>
        {tested && <p className={`text-xs ${tested.ok ? "text-up" : "text-down"}`}>{tested.ok ? "✓ " : "✗ "}{tested.message}</p>}
      </div>
      {canEdit && (
        <fetcher.Form method="post" className="flex items-center gap-1" onSubmit={(e) => { if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "delete" && !confirm("Delete this channel?")) e.preventDefault(); }}>
          <input type="hidden" name="id" value={c.id} />
          <button name="intent" value="test" className="btn-secondary btn-sm" disabled={fetcher.state !== "idle"}><Send className="size-3.5" />Test</button>
          <button name="intent" value="toggle-default" className="btn-ghost btn-sm">{c.isDefault ? "Unset default" : "Make default"}</button>
          <button name="intent" value="toggle-enabled" className="btn-ghost btn-sm">{c.enabled ? "Disable" : "Enable"}</button>
          <button name="intent" value="delete" className="btn-ghost btn-sm text-down" aria-label="Delete"><Trash2 className="size-3.5" /></button>
        </fetcher.Form>
      )}
    </li>
  );
}

export default function Channels({ loaderData, actionData }: Route.ComponentProps) {
  const { channels: rows, types, canEdit } = loaderData;
  const [type, setType] = useState<ChannelType>("discord");
  const def = types.find((t) => t.id === type)!;
  return (
    <>
      <PageHeader title="Notifications" description="Where alerts go when a monitor changes state or an incident is posted." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          {rows.length === 0 ? <EmptyState icon={<Bell className="size-5" />} title="No channels yet" description="Add a Discord webhook to get pinged the moment a server goes down." /> : (
            <Card><ul className="divide-y divide-line">{rows.map((c) => <ChannelRow key={c.id} c={c} canEdit={canEdit} />)}</ul></Card>
          )}
          <p className="mt-3 text-xs text-fg-muted"><b>Default</b> channels receive alerts from every monitor. Others must be selected per monitor.</p>
        </div>
        {canEdit && (
          <Card>
            <CardHeader title="Add channel" />
            <Form method="post" className="p-5 space-y-4">
              <input type="hidden" name="intent" value="create" />
              {actionData?.error && <Alert tone="down">{actionData.error}</Alert>}
              <Field label="Type" name="type"><Select name="type" value={type} onChange={(e) => setType(e.target.value as ChannelType)}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
              <Field label="Name" name="name"><Input name="name" required placeholder={`${def.name} · #alerts`} /></Field>
              {def.fields.map((f) => <Field key={f.key} label={f.label} name={`config.${f.key}`} help={f.help}><Input name={`config.${f.key}`} type={f.type === "password" ? "password" : f.type === "url" ? "url" : "text"} placeholder={f.placeholder} required={f.required} autoComplete="off" /></Field>)}
              <Checkbox name="isDefault" label="Default: alert for every monitor" defaultChecked={rows.length === 0} />
              <SubmitButton className="w-full"><Plus className="size-4" />Add channel</SubmitButton>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
