import { createRequestHandler, RouterContextProvider } from "react-router";
import { eq } from "drizzle-orm";
import { cloudflareContext } from "../app/lib/context";
import { createDb } from "../server/db";
import { channels, statusPages } from "../server/db/schema";
import { reconcileMonitors, runRetention } from "../server/services/cron";
import { pageForHost, trustedEdgeHost } from "../server/services/domains";
import { sendToChannel, type NotifySecrets } from "../server/notify";
import type { NotifyJob } from "../server/notify/dispatch";

export { MonitorRunner } from "../server/do/monitor-runner";
export { LiveHub } from "../server/do/live-hub";

const serverBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(serverBuild, import.meta.env.MODE);

/**
 * Cached HTML embeds the asset URLs of the build that produced it, and those files are gone after
 * the next deploy. Keying the cache by build version means a deploy can never serve HTML that
 * points at files which no longer exist.
 */
let buildVersion: string | undefined;
async function getBuildVersion(): Promise<string> {
  if (!buildVersion) {
    const build = (await serverBuild()) as unknown as { assets?: { version?: string } };
    buildVersion = build.assets?.version ?? "dev";
  }
  return buildVersion;
}

/**
 * What a status page's custom domain may serve. Everything else (dashboard, auth, docs, API)
 * redirects to the app host. `.data` suffixes are React Router data requests for the same pages.
 */
const CUSTOM_DOMAIN_PAGE = /^\/(?:|incidents|incidents\/[^/]+|status\.json|status\.md|feed\.xml|badge\.svg|og\.png|embed|subscribe|(?:confirm|unsubscribe)\/[^/]+|live|robots\.txt|sitemap\.xml|llms\.txt|llms-full\.txt|site\.webmanifest|favicon\.svg|apple-touch-icon\.png|__manifest)$/;
const CUSTOM_DOMAIN_PREFIX = ["/assets/", "/uploads/", "/.well-known/", "/cdn-cgi/"];
const DEV_PREFIX = ["/@", "/node_modules/", "/app/", "/__"];

function allowedOnCustomDomain(pathname: string): boolean {
  let p = pathname.replace(/\.data$/, "");
  if (p === "/_root" || p === "/_") p = "/";
  if (CUSTOM_DOMAIN_PAGE.test(p) || CUSTOM_DOMAIN_PREFIX.some((x) => p.startsWith(x))) return true;
  return import.meta.env.DEV && DEV_PREFIX.some((x) => p.startsWith(x));
}

/** The machine itself. Subdomains like status.localhost are NOT local: they act as custom domains in dev. */
function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.startsWith("127.") || hostname === "[::1]" || hostname === "0.0.0.0";
}

