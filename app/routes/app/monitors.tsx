import { Link, useFetcher, data } from "react-router";
import { and, eq } from "drizzle-orm";
import { Activity, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Route } from "./+types/monitors";
import { Badge, EmptyState, PageHeader, StatusDot, Table, Td, Th, toneFor } from "~/components/ui";
import { ProbeIcon } from "~/components/icons";
import { relativeTime } from "~/lib/format";
import { getDb, getEnv, requireAuth, requireRole } from "~/lib/server";
import { monitors, relays } from "@server/db/schema";
import { getProbe, probeAddress } from "@server/probes/registry";
import { deleteMonitor, runnerStub, syncMonitor } from "@server/services/monitors";
import type { ProbeResult } from "@server/probes/types";

export const meta: Route.MetaFunction = () => [{ title: "Monitors — Pylon" }];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const [mons, rls] = await Promise.all([
    db.select().from(monitors).where(eq(monitors.orgId, auth.org.id)).orderBy(monitors.name).all(),
    db.select({ id: relays.id, name: relays.name }).from(relays).where(eq(relays.orgId, auth.org.id)).all(),
  ]);
  const relayName = new Map(rls.map((r) => [r.id, r.name]));
  return {
    now: Date.now(),
    canEdit: auth.org.role !== "viewer",
    monitors: mons.map((m) => {
      const def = getProbe(m.type);
      return {
        id: m.id, name: m.name, type: m.type, typeName: def?.name ?? m.type, badge: def?.badge ?? null, icon: def?.icon ?? "Activity", address: probeAddress(m.type, m.config),
        status: m.status, enabled: m.enabled, intervalSec: m.intervalSec, lastCheckedAt: m.lastCheckedAt, latency: m.lastLatencyMs, message: m.lastMessage, data: m.lastData,
        runner: m.runner === "edge" ? "Edge" : m.runner === "push" ? "Push" : relayName.get(m.runner) ?? "Relay (missing)",
      };
    }),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const env = getEnv(context);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "");
  const m = await db.select().from(monitors).where(and(eq(monitors.id, id), eq(monitors.orgId, auth.org.id))).get();
  if (!m) throw data("Monitor not found", { status: 404 });
  switch (intent) {
    case "check": {
      const r = await runnerStub(env, m.id).check().catch((e: Error) => ({ result: { ok: false, error: e.message } as ProbeResult, status: m.status }));
      return { checked: id, result: r.result };
    }
    case "pause":
      await db.update(monitors).set({ enabled: false, status: "paused" }).where(eq(monitors.id, id));
      await syncMonitor(env, db, id);
      return { ok: true };
    case "resume":
      await db.update(monitors).set({ enabled: true, status: "pending" }).where(eq(monitors.id, id));
      await syncMonitor(env, db, id);
      return { ok: true };
    case "delete":
      await deleteMonitor(env, db, id);
      return { ok: true };
  }
  return null;
}

function RowActions({ id, enabled }: { id: string; enabled: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="flex items-center justify-end gap-1" onSubmit={(e) => { const i = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value"); if (i === "delete" && !confirm("Delete this monitor and its history?")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button name="intent" value="check" disabled={busy} className="btn-ghost btn-sm" title="Check now"><RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /></button>
      {enabled ? <button name="intent" value="pause" disabled={busy} className="btn-ghost btn-sm" title="Pause"><Pause className="size-3.5" /></button>
               : <button name="intent" value="resume" disabled={busy} className="btn-ghost btn-sm" title="Resume"><Play className="size-3.5" /></button>}
      <button name="intent" value="delete" disabled={busy} className="btn-ghost btn-sm text-down" title="Delete"><Trash2 className="size-3.5" /></button>
    </fetcher.Form>
  );
}

export default function Monitors({ loaderData }: Route.ComponentProps) {
  const { monitors: mons, now, canEdit } = loaderData;
  return (
    <>
      <PageHeader title="Monitors" description={`${mons.length} monitor${mons.length === 1 ? "" : "s"}`} actions={canEdit && <Link to="/app/monitors/new" className="btn-primary btn-sm"><Plus className="size-4" />Add monitor</Link>} />
      {mons.length === 0 ? (
        <EmptyState icon={<Activity className="size-5" />} title="No monitors yet" description="Add your first game server, website or heartbeat." action={<Link to="/app/monitors/new" className="btn-primary">Add monitor</Link>} />
      ) : (
        <Table>
          <thead><tr><Th>Monitor</Th><Th className="hidden md:table-cell">Type</Th><Th className="hidden lg:table-cell">Live data</Th><Th className="hidden sm:table-cell">Latency</Th><Th>Checked</Th>{canEdit && <Th className="text-right">Actions</Th>}</tr></thead>
          <tbody>
            {mons.map((m) => (
              <tr key={m.id} className="hover:bg-surface-2/40">
                <Td>
                  <Link to={`/app/monitors/${m.id}`} className="flex items-center gap-3">
                    <StatusDot tone={toneFor(m.status)} />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{m.name}</p>
                      <p className="text-xs text-fg-muted truncate font-mono">{m.address || m.runner}</p>
                    </div>
                  </Link>
                </Td>
                <Td className="hidden md:table-cell"><span className="inline-flex items-center gap-1.5 text-xs text-fg-muted"><ProbeIcon name={m.icon} className="size-3.5" />{m.typeName}</span></Td>
                <Td className="hidden lg:table-cell text-xs text-fg-muted">
                  {typeof m.data?.players === "number" ? <span className="tabular-nums">{m.data.players}{typeof m.data.maxPlayers === "number" ? `/${m.data.maxPlayers}` : ""} players{typeof m.data.version === "string" ? ` · ${m.data.version}` : ""}</span> : <span className="truncate block max-w-64">{m.message ?? "—"}</span>}
                </Td>
                <Td className="hidden sm:table-cell tabular-nums text-fg-muted">{m.latency !== null ? `${m.latency} ms` : "—"}</Td>
                <Td className="text-xs text-fg-muted whitespace-nowrap">{m.status === "paused" ? <Badge>paused</Badge> : m.lastCheckedAt ? relativeTime(m.lastCheckedAt, now) : <Badge>pending</Badge>}</Td>
                {canEdit && <Td><RowActions id={m.id} enabled={m.enabled} /></Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
