import { data, redirect } from "react-router";
import { getCf, getDb } from "~/lib/server";
import type { Ctx } from "~/lib/server";
import { gateCookieName, gateCookieValue, redirectToCustomDomain, resolvePublicPage } from "~/lib/public.server";
import { loadPublicStatus } from "@server/services/status";
import { verifyPassword } from "@server/auth/password";
import { isSecure, serializeCookie } from "@server/auth/session";
import type { StatusShellData } from "./_shared";

export interface ShellArgs { params: { slug?: string }; request: Request; context: Ctx }

/** Loader body shared by the /s/:slug layout, the custom-domain layout and the custom-domain home. */
export async function loadStatusShell({ params, request, context }: ShellArgs): Promise<{ body: StatusShellData; headers: Record<string, string> }> {
  const ctx = await resolvePublicPage(context, request, params);
  redirectToCustomDomain(ctx, request);
  const { page } = ctx;
  const showBranding = !(page.theme.hideBranding && ctx.plan.limits.hideBranding);
  const shell = { id: page.id, slug: page.slug, name: page.name, logoUrl: page.logoUrl, faviconUrl: page.faviconUrl, theme: page.theme, links: page.links, allowSubscribers: page.allowSubscribers, customDomain: page.customDomain, showBranding };
  const base = { shell, basePath: ctx.basePath, site: ctx.site, canonical: ctx.canonical, onCustomDomain: ctx.onCustomDomain };
  if (ctx.gated) {
    return { body: { ...base, gated: true, status: null }, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } };
  }
  const status = await loadPublicStatus(getDb(context), page, { maxHistoryDays: ctx.plan.limits.historyDays });
  return {
    body: { ...base, gated: false, status },
    headers: {
      "Cache-Control": page.passwordHash ? "private, no-store" : "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
      "X-Robots-Tag": page.seo.noindex ? "noindex, nofollow" : "all",
      "Vary": "Accept",
    },
  };
}

/** Password-gate form handler, shared like loadStatusShell. */
export async function statusShellAction({ params, request, context }: ShellArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!ctx.page.passwordHash || !(await verifyPassword(password, ctx.page.passwordHash))) {
    return data({ error: "Incorrect password" }, { status: 401 });
  }
  const { env } = getCf(context);
  const value = await gateCookieValue(env, ctx.page);
  return redirect(ctx.basePath || "/", { headers: { "Set-Cookie": serializeCookie(gateCookieName(ctx.page.id), value, { maxAge: 30 * 86400, secure: isSecure(env.APP_URL) }) } });
}
