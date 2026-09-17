import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/unsubscribe";
import { getDb, text } from "~/lib/server";
import { resolvePublicPage } from "~/lib/public.server";
import { subscribers } from "@server/db/schema";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  await getDb(context).delete(subscribers).where(and(eq(subscribers.token, params.token), eq(subscribers.pageId, ctx.page.id)));
  return text(`You have been unsubscribed from ${ctx.page.name} status updates.`, "text/plain; charset=utf-8", { headers: { "Cache-Control": "no-store" } });
}
