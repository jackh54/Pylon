import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CalendarClock, ChevronRight } from "lucide-react";
import { useStatusLayout, statusMeta } from "~/routes/status/_shared";
import type { StatusShellData } from "~/routes/status/_shared";
import { Badge, CopyButton, StatusDot, toneFor, cn } from "~/components/ui";
import { StateLabel, UptimeBars } from "~/components/status-visuals";
import { ProbeIcon } from "~/components/icons";
import { useLiveStatus } from "~/components/live";
import { Markdown } from "~/lib/markdown";
import { formatDataValue, formatDate, relativeTime } from "~/lib/format";
import type { PublicComponent, PublicIncident } from "@server/services/status";
import { componentState } from "@server/services/status-state";

export function statusIndexMeta(shell: StatusShellData | undefined) {
  if (!shell?.status) return [{ title: "Status" }, { name: "robots", content: "noindex" }];
  const s = shell.status;
  const d = { site: shell.canonical };
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${d.site}#website`, name: `${s.page.name} Status`, url: d.site, description: s.page.description ?? undefined, inLanguage: "en" },
      { "@type": "Organization", "@id": `${d.site}#org`, name: s.page.name, url: s.page.links.website ?? d.site, logo: s.page.logoUrl ? (s.page.logoUrl.startsWith("http") ? s.page.logoUrl : `${d.site.replace(/\/s\/.*$/, "")}${s.page.logoUrl}`) : undefined, sameAs: Object.values(s.page.links).filter((v): v is string => typeof v === "string") },
      { "@type": "WebPage", "@id": `${d.site}#page`, url: d.site, name: `${s.page.name} Status — ${s.overall.label}`, isPartOf: { "@id": `${d.site}#website` }, about: { "@id": `${d.site}#org` }, dateModified: new Date(s.generatedAt).toISOString(), description: s.overall.label },
      { "@type": "ItemList", name: "Monitored components", numberOfItems: s.components.length, itemListElement: s.components.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, description: `${c.state}${c.uptime.d30 !== null ? ` · ${c.uptime.d30}% uptime (30d)` : ""}` })) },
      ...s.maintenances.upcoming.slice(0, 5).map((m) => ({ "@type": "Event", name: m.title, startDate: new Date(m.startsAt).toISOString(), endDate: new Date(m.endsAt).toISOString(), eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode", location: { "@type": "VirtualLocation", url: d.site }, description: m.body || undefined, organizer: { "@id": `${d.site}#org` } })),
    ],
  };
  return [...statusMeta(s, d.site), { "script:ld+json": jsonLd }];
}

