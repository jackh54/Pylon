import { data, redirect } from "react-router";
import { eq } from "drizzle-orm";
import { organizations } from "@server/db/schema";
import type { StatusPage } from "@server/db/schema";
import { planFor } from "@server/plans";
import type { Plan } from "@server/plans";
import { hmacHex } from "@server/lib/ids";
import { parseCookies } from "@server/auth/session";
import { findPage, loadPublicStatus } from "@server/services/status";
import type { PublicStatus } from "@server/services/status";
import { pageBaseUrl } from "@server/services/page-url";
import { appUrl, getCf, getDb } from "./server";
import type { Ctx } from "./server";

export interface PublicPageContext {
  page: StatusPage;
  /** "" on a custom domain, "/s/<slug>" otherwise — prefix for in-app links */
  basePath: string;
  /** absolute URL of the page root as served on this request (no trailing slash) */
  site: string;
  /** preferred public URL: the verified custom domain if there is one (used for canonical links) */
  canonical: string;
  /** true when the page is password protected and this request is not authorised */
  gated: boolean;
  onCustomDomain: boolean;
  /** the owning team's plan (unlimited on self-hosted instances) */
  plan: Plan;
}

export function gateCookieName(pageId: string): string {
  return `pylon_pg_${pageId}`;
}

export async function gateCookieValue(env: Env, page: StatusPage): Promise<string> {
  return hmacHex(env.SESSION_SECRET ?? "dev", `${page.id}:${page.passwordHash ?? ""}`);
}

/**
 * Status routes exist twice: under /s/:slug on the app host, and at the root for custom domains.
 * The slug comes from the URL in the first case and from the request's host in the second.
 */
export function requireSlug(params: { slug?: string }, context: Ctx): string {
  const cf = getCf(context);
  const slug = params.slug ?? cf.customDomainSlug;
  if (!slug) throw data("Not found", { status: 404 });
  return slug;
}

/** Resolve a public status page, honouring custom domains and password gates. Throws 404. */
export async function resolvePublicPage(context: Ctx, request: Request, slugOrParams: string | { slug?: string }): Promise<PublicPageContext> {
  const slug = typeof slugOrParams === "string" ? slugOrParams : requireSlug(slugOrParams, context);
  const db = getDb(context);
  const cf = getCf(context);
  const page = await findPage(db, slug);
  if (!page || !page.published) throw data("Status page not found", { status: 404 });
  const onCustomDomain = cf.customDomainSlug === page.slug;
  const basePath = onCustomDomain ? "" : `/s/${page.slug}`;
  const canonical = pageBaseUrl(appUrl(context), page);
  const site = onCustomDomain && page.customDomain ? `https://${page.customDomain}` : `${appUrl(context)}/s/${page.slug}`;
  let gated = false;
  if (page.passwordHash) {
    const cookies = parseCookies(request.headers.get("cookie"));
    gated = cookies[gateCookieName(page.id)] !== (await gateCookieValue(cf.env, page));
  }
  const org = await db.select({ plan: organizations.plan }).from(organizations).where(eq(organizations.id, page.orgId)).get();
  const plan = planFor(cf.env, { plan: org?.plan ?? "free" });
  return { page, basePath, site, canonical, gated, onCustomDomain, plan };
}

/**
 * On the app host, send human visitors of a page that has a verified custom domain there (301),
 * so search engines index one URL. Data requests and non-GETs are left alone.
 */
export function redirectToCustomDomain(ctx: PublicPageContext, request: Request): void {
  if (ctx.onCustomDomain || request.method !== "GET" || ctx.canonical === ctx.site || ctx.page.passwordHash) return;
  const url = new URL(request.url);
  if (url.pathname.endsWith(".data") || url.searchParams.has("preview")) return;
  const rest = url.pathname.slice(ctx.basePath.length) || "/";
  throw redirect(`${ctx.canonical}${rest === "/" ? "/" : rest}${url.search}`, 301);
}

/** For resource routes (JSON, Markdown, feeds): 401 when gated, otherwise the assembled status. */
export async function resolvePublicStatus(context: Ctx, request: Request, slugOrParams: string | { slug?: string }): Promise<PublicPageContext & { status: PublicStatus }> {
  const ctx = await resolvePublicPage(context, request, slugOrParams);
  if (ctx.gated) throw data("This status page is password protected", { status: 401 });
  const status = await loadPublicStatus(getDb(context), ctx.page, { maxHistoryDays: ctx.plan.limits.historyDays });
  return { ...ctx, status };
}

export function publicHeaders(pageIsProtected: boolean, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": pageIsProtected ? "private, no-store" : "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
    "Access-Control-Allow-Origin": "*",
    ...extra,
  };
}
