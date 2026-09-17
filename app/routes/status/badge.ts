import type { Route } from "./+types/badge";
import { text } from "~/lib/server";
import { publicHeaders, resolvePublicStatus } from "~/lib/public.server";

const COLORS: Record<string, string> = { operational: "#22c55e", degraded: "#f59e0b", down: "#ef4444", maintenance: "#3b82f6", unknown: "#94a3b8" };
const LABELS: Record<string, string> = { operational: "operational", degraded: "degraded", down: "outage", maintenance: "maintenance", unknown: "unknown" };

/** Shields-style SVG badge: ?label=Status&style=flat */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, page } = await resolvePublicStatus(context, request, params);
  const url = new URL(request.url);
  const label = (url.searchParams.get("label") ?? "status").slice(0, 40);
  const value = url.searchParams.get("players") !== null && status.totals.players !== null ? `${status.totals.players} online` : LABELS[status.overall.state] ?? status.overall.state;
  const color = COLORS[status.overall.state] ?? COLORS.unknown!;
  const lw = Math.round(label.length * 6.5 + 14);
  const vw = Math.round(value.length * 6.5 + 14);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
<title>${label}: ${value}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + vw}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${lw + vw}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text><text x="${lw / 2}" y="14">${label}</text>
<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="${lw + vw / 2}" y="14">${value}</text>
</g></svg>`;
  return text(svg, "image/svg+xml; charset=utf-8", { headers: publicHeaders(!!page.passwordHash) });
}
