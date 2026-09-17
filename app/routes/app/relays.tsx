import { Form, data } from "react-router";
import { and, eq, sql } from "drizzle-orm";
import { Plus, Radio, Trash2 } from "lucide-react";
import type { Route } from "./+types/relays";
import { Alert, Badge, Card, CardHeader, Code, CopyButton, EmptyState, Field, Input, PageHeader, SubmitButton } from "~/components/ui";
import { relativeTime } from "~/lib/format";
import { appUrl, getDb, getEnv, requireAuth, requireRole } from "~/lib/server";
import { monitors, relays } from "@server/db/schema";
import { newId, randomToken, sha256Hex } from "@server/lib/ids";
import { orgUsage } from "@server/services/usage";
import { limitMessage, planFor } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Relays — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const rows = await db.select({ relay: relays, monitors: sql<number>`(select count(*) from ${monitors} where ${monitors.runner} = ${relays.id})` }).from(relays).where(eq(relays.orgId, auth.org.id)).orderBy(relays.name).all();
  return { now: Date.now(), site: appUrl(context), canEdit: auth.org.role !== "viewer", relays: rows.map((r) => ({ id: r.relay.id, name: r.relay.name, region: r.relay.region, lastSeenAt: r.relay.lastSeenAt, version: r.relay.version, monitors: r.monitors })) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "admin");
  const db = getDb(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    const region = String(form.get("region") ?? "").trim() || "default";
    if (!name) return data({ error: "Name is required", created: null as null | { name: string; token: string } }, { status: 400 });
    const env = getEnv(context);
    const limit = limitMessage(env, planFor(env, auth.org), (await orgUsage(db, auth.org.id)).relays, "relays", "relays");
    if (limit) return data({ error: limit, created: null }, { status: 400 });
    const token = `prl_${randomToken(24)}`;
    await db.insert(relays).values({ id: newId("rly"), orgId: auth.org.id, name, region, tokenHash: await sha256Hex(token) });
    return data({ error: null, created: { name, token } });
  }
  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const r = await db.select({ id: relays.id }).from(relays).where(and(eq(relays.id, id), eq(relays.orgId, auth.org.id))).get();
    if (!r) throw data("Not found", { status: 404 });
    await db.update(monitors).set({ enabled: false, status: "paused" }).where(eq(monitors.runner, id));
    await db.delete(relays).where(eq(relays.id, id));
    return data({ error: null, created: null });
  }
  return null;
}

export default function Relays({ loaderData, actionData }: Route.ComponentProps) {
  const { relays: rows, now, site, canEdit } = loaderData;
  const created = actionData?.created;
  return (
    <>
      <PageHeader title="Relays" description="Self-hosted probe runners. Add UDP games (A2S, Bedrock, GameDig), LAN hosts, and extra regions." />
      {created && (
        <Alert tone="up" className="mb-6">
          <p className="font-medium">Relay “{created.name}” created. Copy the token now — it won't be shown again.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2"><Code>{created.token}</Code><CopyButton value={created.token} /></div>
          <pre className="mt-3 rounded-lg bg-[#0b1220] text-[#e8ecf3] p-3 text-xs overflow-x-auto"><code>{`docker run -d --name pylon-relay --restart=always \\\n  -e PYLON_URL=${site} -e PYLON_TOKEN=${created.token} \\\n  ghcr.io/jackh54/pylon-relay:latest\n\n# or from source (Node 20+):\ngit clone https://github.com/jackh54/Pylon && cd Pylon/relay && npm ci\nPYLON_URL=${site} PYLON_TOKEN=${created.token} node index.js`}</code></pre>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          {rows.length === 0 ? <EmptyState icon={<Radio className="size-5" />} title="No relays" description="Relays are optional. Most HTTP, TCP, Minecraft Java, FiveM, RCON and panel checks run from the edge without one." /> : (
            <Card><ul className="divide-y divide-line">
              {rows.map((r) => {
                const online = r.lastSeenAt && now - r.lastSeenAt < 3 * 60_000;
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`size-2.5 rounded-full ${online ? "bg-up" : "bg-unknown"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{r.name} <Badge className="ml-1">{r.region}</Badge></p>
                      <p className="text-xs text-fg-muted">{r.lastSeenAt ? `Seen ${relativeTime(r.lastSeenAt, now)}` : "Never connected"}{r.version ? ` · v${r.version}` : ""} · {r.monitors} monitors</p>
                    </div>
                    {canEdit && <Form method="post" onSubmit={(e) => { if (!confirm("Delete this relay? Its monitors will be paused.")) e.preventDefault(); }}><input type="hidden" name="id" value={r.id} /><button name="intent" value="delete" className="btn-ghost btn-sm text-down"><Trash2 className="size-3.5" /></button></Form>}
                  </li>
                );
              })}
            </ul></Card>
          )}
        </div>
        {canEdit && (
          <Card>
            <CardHeader title="New relay" />
            <Form method="post" className="p-5 space-y-4">
              <input type="hidden" name="intent" value="create" />
              {actionData?.error && <Alert tone="down">{actionData.error}</Alert>}
              <Field label="Name" name="name"><Input name="name" required placeholder="Hetzner Falkenstein" /></Field>
              <Field label="Region label" name="region"><Input name="region" placeholder="eu-central" /></Field>
              <SubmitButton className="w-full"><Plus className="size-4" />Create relay</SubmitButton>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
