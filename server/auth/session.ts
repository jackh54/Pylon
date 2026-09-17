import { and, eq, gt } from "drizzle-orm";
import type { Database } from "../db";
import { organizations, orgMembers, sessions, users, type OrgRole, type Organization, type User } from "../db/schema";
import { newId, randomToken, sha256Hex } from "../lib/ids";
import { DAY } from "../lib/time";

export const SESSION_COOKIE = "pylon_session";
export const ORG_COOKIE = "pylon_org";
const SESSION_TTL = 30 * DAY;

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: { maxAge?: number; secure: boolean; httpOnly?: boolean; path?: string; sameSite?: "Lax" | "Strict" | "None" } ): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path ?? "/"}`, `SameSite=${opts.sameSite ?? "Lax"}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join("; ");
}

export function isSecure(appUrl: string): boolean {
  return appUrl.startsWith("https://");
}

export async function createSession(db: Database, userId: string, userAgent?: string | null): Promise<{ token: string; cookie: (secure: boolean) => string }> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  await db.insert(sessions).values({ id, userId, expiresAt: Date.now() + SESSION_TTL, userAgent: userAgent?.slice(0, 200) ?? null });
  return { token, cookie: (secure) => serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL / 1000, secure }) };
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAge: 0, secure });
}

export interface AuthState {
  user: User;
  sessionId: string;
  orgs: (Organization & { role: OrgRole })[];
  org: (Organization & { role: OrgRole }) | null;
}

export async function getAuth(db: Database, request: Request): Promise<AuthState | null> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const id = await sha256Hex(token);
  const row = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, Date.now())))
    .get();
  if (!row) return null;
  const memberships = await db
    .select({ org: organizations, role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(eq(orgMembers.userId, row.user.id))
    .all();
  const orgs = memberships.map((m) => ({ ...m.org, role: m.role }));
  const wanted = cookies[ORG_COOKIE];
  const org = orgs.find((o) => o.id === wanted) ?? orgs[0] ?? null;
  return { user: row.user, sessionId: id, orgs, org };
}

export async function destroySession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function createOrgForUser(db: Database, userId: string, name: string, slug: string, plan = "free"): Promise<Organization> {
  const org = { id: newId("org"), name, slug, plan };
  await db.insert(organizations).values(org);
  await db.insert(orgMembers).values({ orgId: org.id, userId, role: "owner" });
  return (await db.select().from(organizations).where(eq(organizations.id, org.id)).get())!;
}

const ROLE_RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export function hasRole(role: OrgRole, atLeast: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[atLeast];
}
