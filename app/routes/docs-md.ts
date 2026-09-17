import type { Route } from "./+types/docs-md";
import { getDoc } from "~/lib/docs";
import { text, PUBLIC_CACHE } from "~/lib/server";

export async function loader({ params }: Route.LoaderArgs) {
  const doc = getDoc(params.slug);
  if (!doc) return text("Not found", "text/plain", { status: 404 });
  return text(doc.body, "text/markdown; charset=utf-8", { headers: { "Cache-Control": PUBLIC_CACHE, "X-Robots-Tag": "noindex" } });
}
