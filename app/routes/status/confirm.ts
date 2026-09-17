import { redirect } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/confirm";
import { getDb } from "~/lib/server";
import { resolvePublicPage } from "~/lib/public.server";
import { subscribers } from "@server/db/schema";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  await getDb(context).update(subscribers).set({ confirmed: true }).where(and(eq(subscribers.token, params.token), eq(subscribers.pageId, ctx.page.id)));
  return redirect(`${ctx.basePath || "/"}?subscribed=1`);
}
