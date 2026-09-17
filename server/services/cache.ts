/**
 * Edge-cache purging for public status page URLs. The Cache API is per-colo, so this makes changes
 * visible immediately in the region that made them; other regions expire within s-maxage.
 * Keys mirror workers/app.ts: /s/<slug>/… on the app host, root paths on custom domains.
 */
const PATHS = ["", ".data", "/status.json", "/status.md", "/incidents", "/incidents.data", "/feed.xml", "/badge.svg", "/og.png", "/embed"];
const ROOT_PATHS = ["/", "/_.data", "/status.json", "/status.md", "/incidents", "/incidents.data", "/feed.xml", "/badge.svg", "/og.png", "/embed", "/robots.txt", "/sitemap.xml", "/llms.txt"];

export async function purgePageCache(env: Env, page: { slug: string; customDomain: string | null }): Promise<void> {
  const cache = (caches as unknown as { default: Cache }).default;
  const app = env.APP_URL.replace(/\/$/, "");
  const urls = [
    ...PATHS.map((p) => `${app}/s/${page.slug}${p}`),
    `${app}/api/v1/status/${page.slug}`,
    ...(page.customDomain ? ROOT_PATHS.map((p) => `https://${page.customDomain}${p}`) : []),
  ];
  const accepts = ["", "text/markdown"];
  await Promise.allSettled(urls.flatMap((u) => accepts.map((accept) => cache.delete(new Request(u, { method: "GET", headers: { accept } })).catch(() => false))));
}
