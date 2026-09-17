import { createContext, useContext } from "react";
import type { PublicStatus, StatusPageLinks, StatusPageTheme } from "./_types";

/** Data the status shell (header, theme, footer) needs; produced by loadStatusShell in layout.tsx. */
export interface StatusShellData {
  gated: boolean;
  shell: {
    id: string; slug: string; name: string; logoUrl: string | null; faviconUrl: string | null;
    theme: StatusPageTheme; links: StatusPageLinks; allowSubscribers: boolean; customDomain: string | null; showBranding: boolean;
  };
  basePath: string;
  site: string;
  canonical: string;
  status: PublicStatus | null;
  onCustomDomain: boolean;
}

export const StatusLayoutContext = createContext<StatusShellData | null>(null);

export function useStatusLayout(): StatusShellData & { status: PublicStatus } {
  const d = useContext(StatusLayoutContext);
  if (!d || !d.status) throw new Error("Status layout data missing");
  return d as StatusShellData & { status: PublicStatus };
}

/** The status shell data from route matches, for meta functions (app host or custom domain). */
export function findShellData(matches: readonly unknown[]): StatusShellData | undefined {
  for (const m of matches as ({ id?: string; loaderData?: unknown } | undefined)[]) {
    if (!m) continue;
    if (m.id === "routes/status/layout" || m.id === "cd-status-layout") return m.loaderData as StatusShellData;
    const ld = m.loaderData as { kind?: string; shellData?: StatusShellData } | undefined;
    if (m.id === "routes/home" && ld?.kind === "status") return ld.shellData;
  }
  return undefined;
}

export function statusMeta(status: PublicStatus, site: string, path = "", opts: { title?: string; description?: string } = {}) {
  const seo = status.page.seo;
  const title = opts.title ?? seo.title ?? `${status.page.name} Status`;
  const description = opts.description ?? seo.description ?? status.page.description ?? `Live status, player counts and incident history for ${status.page.name}. ${status.overall.label}.`;
  const url = `${site}${path}`;
  const og = seo.ogImageUrl ?? `${site}/og.png`;
  const robots = seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large, max-snippet:-1";
  const meta: Record<string, unknown>[] = [
    { title },
    { name: "description", content: description.slice(0, 300) },
    { name: "robots", content: robots },
    { tagName: "link", rel: "canonical", href: url },
    { tagName: "link", rel: "alternate", type: "application/rss+xml", title: `${status.page.name} incidents`, href: `${site}/feed.xml` },
    { tagName: "link", rel: "alternate", type: "application/json", href: `${site}/status.json` },
    { tagName: "link", rel: "alternate", type: "text/markdown", href: `${site}/status.md` },
    { property: "og:site_name", content: status.page.name },
    { property: "og:title", content: title },
    { property: "og:description", content: description.slice(0, 300) },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:image", content: og },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description.slice(0, 200) },
    { name: "twitter:image", content: og },
    { name: "theme-color", content: status.page.theme.accent },
  ];
  if (seo.keywords?.length) meta.push({ name: "keywords", content: seo.keywords.join(", ") });
  if (seo.aiPolicy === "disallow") meta.push({ name: "robots", content: `${robots}, noai, noimageai` });
  return meta;
}
