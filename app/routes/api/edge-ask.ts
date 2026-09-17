import type { Route } from "./+types/edge-ask";
import { eq } from "drizzle-orm";
import { getDb, getEnv, text } from "~/lib/server";
import { organizations } from "@server/db/schema";
import { edgeConfig, normalizeHostname, pageForHost } from "@server/services/domains";
import { planFor } from "@server/plans";
import { timingSafeEqual } from "@server/lib/ids";

/**
 * Caddy's on-demand TLS "ask" endpoint: 200 when a certificate may be issued for ?domain=, else 404.
 * Called as  GET /api/edge/ask?token=<EDGE_SECRET>&domain=status.example.com
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context);
  const cfg = edgeConfig(env);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!cfg.secret || !timingSafeEqual(token, cfg.secret)) return text("forbidden", undefined, { status: 403, headers: { "Cache-Control": "no-store" } });
  const domain = normalizeHostname(url.searchParams.get("domain") ?? "");
  if (!domain) return text("invalid domain", undefined, { status: 400, headers: { "Cache-Control": "no-store" } });
  const db = getDb(context);
  const page = await pageForHost(db, domain);
  if (!page || !page.published) return text("unknown domain", undefined, { status: 404, headers: { "Cache-Control": "no-store" } });
  const org = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, page.orgId)).get();
  if (!planFor(env, { plan: org?.plan ?? "free" }).limits.customDomain) return text("plan does not include custom domains", undefined, { status: 404, headers: { "Cache-Control": "no-store" } });
  return text("ok", undefined, { headers: { "Cache-Control": "no-store" } });
}
