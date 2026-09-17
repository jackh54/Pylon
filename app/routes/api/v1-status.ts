import type { Route } from "./+types/v1-status";
import { json } from "~/lib/server";
import { publicHeaders, resolvePublicStatus } from "~/lib/public.server";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, page } = await resolvePublicStatus(context, request, params.slug);
  return json(status, { headers: publicHeaders(!!page.passwordHash) });
}
