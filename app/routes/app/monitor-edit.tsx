import { useState } from "react";
import { Form, Link, data, redirect, useFetcher } from "react-router";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { Play } from "lucide-react";
import type { Route } from "./+types/monitor-edit";
import { Alert, Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select, SubmitButton, Textarea, cn } from "~/components/ui";
import { ProbeIcon } from "~/components/icons";
import { Markdown } from "~/lib/markdown";
import { getDb, getEnv, requireAuth, requireRole } from "~/lib/server";
import { channels, monitorChannels, monitors, relays } from "@server/db/schema";
import { newId, randomToken } from "@server/lib/ids";
import { parseProbeConfig, probeCatalog, runProbe } from "@server/probes/registry";
import type { ProbeCatalogEntry } from "@server/probes/registry";
import { syncMonitor } from "@server/services/monitors";
import { orgUsage } from "@server/services/usage";
import { isHosted, limitMessage, planFor } from "@server/plans";

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.monitor ? "Edit monitor" : "New monitor"} — Pylon` }];

export async function loader({ params, context }: Route.LoaderArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const [chs, rls] = await Promise.all([
    db.select({ id: channels.id, name: channels.name, type: channels.type, isDefault: channels.isDefault }).from(channels).where(eq(channels.orgId, auth.org.id)).all(),
    db.select({ id: relays.id, name: relays.name, region: relays.region }).from(relays).where(eq(relays.orgId, auth.org.id)).all(),
  ]);
  let monitor = null;
  let linked: string[] = [];
  if (params.id) {
    const m = await db.select().from(monitors).where(and(eq(monitors.id, params.id), eq(monitors.orgId, auth.org.id))).get();
    if (!m) throw data("Monitor not found", { status: 404 });
    monitor = m;
    linked = (await db.select({ id: monitorChannels.channelId }).from(monitorChannels).where(eq(monitorChannels.monitorId, m.id)).all()).map((r) => r.id);
  }
  const env = getEnv(context);
  const plan = planFor(env, auth.org);
  const usage = await orgUsage(db, auth.org.id);
  return { catalog: probeCatalog(), channels: chs, relays: rls, monitor, linked, plan: { name: plan.name, hosted: isHosted(env), minIntervalSec: plan.limits.minIntervalSec, monitors: plan.limits.monitors, used: usage.monitors } };
}

const baseSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(80),
  type: z.string().min(1),
  intervalSec: z.coerce.number().int().min(20, "Minimum 20 seconds").max(86400),
  timeoutMs: z.coerce.number().int().min(1000).max(60000),
  retries: z.coerce.number().int().min(1).max(10),
  degradedLatencyMs: z.string().optional(),
  runner: z.string().default("edge"),
});

function collectConfig(form: FormData, def: ProbeCatalogEntry): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const f of def.fields) {
    const raw = form.get(`cfg.${f.key}`);
    if (f.type === "boolean") { cfg[f.key] = raw === "on" || raw === "true"; continue; }
    if (typeof raw === "string" && raw.trim() !== "") cfg[f.key] = raw.trim();
  }
  return cfg;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  requireRole(auth, "member");
  const db = getDb(context);
  const env = getEnv(context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;

  const type = String(form.get("type") ?? "");
  const def = probeCatalog().find((p) => p.id === type);
  if (!def) return data({ errors: { type: "Pick a monitor type" }, values, test: null }, { status: 400 });
  let config: Record<string, unknown>;
  try {
    config = parseProbeConfig(type, collectConfig(form, def));
  } catch (e) {
    const errors: Record<string, string> = {};
    if (e instanceof z.ZodError) for (const i of e.issues) errors[`cfg.${i.path.join(".")}`] = i.message;
    else errors._ = e instanceof Error ? e.message : String(e);
    return data({ errors, values, test: null }, { status: 400 });
  }

  if (intent === "test") {
    const timeoutMs = Number(form.get("timeoutMs") || 10000);
    const test = def.runsOn.includes("edge") ? await runProbe(type, config, { timeoutMs, secrets: { STEAM_API_KEY: env.STEAM_API_KEY } }) : { ok: false, error: `${def.name} does not run on the edge; assign it to a relay and save.` };
    return data({ errors: {}, values, test }, { status: 200 });
  }

  const parsed = baseSchema.safeParse(values);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[i.path.join(".")] = i.message;
    return data({ errors, values, test: null }, { status: 400 });
  }
  const b = parsed.data;
  const plan = planFor(env, auth.org);
  if (b.intervalSec < plan.limits.minIntervalSec) return data({ errors: { intervalSec: `The ${plan.name} plan checks at most every ${plan.limits.minIntervalSec} seconds.` }, values, test: null }, { status: 400 });
  if (!params.id) {
    const msg = limitMessage(env, plan, (await orgUsage(db, auth.org.id)).monitors, "monitors", "monitors");
    if (msg) return data({ errors: { _: msg }, values, test: null }, { status: 400 });
  }
  let runner = b.runner;
  if (def.runsOn.includes("push")) runner = "push";
  else if (runner !== "edge") {
    const relay = await db.select({ id: relays.id }).from(relays).where(and(eq(relays.id, runner), eq(relays.orgId, auth.org.id))).get();
    if (!relay) return data({ errors: { runner: "Choose a relay" }, values, test: null }, { status: 400 });
  } else if (!def.runsOn.includes("edge")) {
    return data({ errors: { runner: `${def.name} needs a relay. Create one under Relays first.` }, values, test: null }, { status: 400 });
  }
  const degraded = b.degradedLatencyMs && b.degradedLatencyMs.trim() ? Math.max(1, Number(b.degradedLatencyMs)) : null;
  const channelIds = form.getAll("channels").map(String);

  let id = params.id;
  if (id) {
    const existing = await db.select({ id: monitors.id, type: monitors.type, pushToken: monitors.pushToken }).from(monitors).where(and(eq(monitors.id, id), eq(monitors.orgId, auth.org.id))).get();
    if (!existing) throw data("Not found", { status: 404 });
    await db.update(monitors).set({
      name: b.name, type, config, intervalSec: b.intervalSec, timeoutMs: b.timeoutMs, retries: b.retries, degradedLatencyMs: degraded, runner, updatedAt: Date.now(),
      pushToken: runner === "push" ? existing.pushToken ?? randomToken(24) : existing.pushToken,
    }).where(eq(monitors.id, id));
    await db.delete(monitorChannels).where(eq(monitorChannels.monitorId, id));
  } else {
    id = newId("mon");
    await db.insert(monitors).values({ id, orgId: auth.org.id, name: b.name, type, config, intervalSec: b.intervalSec, timeoutMs: b.timeoutMs, retries: b.retries, degradedLatencyMs: degraded, runner, pushToken: runner === "push" ? randomToken(24) : null });
  }
  if (channelIds.length) await db.insert(monitorChannels).values(channelIds.map((channelId) => ({ monitorId: id!, channelId })));
  await syncMonitor(env, db, id);
  throw redirect(`/app/monitors/${id}`);
}

export default function MonitorEdit({ loaderData, actionData }: Route.ComponentProps) {
  const { catalog, channels: chs, relays: rls, monitor, linked, plan } = loaderData;
  const values: Record<string, string> = actionData?.values ?? {};
  const errors: Record<string, string> = actionData?.errors ?? {};
  const [type, setType] = useState<string>(values.type ?? monitor?.type ?? "minecraft-java");
  const def = catalog.find((p) => p.id === type)!;
  const cfg = (monitor?.config ?? {}) as Record<string, unknown>;
  const val = (key: string, fallback: unknown = ""): unknown => values[`cfg.${key}`] ?? cfg[key] ?? (def.defaults as Record<string, unknown>)[key] ?? fallback;
  const testFetcher = useFetcher<typeof action>();
  const test = testFetcher.data?.test ?? null;
  const [runner, setRunner] = useState<string>(values.runner ?? monitor?.runner ?? (def.runsOn.includes("edge") ? "edge" : rls[0]?.id ?? "edge"));
  const groups: { key: ProbeCatalogEntry["category"]; label: string }[] = [{ key: "game", label: "Game servers" }, { key: "generic", label: "Generic" }, { key: "push", label: "Push" }];

  return (
    <>
      <PageHeader title={monitor ? `Edit ${monitor.name}` : "New monitor"} back={{ to: monitor ? `/app/monitors/${monitor.id}` : "/app/monitors", label: monitor ? "Back to monitor" : "Monitors" }} />
      <Form method="post" className="grid gap-6 lg:grid-cols-[1fr_320px]" id="monitor-form">
        <div className="space-y-6">
          {errors._ && <Alert tone="down">{errors._}</Alert>}
          <Card>
            <CardHeader title="What do you want to monitor?" description="Pick a type. Fields adapt to the protocol." />
            <div className="p-5 space-y-5">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="text-[11px] uppercase tracking-wide text-fg-faint font-medium mb-2">{g.label}</p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {catalog.filter((p) => p.category === g.key).map((p) => (
                      <button key={p.id} type="button" onClick={() => { setType(p.id); if (!p.runsOn.includes("edge") && !p.runsOn.includes("push")) setRunner(rls[0]?.id ?? "edge"); }}
                        className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors", type === p.id ? "border-accent bg-accent/8 ring-1 ring-accent" : "border-line hover:bg-surface-2/60")}>
                        <ProbeIcon name={p.icon} className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{p.name}</p>
                          <p className="mt-0.5 text-[11px] text-fg-muted line-clamp-2">{p.description}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <input type="hidden" name="type" value={type} />
            </div>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><ProbeIcon name={def.icon} className="size-4" />{def.name}</span>} description={def.description}
              actions={<div className="flex gap-1">{def.runsOn.map((r) => <Badge key={r} tone={r === "edge" ? "accent" : "neutral"}>{r}</Badge>)}</div>} />
            <div className="p-5 grid gap-4 sm:grid-cols-2">
              <Field label="Name" name="name" error={errors.name} className="sm:col-span-2"><Input name="name" required defaultValue={values.name ?? monitor?.name ?? ""} placeholder="Survival — play.example.gg" /></Field>
              {def.fields.map((f) => {
                const name = `cfg.${f.key}`;
                const error = errors[name];
                const common = { name, required: f.required, placeholder: f.placeholder };
                return (
                  <Field key={f.key} label={f.label} name={name} error={error} help={f.help} className={f.half ? "" : "sm:col-span-2"}>
                    {f.type === "select" ? (
                      <Select {...common} defaultValue={String(val(f.key, f.options?.[0]?.value ?? ""))}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                    ) : f.type === "textarea" ? (
                      <Textarea {...common} defaultValue={String(val(f.key))} />
                    ) : f.type === "boolean" ? (
                      <div className="pt-2"><Checkbox name={name} label={f.label} defaultChecked={val(f.key, false) === true || val(f.key) === "on" || val(f.key) === "true"} /></div>
                    ) : (
                      <Input {...common} type={f.type === "number" ? "number" : f.type === "password" ? "password" : f.type === "url" ? "url" : "text"} defaultValue={String(val(f.key))} autoComplete={f.type === "password" ? "new-password" : "off"} />
                    )}
                  </Field>
                );
              })}
              {def.docs && <div className="sm:col-span-2 prose-doc text-sm rounded-lg bg-surface-2/60 border border-line p-4 [&_pre]:my-2 [&_p]:my-1"><Markdown text={def.docs} /></div>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Schedule & thresholds" description={plan.hosted ? `${plan.name} plan: checks every ${plan.minIntervalSec}s or slower · ${plan.used}/${Number.isFinite(plan.monitors) ? plan.monitors : "∞"} monitors used` : undefined} />
            <div className="p-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={def.category === "push" ? "Expected every (sec)" : "Interval (seconds)"} name="intervalSec" error={errors.intervalSec}><Input name="intervalSec" type="number" min={plan.minIntervalSec} defaultValue={values.intervalSec ?? monitor?.intervalSec ?? Math.max(def.defaultIntervalSec, plan.minIntervalSec)} /></Field>
              <Field label="Timeout (ms)" name="timeoutMs" error={errors.timeoutMs}><Input name="timeoutMs" type="number" min={1000} step={500} defaultValue={values.timeoutMs ?? monitor?.timeoutMs ?? 10000} /></Field>
              <Field label="Failures before down" name="retries" error={errors.retries}><Input name="retries" type="number" min={1} max={10} defaultValue={values.retries ?? monitor?.retries ?? 2} /></Field>
              <Field label="Degraded above (ms)" name="degradedLatencyMs" error={errors.degradedLatencyMs} help="Optional"><Input name="degradedLatencyMs" type="number" min={1} defaultValue={values.degradedLatencyMs ?? monitor?.degradedLatencyMs ?? ""} placeholder="e.g. 500" /></Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Runs on" />
            <div className="p-5 space-y-3">
              {def.runsOn.includes("push") ? (
                <p className="text-sm text-fg-muted">Push monitors don't run anywhere: your server calls the push URL shown after saving.</p>
              ) : (
                <>
                  <Select name="runner" value={runner} onChange={(e) => setRunner(e.target.value)}>
                    {def.runsOn.includes("edge") && <option value="edge">Cloudflare edge (global)</option>}
                    {def.runsOn.includes("relay") && rls.map((r) => <option key={r.id} value={r.id}>Relay: {r.name} ({r.region})</option>)}
                  </Select>
                  {errors.runner && <p className="text-xs text-down">{errors.runner}</p>}
                  {!def.runsOn.includes("edge") && rls.length === 0 && <Alert tone="degraded">This type needs a relay. <Link to="/app/relays" className="underline">Create one</Link> first.</Alert>}
                </>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Alert channels" description="Default channels always receive alerts." />
            <div className="p-5 space-y-2">
              {chs.length === 0 && <p className="text-sm text-fg-muted">No channels yet. <Link to="/app/channels" className="underline">Add Discord, Slack, email…</Link></p>}
              {chs.map((c) => (
                <Checkbox key={c.id} name="channels" value={c.id} defaultChecked={linked.includes(c.id)} disabled={c.isDefault} label={<span>{c.name} <span className="text-xs text-fg-faint">{c.type}{c.isDefault ? " · default" : ""}</span></span>} />
              ))}
            </div>
          </Card>
          <Card className="p-5 space-y-3">
            <SubmitButton name="intent" value="save" className="w-full" pendingText="Saving…">{monitor ? "Save changes" : "Create monitor"}</SubmitButton>
            {def.runsOn.includes("edge") && (
              <button type="button" className="btn-secondary w-full" disabled={testFetcher.state !== "idle"} onClick={() => {
                const form = document.getElementById("monitor-form") as HTMLFormElement;
                const fd = new FormData(form); fd.set("intent", "test");
                testFetcher.submit(fd, { method: "post" });
              }}><Play className="size-4" />{testFetcher.state !== "idle" ? "Testing…" : "Run a test check"}</button>
            )}
            {test && (
              <div className={cn("rounded-lg border p-3 text-xs", test.ok ? "border-up/40 bg-up/8" : "border-down/40 bg-down/8")}>
                <p className="font-medium">{test.ok ? "✓ Reachable" : "✗ Failed"}{test.latencyMs !== undefined ? ` · ${test.latencyMs} ms` : ""}</p>
                <p className="mt-1 text-fg-muted break-words">{test.ok ? test.message : test.error}</p>
                {test.data && <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-fg-muted">{JSON.stringify(test.data, null, 1).slice(0, 800)}</pre>}
              </div>
            )}
            {testFetcher.data?.errors && Object.keys(testFetcher.data.errors).length > 0 && <p className="text-xs text-down">Fix the highlighted fields first.</p>}
          </Card>
        </div>
      </Form>
    </>
  );
}