export default {
  async fetch(incoming, env, ctx) {
    const url = new URL(incoming.url);
    const appHost = safeHost(env.APP_URL);

    // --- who is this request for? A trusted edge proxy (deploy/edge) forwards the customer's hostname.
    const edgeHost = trustedEdgeHost(incoming, env);
    const headers = new Headers(incoming.headers);
    headers.delete("x-pylon-client-ip");
    headers.delete("x-pylon-edge-secret");
    if (edgeHost) headers.set("x-pylon-client-ip", (incoming.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim());
    let request = new Request(incoming, { headers });

    // --- custom domains
    let customDomainSlug: string | undefined;
    let customDomainFavicon: string | undefined;
    let pageId: string | undefined;
    const foreignHost = edgeHost ?? (url.host !== appHost && !isLocalHost(url.hostname) ? url.hostname.toLowerCase() : null);
    if (foreignHost) {
      const page = await pageForHost(createDb(env.DB), foreignHost);
      if (page?.published) {
        customDomainSlug = page.slug;
        // fall back to the logo: most people upload one and expect it as the tab icon too
        customDomainFavicon = page.faviconUrl ?? page.logoUrl ?? undefined;
        pageId = page.id;
        if (!allowedOnCustomDomain(url.pathname)) {
          return Response.redirect(`${env.APP_URL.replace(/\/$/, "")}${url.pathname}${url.search}`, request.method === "GET" || request.method === "HEAD" ? 302 : 307);
        }
      } else if (edgeHost) {
        return new Response("This domain is not connected to a status page.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }

    // --- content negotiation for agents: Accept: text/markdown gets the Markdown twin of the page
    const accept = request.headers.get("accept") ?? "";
    let path = url.pathname;
    if (request.method === "GET" && accept.includes("text/markdown") && !accept.includes("text/html")) {
      const status = path.match(/^\/s\/([a-z0-9-]+)\/?$/);
      const doc = path.match(/^\/docs\/?([a-z0-9-]+)?\/?$/);
      if (customDomainSlug && path === "/") path = "/status.md";
      else if (status) path = `/s/${status[1]}/status.md`;
      else if (doc) path = `/docs/${doc[1] ?? "getting-started"}.md`;
      if (path !== url.pathname) {
        const next = new URL(url);
        next.pathname = path;
        request = new Request(next, request);
      }
    }

    // --- live updates: WebSocket straight into the page's LiveHub
    const live = path.match(/^\/s\/([a-z0-9-]+)\/live$/);
    if (live || (customDomainSlug && path === "/live")) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      let hubId = pageId;
      if (live) {
        const page = await createDb(env.DB).select({ id: statusPages.id, published: statusPages.published }).from(statusPages).where(eq(statusPages.slug, live[1]!)).get();
        hubId = page?.published ? page.id : undefined;
      }
      if (!hubId) return new Response("Not found", { status: 404 });
      return env.LIVE.get(env.LIVE.idFromName(hubId)).fetch(request);
    }

    // --- edge cache for public, anonymous status content (keyed by the real hostname)
    // Single-fetch data responses (".data") are tied to the build that produced them, so they are
    // never cached: a page from a newer build must not receive an older build's payload.
    const isDataRequest = path.endsWith(".data");
    const cacheable = request.method === "GET" && !isDataRequest
      && (customDomainSlug !== undefined || path.startsWith("/s/") || path.startsWith("/api/v1/status/") || path === "/llms.txt" || path === "/sitemap.xml");
    const cacheUrl = new URL(request.url);
    if (edgeHost) cacheUrl.host = edgeHost;
    if (cacheable) cacheUrl.searchParams.set("__v", await getBuildVersion());
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET", headers: { accept } });
    const cache = (caches as unknown as { default: Cache }).default;
    // A reload (Cache-Control: max-age=0 / no-cache) must reach the Worker, so someone recovering
    // from a broken page is never handed the cached copy that broke it.
    const wantsFresh = /no-cache|max-age=0/i.test(request.headers.get("cache-control") ?? "") || request.headers.get("pragma") === "no-cache";
    if (cacheable && !wantsFresh) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx, customDomainSlug, customDomainFavicon });
    const response = await requestHandler(request, context);

    if (cacheable && response.ok && /s-maxage=\d+/.test(response.headers.get("cache-control") ?? "") && !response.headers.has("set-cookie")) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  },

  /** Alert delivery with retries (Workers Paid queues). */
  async queue(batch, env) {
    const db = createDb(env.DB);
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        const channel = await db.select().from(channels).where(eq(channels.id, job.channelId)).get();
        if (!channel || !channel.enabled) { msg.ack(); continue; }
        await sendToChannel(channel, job.payload, env as unknown as NotifySecrets);
        console.log(`[queue] delivered ${job.payload.event} to ${channel.type} ${channel.id}`);
        msg.ack();
      } catch (e) {
        console.error(`[queue] delivery to ${job.channelId} failed (attempt ${msg.attempts})`, e);
        msg.retry({ delaySeconds: Math.min(600, 30 * msg.attempts) });
      }
    }
  },

  async scheduled(controller, env, ctx) {
    if (controller.cron === "0 3 * * *") {
      ctx.waitUntil(runRetention(env));
    } else {
      ctx.waitUntil(reconcileMonitors(env).then((r) => console.log(`[cron] reconciled ${r.resynced}/${r.checked} stale monitors, activated ${r.domains} custom domains`)));
    }
  },
} satisfies ExportedHandler<Env, NotifyJob>;

function safeHost(appUrl: string): string {
  try { return new URL(appUrl).host; } catch { return "localhost:5173"; }
}
