import { data } from "react-router";
import type { Route } from "./+types/embed";
import { resolvePublicStatus } from "~/lib/public.server";
import { StatusDot, toneFor } from "~/components/ui";
import { StateLabel } from "~/components/status-visuals";

/** Compact iframe-able widget: <iframe src="https://…/s/slug/embed" height="…"> */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, site, page } = await resolvePublicStatus(context, request, params);
  return data({ status, site }, { headers: { "Cache-Control": page.passwordHash ? "private, no-store" : "public, max-age=0, s-maxage=20", "X-Robots-Tag": "noindex" } });
}

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.status.page.name ?? "Status"} widget` }, { name: "robots", content: "noindex" }];

export default function Embed({ loaderData }: Route.ComponentProps) {
  const { status: s, site } = loaderData;
  return (
    <div className="p-3 text-sm" style={{ ["--accent" as string]: s.page.theme.accent }}>
      <a href={site} target="_blank" rel="noopener" className="card block p-3 hover:bg-surface-2/50">
        <p className="flex items-center gap-2 font-medium"><StatusDot tone={toneFor(s.overall.state)} />{s.page.name}: {s.overall.label}</p>
        <ul className="mt-2 space-y-1">
          {s.components.slice(0, 8).map((c) => <li key={c.id} className="flex items-center justify-between text-xs"><span className="truncate">{c.name}</span><StateLabel state={c.state} className="text-xs" /></li>)}
        </ul>
        {s.totals.players !== null && <p className="mt-2 text-xs text-fg-muted">{s.totals.players.toLocaleString()} players online</p>}
      </a>
    </div>
  );
}
