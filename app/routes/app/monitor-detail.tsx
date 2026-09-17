import { Form, Link, data, redirect, useFetcher, useSearchParams } from "react-router";
import { and, desc, eq, gte } from "drizzle-orm";
import { Pause, Pencil, Play, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import type { Route } from "./+types/monitor-detail";
import { Badge, Card, CardHeader, Code, CopyButton, PageHeader, Stat, StatusDot, Table, Td, Th, toneFor, cn } from "~/components/ui";
import { ProbeIcon } from "~/components/icons";
import { TimeChart } from "~/components/status-visuals";
import { formatDataValue, formatDate, relativeTime } from "~/lib/format";
import { appUrl, getDb, getEnv, requireAuth, requireRole } from "~/lib/server";
import { dailyStats, events, monitors, pageComponents, statusPages } from "@server/db/schema";
import { DAY, HOUR, MINUTE, lastDays } from "@server/lib/time";
import { randomToken } from "@server/lib/ids";
import { getProbe, probeAddress } from "@server/probes/registry";
import { deleteMonitor, runnerStub, syncMonitor } from "@server/services/monitors";
import type { ProbeResult } from "@server/probes/types";

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.monitor.name ?? "Monitor"} — Pylon` }];

const RANGES: Record<string, { span: number; bucket: number; label: string }> = {
  "24h": { span: DAY, bucket: 15 * MINUTE, label: "24 hours" },
  "7d": { span: 7 * DAY, bucket: 2 * HOUR, label: "7 days" },
  "30d": { span: 30 * DAY, bucket: 8 * HOUR, label: "30 days" },
};

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  const db = getDb(context);
  const env = getEnv(context);
  const m = await db.select().from(monitors).where(and(eq(monitors.id, params.id), eq(monitors.orgId, auth.org.id))).get();
  if (!m) throw data("Monitor not found", { status: 404 });
  const rangeKey = new URL(request.url).searchParams.get("range") ?? "24h";
  const range = RANGES[rangeKey] ?? RANGES["24h"]!;
  const now = Date.now();
  const stub = runnerStub(env, m.id);
  const [history, buckets, stats, evs, pages] = await Promise.all([
    stub.history({ limit: 40, sinceMs: now - 30 * DAY }).catch(() => []),
    stub.buckets({ sinceMs: now - range.span, bucketMs: range.bucket }).catch(() => []),
    db.select().from(dailyStats).where(and(eq(dailyStats.monitorId, m.id), gte(dailyStats.day, lastDays(30)[0]!))).all(),
    db.select().from(events).where(eq(events.monitorId, m.id)).orderBy(desc(events.createdAt)).limit(20).all(),
    db.select({ id: statusPages.id, name: statusPages.name, slug: statusPages.slug }).from(pageComponents).innerJoin(statusPages, eq(statusPages.id, pageComponents.pageId)).where(eq(pageComponents.monitorId, m.id)).all(),
  ]);
  const uptime = (days: number) => {
    const from = lastDays(days)[0]!;
    const rows = stats.filter((s) => s.day >= from);
    const checks = rows.reduce((a, r) => a + r.checks, 0);
    const failures = rows.reduce((a, r) => a + r.failures, 0);
    return checks ? Math.round(((checks - failures) / checks) * 10000) / 100 : null;
  };
  const okChecks = stats.reduce((a, r) => a + (r.checks - r.failures), 0);
  const avgLatency = okChecks ? Math.round(stats.reduce((a, r) => a + r.latencySum, 0) / okChecks) : null;
  const def = getProbe(m.type);
  return {
    now, rangeKey, ranges: Object.entries(RANGES).map(([k, v]) => ({ key: k, label: v.label })),
    monitor: { ...m, config: def?.fields.some((f) => f.type === "password") ? Object.fromEntries(Object.entries(m.config).map(([k, v]) => [k, def.fields.find((f) => f.key === k)?.type === "password" ? "••••••" : v])) : m.config },
    type: { name: def?.name ?? m.type, icon: def?.icon ?? "Activity", badge: def?.badge ?? null, dataFields: def?.dataFields ?? [], isPush: m.runner === "push" },
    address: probeAddress(m.type, m.config),
    pushUrl: m.pushToken ? `${appUrl(context)}/api/push/${m.pushToken}` : null,
    history, buckets, events: evs, pages,
    uptime: { d1: buckets.length ? (() => { const c = buckets.reduce((a, b) => a + b.checks, 0); const f = buckets.reduce((a, b) => a + b.failures, 0); return c ? Math.round(((c - f) / c) * 10000) / 100 : null; })() : null, d7: uptime(7), d30: uptime(30) },
    avgLatency,
    canEdit: auth.org.role !== "viewer",
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const env = getEnv(context);
  const m = await db.select().from(monitors).where(and(eq(monitors.id, params.id), eq(monitors.orgId, auth.org.id))).get();
  if (!m) throw data("Not found", { status: 404 });
  const intent = String((await request.formData()).get("intent") ?? "");
  switch (intent) {
    case "check": {
      const r = await runnerStub(env, m.id).check().catch((e: Error) => ({ result: { ok: false, error: e.message } as ProbeResult, status: m.status }));
      return { result: r.result };
    }
    case "pause": await db.update(monitors).set({ enabled: false, status: "paused" }).where(eq(monitors.id, m.id)); await syncMonitor(env, db, m.id); return { ok: true };
    case "resume": await db.update(monitors).set({ enabled: true, status: "pending" }).where(eq(monitors.id, m.id)); await syncMonitor(env, db, m.id); return { ok: true };
    case "rotate-token": await db.update(monitors).set({ pushToken: randomToken(24) }).where(eq(monitors.id, m.id)); return { ok: true };
    case "delete": await deleteMonitor(env, db, m.id); throw redirect("/app/monitors");
  }
  return null;
}

export default function MonitorDetail({ loaderData }: Route.ComponentProps) {
  const { monitor: m, type, address, pushUrl, history, buckets, events: evs, pages, uptime, avgLatency, now, rangeKey, ranges, canEdit } = loaderData;
  const check = useFetcher<typeof action>();
  const [, setParams] = useSearchParams();
  const latencySeries = buckets.map((b) => ({ t: b.t, v: b.avgLatency === null ? null : Math.round(b.avgLatency) }));
  const playerSeries = buckets.map((b) => ({ t: b.t, v: b.avgPlayers === null ? null : Math.round(b.avgPlayers) }));
  const hasPlayers = playerSeries.some((p) => p.v !== null);
  const dataEntries = Object.entries(m.lastData ?? {}).filter(([k, v]) => v !== null && v !== undefined && v !== "" && !["sample"].includes(k));
  return (
    <>
      <PageHeader back={{ to: "/app/monitors", label: "Monitors" }}
        title={<span className="flex items-center gap-3"><StatusDot tone={toneFor(m.status)} live={m.status === "up"} className="size-3" />{m.name}</span>}
        description={<span className="flex flex-wrap items-center gap-2"><ProbeIcon name={type.icon} className="size-3.5" />{type.name}{address && <Code>{address}</Code>}<span>every {m.intervalSec}s</span><Badge tone={toneFor(m.status)}>{m.status}</Badge></span>}
        actions={canEdit && (
          <>
            <check.Form method="post"><button name="intent" value="check" className="btn-secondary btn-sm" disabled={check.state !== "idle"}><RefreshCw className={cn("size-3.5", check.state !== "idle" && "animate-spin")} />Check now</button></check.Form>
            <Form method="post">{m.enabled ? <button name="intent" value="pause" className="btn-secondary btn-sm"><Pause className="size-3.5" />Pause</button> : <button name="intent" value="resume" className="btn-secondary btn-sm"><Play className="size-3.5" />Resume</button>}</Form>
            <Link to={`/app/monitors/${m.id}/edit`} className="btn-secondary btn-sm"><Pencil className="size-3.5" />Edit</Link>
            <Form method="post" onSubmit={(e) => { if (!confirm("Delete this monitor and all its history?")) e.preventDefault(); }}><button name="intent" value="delete" className="btn-danger btn-sm"><Trash2 className="size-3.5" />Delete</button></Form>
          </>
        )} />

      {check.data?.result && (
        <div className={cn("mb-4 rounded-lg border p-3 text-sm", check.data.result.ok ? "border-up/40 bg-up/8" : "border-down/40 bg-down/8")}>
          {check.data.result.ok ? "✓" : "✗"} {check.data.result.ok ? check.data.result.message : check.data.result.error}{check.data.result.latencyMs !== undefined ? ` · ${check.data.result.latencyMs} ms` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Uptime · 24h" value={uptime.d1 === null ? "—" : `${uptime.d1}%`} />
        <Stat label="Uptime · 7d" value={uptime.d7 === null ? "—" : `${uptime.d7}%`} />
        <Stat label="Uptime · 30d" value={uptime.d30 === null ? "—" : `${uptime.d30}%`} />
        <Stat label="Avg latency · 30d" value={avgLatency === null ? "—" : `${avgLatency} ms`} hint={m.lastLatencyMs !== null ? `last ${m.lastLatencyMs} ms` : undefined} />
      </div>

      {pushUrl && (
        <Card className="mt-6">
          <CardHeader title="Push URL" description={`Call this at least every ${m.intervalSec}s. Attach JSON (players, tps, …) with POST.`} actions={canEdit && <Form method="post" onSubmit={(e) => { if (!confirm("Rotate the token? The old URL stops working immediately.")) e.preventDefault(); }}><button name="intent" value="rotate-token" className="btn-ghost btn-sm">Rotate token</button></Form>} />
          <div className="p-5 flex flex-wrap items-center gap-3">
            <Code className="text-[13px]">{pushUrl}</Code>
            <CopyButton value={pushUrl} />
          </div>
          <pre className="mx-5 mb-5 rounded-lg bg-[#0b1220] text-[#e8ecf3] p-4 text-xs overflow-x-auto"><code>{`# cron / systemd timer\ncurl -fsS "${pushUrl}?status=up"\n\n# with live metrics (shown on your status page)\ncurl -fsS -X POST "${pushUrl}" -H 'content-type: application/json' -d '{"players":42,"maxPlayers":100,"tps":19.9}'`}</code></pre>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Latency" actions={
              <div className="flex gap-1">{ranges.map((r) => <button key={r.key} type="button" onClick={() => setParams({ range: r.key }, { preventScrollReset: true })} className={cn("btn-sm rounded-md px-2 py-1 text-xs", rangeKey === r.key ? "bg-surface-2 font-medium" : "text-fg-muted hover:text-fg")}>{r.label}</button>)}</div>
            } />
            <div className="p-4"><TimeChart series={latencySeries} unit="ms" /></div>
          </Card>
          {hasPlayers && (
            <Card>
              <CardHeader title="Players" description="Average per bucket" />
              <div className="p-4"><TimeChart series={playerSeries} /></div>
            </Card>
          )}
          <Card>
            <CardHeader title="Recent checks" />
            <Table className="border-0 rounded-none">
              <thead><tr><Th>Time</Th><Th>Status</Th><Th>Latency</Th><Th>Details</Th></tr></thead>
              <tbody>
                {history.length === 0 && <tr><Td className="text-fg-muted" >No checks recorded yet.</Td><Td /><Td /><Td /></tr>}
                {history.map((h) => (
                  <tr key={h.ts}>
                    <Td className="whitespace-nowrap text-xs text-fg-muted" ><span title={formatDate(h.ts)}>{relativeTime(h.ts, now)}</span></Td>
                    <Td><Badge tone={h.ok ? (h.status === "degraded" ? "degraded" : "up") : "down"}>{h.ok ? h.status : "fail"}</Badge></Td>
                    <Td className="tabular-nums text-xs">{h.latency !== null ? `${h.latency} ms` : "—"}</Td>
                    <Td className="text-xs text-fg-muted max-w-md truncate">{h.message}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Live data" description={m.lastCheckedAt ? `Checked ${relativeTime(m.lastCheckedAt, now)}` : "Not checked yet"} />
            <dl className="p-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {dataEntries.length === 0 && <p className="text-fg-muted col-span-2">{m.lastMessage ?? "Waiting for first result…"}</p>}
              {dataEntries.map(([k, v]) => {
                const f = type.dataFields.find((d) => d.key === k);
                return <div key={k} className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-fg-faint">{f?.label ?? k}</dt><dd className="truncate font-medium tabular-nums">{k === "players" && typeof m.lastData?.maxPlayers === "number" ? `${v} / ${m.lastData.maxPlayers}` : formatDataValue(v, f?.format)}</dd></div>;
              })}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Configuration" />
            <dl className="p-5 space-y-2 text-sm">
              {Object.entries(m.config).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-fg-muted">{k}</dt><dd className="font-mono text-xs truncate max-w-[60%]">{String(v)}</dd></div>)}
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">runner</dt><dd className="font-mono text-xs">{m.runner}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">timeout</dt><dd className="font-mono text-xs">{m.timeoutMs} ms</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-fg-muted">retries</dt><dd className="font-mono text-xs">{m.retries}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Shown on" />
            <div className="p-5 text-sm space-y-2">
              {pages.length === 0 && <p className="text-fg-muted">Not on any status page yet. <Link to="/app/pages" className="underline">Add it to one</Link>.</p>}
              {pages.map((p) => <p key={p.id} className="flex items-center justify-between"><Link to={`/app/pages/${p.id}`} className="hover:underline">{p.name}</Link><a href={`/s/${p.slug}`} target="_blank" rel="noopener" className="text-fg-muted hover:text-fg"><ExternalLink className="size-3.5" /></a></p>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Status changes" />
            <ul className="p-5 space-y-3 text-sm">
              {evs.length === 0 && <li className="text-fg-muted">No transitions recorded.</li>}
              {evs.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <StatusDot tone={toneFor(e.toStatus)} className="mt-1.5" />
                  <div className="min-w-0"><p>{e.fromStatus} → <span className="font-medium">{e.toStatus}</span></p>{e.message && <p className="text-xs text-fg-muted truncate">{e.message}</p>}<p className="text-xs text-fg-faint">{formatDate(e.createdAt)}</p></div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
