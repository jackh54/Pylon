import type { Route } from "./+types/uploads";
import { getEnv } from "~/lib/server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const key = params["*"];
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const obj = await getEnv(context).UPLOADS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
