import { redirect } from "react-router";
import { eq, or, sql } from "drizzle-orm";
import type { Route } from "./+types/discord-callback";
import { getDb, getEnv } from "~/lib/server";
import { createOrgForUser, createSession, isSecure, parseCookies, serializeCookie } from "@server/auth/session";
import { organizations, users } from "@server/db/schema";
import { newId, randomString, slugify } from "@server/lib/ids";
import { defaultPlan } from "@server/plans";

interface DiscordUser { id: string; username: string; global_name?: string | null; email?: string | null; avatar?: string | null; verified?: boolean }

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = parseCookies(request.headers.get("cookie")).pylon_oauth;
  if (!code || !state || state !== cookieState || !env.DISCORD_CLIENT_ID) throw redirect("/login?error=oauth");
  let next = "/app";
  try { next = atob(state.split(".")[1] ?? ""); } catch { /* default */ }

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET ?? "", grant_type: "authorization_code", code, redirect_uri: `${env.APP_URL.replace(/\/$/, "")}/auth/discord/callback` }),
  });
  if (!tokenRes.ok) throw redirect("/login?error=oauth");
  const token = (await tokenRes.json()) as { access_token: string };
  const meRes = await fetch("https://discord.com/api/users/@me", { headers: { authorization: `Bearer ${token.access_token}` } });
  if (!meRes.ok) throw redirect("/login?error=oauth");
  const me = (await meRes.json()) as DiscordUser;
  if (!me.email) throw redirect("/login?error=noemail");

  const db = getDb(context);
  const email = me.email.toLowerCase();
  const avatarUrl = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null;
  let user = await db.select().from(users).where(or(eq(users.discordId, me.id), eq(users.email, email))).get();
  if (!user) {
    if (String(env.ALLOW_SIGNUP) === "false") throw redirect("/login?error=signup-disabled");
    const id = newId("usr");
    const name = me.global_name || me.username;
    await db.insert(users).values({ id, email, name, discordId: me.id, avatarUrl });
    let slug = slugify(name);
    const clash = await db.select({ n: sql<number>`count(*)` }).from(organizations).where(eq(organizations.slug, slug)).get();
    if (clash && clash.n > 0) slug = `${slug}-${randomString(4)}`;
    await createOrgForUser(db, id, `${name}'s network`, slug, defaultPlan(env));
    user = (await db.select().from(users).where(eq(users.id, id)).get())!;
  } else if (!user.discordId) {
    await db.update(users).set({ discordId: me.id, avatarUrl: user.avatarUrl ?? avatarUrl }).where(eq(users.id, user.id));
  }
  const session = await createSession(db, user.id, request.headers.get("user-agent"));
  const secure = isSecure(env.APP_URL);
  const headers = new Headers();
  headers.append("Set-Cookie", session.cookie(secure));
  headers.append("Set-Cookie", serializeCookie("pylon_oauth", "", { maxAge: 0, secure }));
  return redirect(next.startsWith("/") ? next : "/app", { headers });
}
