import type { Route } from "./+types/markdown";
import { text } from "~/lib/server";
import { publicHeaders, resolvePublicStatus } from "~/lib/public.server";
import { statusToMarkdown } from "@server/services/status";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { status, site, page } = await resolvePublicStatus(context, request, params);
  return text(statusToMarkdown(status, site), "text/markdown; charset=utf-8", { headers: publicHeaders(!!page.passwordHash, { "X-Robots-Tag": "noindex" }) });
}
