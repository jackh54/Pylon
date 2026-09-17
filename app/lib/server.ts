/* Server-only helpers for loaders/actions. Import as "~/lib/server" from route modules only. */
import { data, redirect, type RouterContextProvider } from "react-router";

/** Loaders/actions receive a read-only provider; middleware gets the mutable one. */
export type Ctx = Readonly<RouterContextProvider>;
import type { ZodType } from "zod";
import { createDb } from "@server/db";
import type { Database } from "@server/db";
import { hasRole } from "@server/auth/session";
import type { AuthState } from "@server/auth/session";
import type { OrgRole } from "@server/db/schema";
import { authContext, cloudflareContext } from "./context";

export function getEnv(context: Ctx): Env {
  return context.get(cloudflareContext).env;
}

export function getDb(context: Ctx): Database {
  return createDb(getEnv(context).DB);
}

export function getCf(context: Ctx) {
  return context.get(cloudflareContext);
}

/** The signed-in user (set by the /app layout middleware). Throws a redirect otherwise. */
export function requireAuth(context: Ctx): AuthState & { org: NonNullable<AuthState["org"]> } {
  const auth = context.get(authContext);
  if (!auth) throw redirect("/login");
  if (!auth.org) throw redirect("/onboarding");
  return auth as AuthState & { org: NonNullable<AuthState["org"]> };
}

export function requireRole(auth: AuthState & { org: NonNullable<AuthState["org"]> }, role: OrgRole): void {
  if (!hasRole(auth.org.role, role)) throw data({ error: "You don't have permission to do that." }, { status: 403 });
}

export function appUrl(context: Ctx): string {
  return getEnv(context).APP_URL.replace(/\/$/, "");
}

export type FormResult<T> = { ok: true; data: T; values: Record<string, string> } | { ok: false; errors: Record<string, string>; values: Record<string, string> };

/** Parse a FormData against a zod schema, returning field-level errors for the UI. */
export function parseForm<T>(form: FormData, schema: ZodType<T>): FormResult<T> {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data, values };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors, values };
}

export function json<T>(body: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function text(body: string, contentType = "text/plain; charset=utf-8", init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", contentType);
  return new Response(body, { ...init, headers });
}

export const PUBLIC_CACHE = "public, max-age=0, s-maxage=20, stale-while-revalidate=60";