function Chips({ c, data, latency }: { c: PublicComponent; data: Record<string, unknown> | null; latency: number | null }) {
  if (!c.monitor) return null;
  const chips: string[] = [];
  const d = data ?? {};
  if (c.display.showPlayers !== false && typeof d.players === "number") chips.push(`${d.players.toLocaleString()}${typeof d.maxPlayers === "number" && d.maxPlayers > 0 ? ` / ${d.maxPlayers.toLocaleString()}` : ""} players`);
  if (c.display.showVersion !== false && typeof d.version === "string" && d.version !== "unknown") chips.push(d.version);
  for (const key of c.display.fields ?? []) if (d[key] !== undefined && d[key] !== null && d[key] !== "") chips.push(`${key}: ${formatDataValue(d[key])}`);
  if (c.display.showLatency !== false && latency !== null && c.state !== "down") chips.push(`${latency} ms`);
  if (!chips.length) return null;
  return <div className="flex flex-wrap gap-1.5">{chips.map((x, i) => <span key={i} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted tabular-nums">{x}</span>)}</div>;
}

function IncidentCard({ inc, basePath, now }: { inc: PublicIncident; basePath: string; now: number }) {
  return (
    <article className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <Badge tone={toneFor(inc.impact)}>{inc.impact} impact</Badge>
        <Link to={`${basePath}/incidents/${inc.id}`} className="font-medium hover:underline">{inc.title}</Link>
        <span className="ml-auto text-xs text-fg-muted">{inc.resolvedAt ? `Resolved ${relativeTime(inc.resolvedAt, now)}` : `Started ${relativeTime(inc.startedAt, now)}`}</span>
      </div>
      <ol className="px-5 py-3 space-y-3">
        {inc.updates.slice(0, 3).map((u) => (
          <li key={u.id} className="text-sm">
            <p className="text-xs text-fg-muted"><span className="font-medium capitalize text-fg">{u.status}</span> · <time dateTime={new Date(u.createdAt).toISOString()}>{formatDate(u.createdAt)}</time></p>
            <Markdown text={u.body} className="prose-doc [&_p]:my-0.5 [&_p]:text-sm" />
          </li>
        ))}
        {inc.updates.length > 3 && <li><Link to={`${basePath}/incidents/${inc.id}`} className="text-xs text-accent hover:underline">{inc.updates.length - 3} more updates →</Link></li>}
      </ol>
    </article>
  );
}

export function StatusIndexView() {
  const { status: initial, basePath, site } = useStatusLayout();
  const { updates, connected } = useLiveStatus(basePath);
  const [now, setNow] = useState(initial.generatedAt);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  // merge live updates into the SSR snapshot
  const components = initial.components.map((c) => {
    const u = c.monitor ? updates[c.monitor.id] : undefined;
    if (!u || !c.monitor) return c;
    return { ...c, state: c.state === "maintenance" ? c.state : componentState(u.status, false), monitor: { ...c.monitor, status: u.status, lastLatencyMs: u.latencyMs, lastCheckedAt: u.checkedAt, data: u.data, lastMessage: u.message } };
  });
  const s = initial;
  const overallTone = toneFor(s.overall.state);
  const players = components.reduce<{ p: number | null; m: number | null }>((acc, c) => {
    const d = c.monitor?.data;
    if (d && typeof d.players === "number" && c.monitor?.status !== "down") { acc.p = (acc.p ?? 0) + d.players; if (typeof d.maxPlayers === "number") acc.m = (acc.m ?? 0) + d.maxPlayers; }
    return acc;
  }, { p: null, m: null });
  const lastChecked = Math.max(0, ...components.map((c) => c.monitor?.lastCheckedAt ?? 0));
  const sections = [...s.sections.map((sec) => ({ ...sec, items: components.filter((c) => c.sectionId === sec.id) })), { id: null, name: "", description: null, collapsed: false, position: 999, items: components.filter((c) => !c.sectionId || !s.sections.some((x) => x.id === c.sectionId)) }].filter((x) => x.items.length);
  const hero = s.page.hero;

  return (
    <div className="space-y-8">
      {/* Overall banner */}
      <section className={cn("card overflow-hidden relative", hero.bannerUrl && "min-h-40")} style={hero.bannerUrl ? { backgroundImage: `linear-gradient(to bottom, color-mix(in oklab, var(--surface) 55%, transparent), var(--surface)), url(${hero.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="flex items-center gap-3 text-xl sm:text-2xl font-semibold">
              <StatusDot tone={overallTone} live={s.overall.state === "operational"} className="size-3.5" />
              {s.overall.label}
            </h1>
            <p className="text-xs text-fg-muted flex items-center gap-2">
              {connected && <span className="inline-flex items-center gap-1 text-up"><span className="size-1.5 rounded-full bg-up" />Live</span>}
              {lastChecked > 0 && <span>Updated <time dateTime={new Date(lastChecked).toISOString()}>{relativeTime(lastChecked, now)}</time></span>}
            </p>
          </div>
          {hero.tagline && <p className="text-sm text-fg-muted -mt-1">{hero.tagline}</p>}
          {(hero.connectAddress || (hero.showPlayers !== false && players.p !== null)) && (
            <div className="flex flex-wrap items-stretch gap-3">
              {hero.connectAddress && (
                <div className="flex items-center gap-3 rounded-lg border border-line bg-bg/60 px-4 py-2.5">
                  <div><p className="text-[11px] uppercase tracking-wide text-fg-faint">{hero.connectLabel || "Server address"}</p><p className="font-mono font-semibold text-base select-all">{hero.connectAddress}</p></div>
                  <CopyButton value={hero.connectAddress} label="Copy" />
                </div>
              )}
              {hero.showPlayers !== false && players.p !== null && (
                <div className="flex items-center rounded-lg border border-line bg-bg/60 px-4 py-2.5">
                  <div><p className="text-[11px] uppercase tracking-wide text-fg-faint">Players online</p><p className="font-semibold text-base tabular-nums">{players.p.toLocaleString()}{players.m ? <span className="text-fg-muted font-normal"> / {players.m.toLocaleString()}</span> : null}</p></div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Maintenance */}
      {(s.maintenances.active.length > 0 || s.maintenances.upcoming.length > 0) && (
        <section className="space-y-3">
          {s.maintenances.active.map((m) => (
            <div key={m.id} className="rounded-card border border-maint/40 bg-maint/8 p-4">
              <p className="flex items-center gap-2 font-medium text-maint"><CalendarClock className="size-4" />Maintenance in progress: {m.title}</p>
              <p className="mt-1 text-xs text-fg-muted">Until <time dateTime={new Date(m.endsAt).toISOString()}>{formatDate(m.endsAt)}</time></p>
              {m.body && <Markdown text={m.body} className="prose-doc mt-2 [&_p]:my-0.5 [&_p]:text-sm" />}
            </div>
          ))}
          {s.maintenances.upcoming.map((m) => (
            <div key={m.id} className="card p-4">
              <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4 text-maint" />Scheduled: {m.title}</p>
              <p className="mt-1 text-xs text-fg-muted"><time dateTime={new Date(m.startsAt).toISOString()}>{formatDate(m.startsAt)}</time> → <time dateTime={new Date(m.endsAt).toISOString()}>{formatDate(m.endsAt)}</time></p>
              {m.body && <Markdown text={m.body} className="prose-doc mt-2 [&_p]:my-0.5 [&_p]:text-sm" />}
            </div>
          ))}
        </section>
      )}

      {/* Active incidents */}
      {s.activeIncidents.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-fg-muted">Active incidents</h2>
          {s.activeIncidents.map((inc) => <IncidentCard key={inc.id} inc={inc} basePath={basePath} now={now} />)}
        </section>
      )}

      {/* Components */}
      {components.length === 0 ? (
        <section className="card p-8 text-center text-sm text-fg-muted">No components have been added to this page yet.</section>
      ) : sections.map((sec) => (
        <section key={sec.id ?? "ungrouped"} className="card overflow-hidden">
          {sec.name && (
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="font-semibold">{sec.name}</h2>
              {sec.description && <p className="text-xs text-fg-muted">{sec.description}</p>}
            </div>
          )}
          <ul className="divide-y divide-line">
            {sec.items.map((c) => (
              <li key={c.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  {c.monitor && <ProbeIcon name={c.monitor.type === "minecraft-java" ? "Pickaxe" : c.monitor.type === "minecraft-bedrock" ? "Blocks" : c.monitor.type === "http" ? "Globe" : c.monitor.type === "heartbeat" ? "HeartPulse" : c.monitor.type === "discord" ? "MessageCircle" : c.monitor.type === "pterodactyl" ? "Server" : c.monitor.type === "fivem" ? "Car" : c.monitor.type === "rust-webrcon" ? "Wrench" : c.monitor.type === "source" ? "Crosshair" : c.monitor.type === "rcon" ? "SquareTerminal" : c.monitor.type === "dns" ? "Network" : c.monitor.type === "tcp" ? "Plug" : "Gamepad2"} className="mt-1 size-4 shrink-0 text-fg-muted" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="font-medium">{c.name}</h3>
                      <Chips c={c} data={c.monitor?.data ?? null} latency={c.monitor?.lastLatencyMs ?? null} />
                    </div>
                    {c.description && <p className="mt-0.5 text-xs text-fg-muted">{c.description}</p>}
                  </div>
                  <StateLabel state={c.state} className="shrink-0" />
                </div>
                {c.display.showHistory !== false && c.monitor && (
                  <div className="mt-3">
                    <UptimeBars history={c.history} style={s.page.theme.historyStyle} />
                    <div className="mt-1.5 flex justify-between text-[11px] text-fg-faint">
                      <span>{c.history.length} days ago</span>
                      <span className="tabular-nums">{c.uptime.d90 !== null ? `${c.uptime.d90}% uptime` : "Collecting data…"}</span>
                      <span>Today</span>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Recent history */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg-muted">Past incidents · last 14 days</h2>
          <Link to={`${basePath}/incidents`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">Full history<ChevronRight className="size-3" /></Link>
        </div>
        {s.recentIncidents.length === 0 ? <p className="card px-5 py-4 text-sm text-fg-muted">No incidents in the last 14 days.</p> : s.recentIncidents.map((inc) => <IncidentCard key={inc.id} inc={inc} basePath={basePath} now={now} />)}
      </section>
      <p className="sr-only">Machine-readable: {site}/status.json</p>
    </div>
  );
}
