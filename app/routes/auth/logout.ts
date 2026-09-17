import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { getDb, getEnv } from "~/lib/server";
import { clearSessionCookie, destroySession, getAuth, isSecure } from "@server/auth/session";

export async function loader() {
  return redirect("/");
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const auth = await getAuth(db, request);
  if (auth) await destroySession(db, auth.sessionId);
  return redirect("/", { headers: { "Set-Cookie": clearSessionCookie(isSecure(getEnv(context).APP_URL)) } });
}
