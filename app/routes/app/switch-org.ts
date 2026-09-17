import { redirect } from "react-router";
import type { Route } from "./+types/switch-org";
import { getEnv, requireAuth } from "~/lib/server";
import { ORG_COOKIE, isSecure, serializeCookie } from "@server/auth/session";

export async function action({ request, context }: Route.ActionArgs) {
  const auth = requireAuth(context);
  const form = await request.formData();
  const orgId = String(form.get("orgId") ?? "");
  if (!auth.orgs.some((o) => o.id === orgId)) throw redirect("/app");
  return redirect("/app", { headers: { "Set-Cookie": serializeCookie(ORG_COOKIE, orgId, { maxAge: 365 * 86400, secure: isSecure(getEnv(context).APP_URL) }) } });
}

export function loader() {
  return redirect("/app");
}
