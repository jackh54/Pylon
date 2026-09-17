import { Link, redirect } from "react-router";
import { ArrowRight, Zap, Radio, Siren, Bell, Palette, Bot, Gamepad2, Globe, HeartPulse, Layers } from "lucide-react";
import type { Route } from "./+types/home";
import { BRAND } from "~/lib/brand";
import { SiteHeader, SiteFooter, GithubIcon } from "~/components/site";
import { ProbeIcon } from "~/components/icons";
import { StatusDot } from "~/components/ui";
import { UptimeBars } from "~/components/status-visuals";
import { getCf, getDb, getEnv, appUrl, PUBLIC_CACHE } from "~/lib/server";
import { loadStatusShell, statusShellAction } from "./status/shell.server";
import { StatusShell } from "~/components/status-shell";
import { StatusIndexView, statusIndexMeta } from "~/components/status-index-view";
import { getAuth } from "@server/auth/session";
import { probeCatalog } from "@server/probes/registry";
import { data } from "react-router";
import { lastDays } from "@server/lib/time";
import { PLANS, billingUrl, isHosted } from "@server/plans";
import { Check } from "lucide-react";

export async function loader(args: Route.LoaderArgs) {
  const { request, context } = args;
  // On a status page's custom domain, "/" is that status page.
  if (getCf(context).customDomainSlug) {
    const { body, headers } = await loadStatusShell({ ...args, params: {} });
    return data({ kind: "status" as const, shellData: body }, { headers });
  }
  const auth = await getAuth(getDb(context), request);
  const env = getEnv(context);
  // Self-hosted instances don't need a marketing page.
  if (!isHosted(env)) throw redirect(auth ? "/app" : "/login");
  const billing = billingUrl(env);
  return data(
    {
      kind: "marketing" as const,
      user: auth ? { name: auth.user.name } : null,
      probes: probeCatalog().map((p) => ({ id: p.id, name: p.name, icon: p.icon, badge: p.badge, runsOn: p.runsOn })),
      site: appUrl(context),
      billing,
      plans: [PLANS.free, PLANS.pro].map((p) => ({ id: p.id, name: p.name, price: p.price, blurb: p.blurb, features: p.features })),
    },
    { headers: { "Cache-Control": auth ? "private, no-store" : PUBLIC_CACHE } },
  );
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export async function action(args: Route.ActionArgs) {
  if (!getCf(args.context).customDomainSlug) throw data("Method not allowed", { status: 405 });
  return statusShellAction({ ...args, params: {} });
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (loaderData?.kind === "status") return statusIndexMeta(loaderData.shellData);
  const title = `${BRAND.name} — ${BRAND.tagline}`;
  const site = loaderData && "site" in loaderData ? loaderData.site : "";
  return [
    { title },
    { name: "description", content: BRAND.description },
    { tagName: "link", rel: "canonical", href: `${site}/` },
    { property: "og:title", content: title },
    { property: "og:description", content: BRAND.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${site}/` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: BRAND.description },
    { "script:ld+json": {
      "@context": "https://schema.org", "@type": "SoftwareApplication", name: BRAND.name, applicationCategory: "DeveloperApplication", operatingSystem: "Cloudflare Workers",
      description: BRAND.description, url: `${site}/`, license: "https://www.gnu.org/licenses/agpl-3.0.html", codeRepository: BRAND.repo, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    } },
  ];
};

const demoHistory = lastDays(60).map((day, i) => ({ day, uptime: i === 41 ? 92.4 : i === 17 ? 99.6 : 100, checks: 1440, failures: i === 41 ? 110 : i === 17 ? 6 : 0, avgLatency: 24, downtimeSec: i === 41 ? 6600 : 0, playersPeak: 1200 + i * 3 }));

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.kind === "status") {
    const error = actionData && typeof actionData === "object" && "error" in actionData ? String(actionData.error) : undefined;
    return <StatusShell data={loaderData.shellData} error={error}><StatusIndexView /></StatusShell>;
  }
  return <Marketing {...loaderData} />;
}

type MarketingProps = Extract<Route.ComponentProps["loaderData"], { kind: "marketing" }>;

function Marketing({ user, probes, plans, billing }: MarketingProps) {
  return (
    <div className="min-h-dvh">
      <SiteHeader user={user} />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_70%)]" />
          <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-20 pb-16 text-center">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-muted"><span className="size-1.5 rounded-full bg-up" />Free hosted plan · open source (AGPL-3.0) · self-hostable</p>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl sm:text-6xl font-semibold leading-[1.05]">Status pages that speak <span className="text-accent">game server</span>.</h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-muted">Uptime monitoring and public status pages with live player counts, TPS, maps and versions. Minecraft, Steam, FiveM, Rust, Discord, Pterodactyl — and anything else through relays and heartbeats.</p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to={user ? "/app" : "/register"} className="btn-primary text-base px-5 py-2.5">{user ? "Open dashboard" : "Create your status page"}<ArrowRight className="size-4" /></Link>
              <a href={BRAND.repo} className="btn-secondary text-base px-5 py-2.5" target="_blank" rel="noopener"><GithubIcon />Star on GitHub</a>
            </div>
            <p className="mt-4 text-xs text-fg-faint">No credit card. Prefer your own infrastructure? <Link to="/docs/self-hosting" className="underline">Self-host for free</Link> in a few minutes.</p>
          </div>

          {/* Demo card */}
          <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-8">
            <div className="card overflow-hidden shadow-xl shadow-black/5 fade-up">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 bg-surface-2/50">
                <div className="flex items-center gap-2 text-sm font-medium"><StatusDot tone="up" live /> All systems operational</div>
                <div className="text-xs text-fg-muted tabular-nums">1,284 / 2,000 players online</div>
              </div>
              <ul className="divide-y divide-line">
                {[
                  { name: "Survival — play.example.gg", icon: "Pickaxe", detail: "612/1000 players · 1.21.4 · 21 ms", tone: "up" as const },
                  { name: "Bedrock proxy", icon: "Blocks", detail: "371/500 players · 1.21.50", tone: "up" as const },
                  { name: "Rust — Main", icon: "Wrench", detail: "301/500 players · 59 fps · 4 queued", tone: "up" as const },
                  { name: "Website & store", icon: "Globe", detail: "HTTP 200 · 88 ms", tone: "up" as const },
                ].map((row) => (
                  <li key={row.name} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ProbeIcon name={row.icon} className="size-4 text-fg-muted" />
                      <span className="text-sm font-medium flex-1 truncate">{row.name}</span>
                      <span className="hidden sm:block text-xs text-fg-muted">{row.detail}</span>
                      <StatusDot tone={row.tone} />
                    </div>
                    <UptimeBars history={demoHistory} className="mt-2.5 h-6 [&>div>div:first-child]:h-6" />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Supported */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <h2 className="text-center text-sm font-medium uppercase tracking-widest text-fg-faint">Native integrations, no plugins required</h2>
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {probes.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
                <ProbeIcon name={p.icon} className="size-4 text-fg-muted" />{p.name}
                {!p.runsOn.includes("edge") && <span className="text-[10px] uppercase tracking-wide text-fg-faint">{p.runsOn[0]}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-sm text-fg-muted">…plus 300+ more games through GameDig relays, and literally anything via push heartbeats.</p>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <Gamepad2 />, title: "Game-native monitoring", body: "Server List Ping, A2S, RakNet, RCON, WebRCON and panel APIs. Player counts, versions, maps, TPS and FPS on your status page — not just \"HTTP 200\"." },
              { icon: <Zap />, title: "Fast everywhere", body: "Rendered at the edge on Cloudflare Workers, cached for 30 seconds, updated live over WebSockets. Pages weigh a few kilobytes of JavaScript." },
              { icon: <Radio />, title: "Relays for anything", body: "A tiny Node relay runs on any box and adds UDP protocols, LAN hosts and 300+ GameDig games. Multiple regions, one dashboard." },
              { icon: <HeartPulse />, title: "Heartbeats & push metrics", body: "Cron jobs, plugins, bots and agents just call a URL. Attach JSON like players or tps and it shows up on the page." },
              { icon: <Siren />, title: "Incidents & maintenance", body: "Automatic incidents when things go down, manual updates with Markdown, scheduled maintenance windows, subscriber emails and RSS." },
              { icon: <Bell />, title: "Alerts where players are", body: "Discord, Slack, Telegram, email and signed webhooks. Per-monitor routing with sane defaults." },
              { icon: <Palette />, title: "Deeply customizable", body: "Themes, accent colors, logos, connect-address hero with copy button, custom CSS, sections, custom domains and password-protected pages." },
              { icon: <Bot />, title: "AI- and SEO-first", body: "Server-rendered HTML with JSON-LD, sitemaps and OG images. Every page has a Markdown twin, llms.txt, a JSON API and an MCP endpoint for agents." },
              { icon: <Layers />, title: "Yours to run", body: "AGPL-3.0. Deploy to your own Cloudflare account in minutes: D1, Durable Objects and R2 — all within the free tier for most communities." },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent [&>svg]:size-5">{f.icon}</div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Agents */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16">
          <div className="card overflow-hidden grid lg:grid-cols-2">
            <div className="p-8">
              <p className="text-xs font-medium uppercase tracking-widest text-accent">Built for the agentic web</p>
              <h2 className="mt-2 text-2xl font-semibold">Your status is readable by humans, search engines and AI agents alike.</h2>
              <ul className="mt-4 space-y-2 text-sm text-fg-muted">
                <li>• <code className="kbd">Accept: text/markdown</code> returns a Markdown twin of any page</li>
                <li>• <code className="kbd">/llms.txt</code> and <code className="kbd">/llms-full.txt</code> index everything public</li>
                <li>• <code className="kbd">/mcp</code> exposes tools like <code className="kbd">get_status</code> over Streamable HTTP</li>
                <li>• JSON API with OpenAPI 3.1, RSS feeds, SVG badges and OG images</li>
                <li>• Explicit AI crawler policy per page via robots.txt Content-Signal</li>
              </ul>
            </div>
            <pre className="bg-[#0b1220] text-[#e8ecf3] p-6 text-[12.5px] leading-relaxed overflow-x-auto"><code>{`$ curl -H "Accept: text/markdown" https://status.example.gg

# Example Network — Status

**All systems operational** (as of 2026-09-16T21:04:11Z)
Players online: 1284 / 2000
Connect: \`play.example.gg\`

## Components
| Component | Status | Uptime (30d) | Details |
|---|---|---|---|
| Game servers / Survival | operational | 99.98% | 612/1000 players, 1.21.4, 21 ms |
| Game servers / Bedrock  | operational | 99.95% | 371/500 players, 1.21.50 |
| Infrastructure / Website | operational | 100% | 88 ms |`}</code></pre>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-4 sm:px-6 py-16">
          <h2 className="text-center text-3xl font-semibold">Simple pricing</h2>
          <p className="mt-2 text-center text-fg-muted">Start free on the hosted service. Go Pro for custom domains and white-label pages, or run it yourself for nothing.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.id} className={`card p-6 flex flex-col ${p.id === "pro" ? "ring-2 ring-accent" : ""}`}>
                <div className="flex items-baseline justify-between"><h3 className="text-lg font-semibold">{p.name}</h3><span className="text-sm text-fg-muted">{p.id === "pro" && !billing ? "Coming soon" : p.price}</span></div>
                <p className="mt-1 text-sm text-fg-muted">{p.blurb}</p>
                <ul className="mt-4 space-y-2 text-sm flex-1">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" />{f}</li>)}</ul>
                {p.id === "pro" ? (
                  billing ? <a href={billing} className="btn-accent mt-6" target="_blank" rel="noopener">Upgrade to Pro</a> : <p className="mt-6 text-center text-xs text-fg-muted rounded-lg bg-surface-2 px-3 py-2">Pro features are free for everyone while we're in beta.</p>
                ) : (
                  <Link to={user ? "/app" : "/register"} className="btn-primary mt-6">{user ? "Open dashboard" : "Start free"}</Link>
                )}
              </div>
            ))}
            <div className="card p-6 flex flex-col">
              <div className="flex items-baseline justify-between"><h3 className="text-lg font-semibold">Self-hosted</h3><span className="text-sm text-fg-muted">Free forever</span></div>
              <p className="mt-1 text-sm text-fg-muted">The same code on your own Cloudflare account. No limits, no branding, AGPL-3.0.</p>
              <ul className="mt-4 space-y-2 text-sm flex-1">{["Everything in Pro, unlimited", "One-command setup on Workers Free or Paid", "Your data, your domain", "Community support"].map((f) => <li key={f} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent" />{f}</li>)}</ul>
              <Link to="/docs/self-hosting" className="btn-secondary mt-6">Self-hosting guide</Link>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8 text-center">
          <h2 className="text-3xl font-semibold">Ship a status page tonight.</h2>
          <p className="mt-2 text-fg-muted">Create a free account, or deploy your own instance in a few minutes.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="btn-primary">Get started<ArrowRight className="size-4" /></Link>
            <Link to="/docs/self-hosting" className="btn-secondary"><Globe className="size-4" />Self-host guide</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
