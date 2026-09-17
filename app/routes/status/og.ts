import type { Route } from "./+types/og";
import { text } from "~/lib/server";
import { resolvePublicStatus } from "~/lib/public.server";

const COLORS: Record<string, string> = { operational: "#22c55e", degraded: "#f59e0b", down: "#ef4444", maintenance: "#3b82f6", unknown: "#94a3b8" };
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));

/** Open Graph image (1200×630). Rendered as PNG via satori/resvg; falls back to SVG if wasm is unavailable. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, page } = await resolvePublicStatus(context, request, params);
  const color = COLORS[status.overall.state] ?? COLORS.unknown!;
  const players = status.totals.players !== null ? `${status.totals.players.toLocaleString()}${status.totals.maxPlayers ? ` / ${status.totals.maxPlayers.toLocaleString()}` : ""} players online` : `${status.totals.operational}/${status.totals.components} components operational`;
  const headers = { "Cache-Control": page.passwordHash ? "private, no-store" : "public, max-age=300, s-maxage=300" };
  // satori element tree (no HTML parsing): every multi-child node is display:flex
  const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });
  const tree = el("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", width: 1200, height: 630, padding: 64, background: "linear-gradient(135deg, #0b1220 0%, #111a2e 100%)", color: "#e8ecf3", fontFamily: "sans-serif" }, [
    el("div", { display: "flex", alignItems: "center", gap: 20 }, [
      el("div", { display: "flex", width: 22, height: 22, borderRadius: 9999, background: color }),
      el("div", { display: "flex", fontSize: 36, fontWeight: 600 }, status.overall.label),
    ]),
    el("div", { display: "flex", flexDirection: "column", gap: 16 }, [
      el("div", { display: "flex", fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }, page.name),
      el("div", { display: "flex", fontSize: 32, color: "#98a3b8" }, players),
    ]),
    el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 24, color: "#5b6577" }, [
      el("div", { display: "flex" }, page.customDomain && page.customDomainVerifiedAt ? page.customDomain : `status · ${page.slug}`),
      el("div", { display: "flex" }, "Powered by Pylon"),
    ]),
  ]);
  try {
    const { ImageResponse } = await import("workers-og");
    const res = new ImageResponse(tree as unknown as string, { width: 1200, height: 630 });
    const buf = await res.arrayBuffer();
    return new Response(buf, { headers: { ...headers, "content-type": "image/png" } });
  } catch (e) {
    console.warn("[og] PNG rendering failed, serving SVG", e);
    const title = esc(page.name);
    const label = esc(status.overall.label);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#111a2e"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><circle cx="75" cy="86" r="11" fill="${color}"/><text x="104" y="98" font-family="sans-serif" font-size="36" font-weight="600" fill="#e8ecf3">${label}</text><text x="64" y="380" font-family="sans-serif" font-size="72" font-weight="700" fill="#e8ecf3">${title}</text><text x="64" y="440" font-family="sans-serif" font-size="32" fill="#98a3b8">${esc(players)}</text><text x="64" y="574" font-family="sans-serif" font-size="24" fill="#5b6577">${esc(page.customDomain && page.customDomainVerifiedAt ? page.customDomain : `status · ${page.slug}`)}</text><text x="1136" y="574" text-anchor="end" font-family="sans-serif" font-size="24" fill="#5b6577">Powered by Pylon</text></svg>`;
    return text(svg, "image/svg+xml; charset=utf-8", { headers });
  }
}
