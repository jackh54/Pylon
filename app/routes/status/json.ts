import type { Route } from "./+types/json";
import { json } from "~/lib/server";
import { publicHeaders, resolvePublicStatus } from "~/lib/public.server";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, site, page } = await resolvePublicStatus(context, request, params);
  return json({ ...status, links: { html: site, markdown: `${site}/status.md`, rss: `${site}/feed.xml`, badge: `${site}/badge.svg`, openapi: `${site.replace(/\/s\/[^/]+$/, "")}/api/openapi.json` } }, { headers: publicHeaders(!!page.passwordHash) });
}
