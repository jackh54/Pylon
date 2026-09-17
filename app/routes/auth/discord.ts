import { redirect } from "react-router";
import type { Route } from "./+types/discord";
import { getEnv } from "~/lib/server";
import { isSecure, serializeCookie } from "@server/auth/session";
import { randomToken } from "@server/lib/ids";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context);
  if (!env.DISCORD_CLIENT_ID) throw redirect("/login");
  const next = new URL(request.url).searchParams.get("next") ?? "/app";
  const state = `${randomToken(16)}.${btoa(next.startsWith("/") ? next : "/app")}`;
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${env.APP_URL.replace(/\/$/, "")}/auth/discord/callback`,
    response_type: "code",
    scope: "identify email",
    state,
    prompt: "none",
  });
  return redirect(`https://discord.com/oauth2/authorize?${params}`, {
    headers: { "Set-Cookie": serializeCookie("pylon_oauth", state, { maxAge: 600, secure: isSecure(env.APP_URL) }) },
  });
}
