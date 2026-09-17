/**
 * Custom domains for status pages.
 *
 * Two modes:
 * - "edge": customers point DNS at your edge proxy (deploy/edge — Caddy with on-demand TLS on a VPS).
 *   Pylon verifies DNS, tells Caddy which hostnames may get certificates, and trusts the original
 *   hostname that Caddy forwards (authenticated with EDGE_SECRET).
 * - "manual": no edge configured (typical self-host). Hostnames are added as Worker Custom Domains in
 *   your own Cloudflare account and are trusted as soon as they are saved.
 */
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Database } from "../db";
import { statusPages } from "../db/schema";
import { resolveDns } from "../lib/net";
import { timingSafeEqual } from "../lib/ids";
import { DAY } from "../lib/time";

export type DomainMode = "edge" | "manual";

export interface EdgeConfig { mode: DomainMode; target: string | null; ips: string[]; secret: string | null }

type DomainEnv = { CUSTOM_DOMAIN_TARGET?: string; CUSTOM_DOMAIN_IPS?: string; EDGE_SECRET?: string };

export function edgeConfig(env: unknown): EdgeConfig {
  const e = env as DomainEnv;
  const target = String(e.CUSTOM_DOMAIN_TARGET ?? "").trim().toLowerCase().replace(/\.$/, "") || null;
  const ips = String(e.CUSTOM_DOMAIN_IPS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const secret = String(e.EDGE_SECRET ?? "").trim() || null;
  return { mode: target ? "edge" : "manual", target, ips, secret };
}

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeHostname(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  return HOSTNAME.test(h) ? h : null;
}

export interface DnsCheck {
  ok: boolean;
  /** what DNS currently says, for the UI */
  found: string[];
  /** true when DNS answered but points somewhere else (as opposed to a lookup failure) */
  definite: boolean;
  reason?: string;
}

/** Does `hostname` point at the edge (CNAME to target, or A/AAAA to one of the edge IPs)? */
export async function checkDomainDns(env: unknown, hostname: string): Promise<DnsCheck> {
  const cfg = edgeConfig(env);
  if (cfg.mode === "manual") return { ok: true, found: [], definite: true };
  try {
    const [a, aaaa] = await Promise.all([resolveDns(hostname, "A"), resolveDns(hostname, "AAAA")]);
    const answers = [...a, ...aaaa];
    const cnames = answers.filter((x) => x.type === 5).map((x) => x.data.toLowerCase().replace(/\.$/, ""));
    const addrs = answers.filter((x) => x.type === 1 || x.type === 28).map((x) => x.data.toLowerCase());
    const found = [...new Set([...cnames.map((c) => `CNAME ${c}`), ...addrs.map((ip) => `${ip.includes(":") ? "AAAA" : "A"} ${ip}`)])];
    if (!answers.length) return { ok: false, found, definite: false, reason: "No DNS records found yet. DNS changes can take a few minutes." };
    const ok = (cfg.target !== null && cnames.includes(cfg.target)) || addrs.some((ip) => cfg.ips.includes(ip));
    if (ok) return { ok, found, definite: true };
    const proxied = addrs.some((ip) => /^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.6[4-9]\.|162\.15[89]\.|188\.114\.|141\.101\.|108\.162\.)/.test(ip) || ip.startsWith("2606:4700:"));
    return {
      ok: false, found, definite: true,
      reason: proxied
        ? "This hostname is proxied by Cloudflare (orange cloud). Switch the record to “DNS only” (grey cloud)."
        : `DNS points elsewhere. Add a CNAME to ${cfg.target}${cfg.ips.length ? ` or an A record to ${cfg.ips[0]}` : ""}.`,
    };
  } catch (e) {
    return { ok: false, found: [], definite: false, reason: `DNS lookup failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The original hostname forwarded by a trusted edge proxy, or null. */
export function trustedEdgeHost(request: Request, env: unknown): string | null {
  const { secret } = edgeConfig(env);
  if (!secret) return null;
  const given = request.headers.get("x-pylon-edge-secret");
  if (!given || !timingSafeEqual(given, secret)) return null;
  return normalizeHostname(request.headers.get("x-pylon-host") ?? "");
}

export async function setVerified(db: Database, pageId: string, verified: boolean): Promise<void> {
  await db.update(statusPages).set({ customDomainVerifiedAt: verified ? Date.now() : null }).where(eq(statusPages.id, pageId));
}

/** Cron: activate pending domains whose DNS now points at the edge. */
export async function verifyPendingDomains(env: unknown, db: Database, limit = 50): Promise<number> {
  if (edgeConfig(env).mode === "manual") return 0;
  const pending = await db.select({ id: statusPages.id, domain: statusPages.customDomain }).from(statusPages)
    .where(and(isNotNull(statusPages.customDomain), isNull(statusPages.customDomainVerifiedAt))).limit(limit).all();
  let n = 0;
  for (const p of pending) {
    if (!p.domain) continue;
    if ((await checkDomainDns(env, p.domain)).ok) { await setVerified(db, p.id, true); n++; }
  }
  return n;
}

/** Cron (daily): deactivate verified domains whose DNS definitely moved away, so they can't be squatted. */
export async function recheckVerifiedDomains(env: unknown, db: Database, limit = 200): Promise<number> {
  if (edgeConfig(env).mode === "manual") return 0;
  const rows = await db.select({ id: statusPages.id, domain: statusPages.customDomain }).from(statusPages)
    .where(and(isNotNull(statusPages.customDomain), isNotNull(statusPages.customDomainVerifiedAt), lt(statusPages.customDomainVerifiedAt, Date.now() - DAY / 2))).limit(limit).all();
  let n = 0;
  for (const r of rows) {
    if (!r.domain) continue;
    const check = await checkDomainDns(env, r.domain);
    if (check.ok) await setVerified(db, r.id, true);
    else if (check.definite) { await setVerified(db, r.id, false); n++; }
  }
  return n;
}

/** Unverified claims older than 7 days are released so nobody can squat a hostname. */
export async function releaseStaleClaims(db: Database): Promise<void> {
  await db.update(statusPages).set({ customDomain: null })
    .where(and(isNotNull(statusPages.customDomain), isNull(statusPages.customDomainVerifiedAt), lt(statusPages.updatedAt, Date.now() - 7 * DAY)));
}

/** Page served on `hostname`, if any (verified domains only). */
export async function pageForHost(db: Database, hostname: string) {
  return db.select({ id: statusPages.id, slug: statusPages.slug, orgId: statusPages.orgId, published: statusPages.published })
    .from(statusPages)
    .where(and(eq(statusPages.customDomain, hostname), isNotNull(statusPages.customDomainVerifiedAt)))
    .get();
}
