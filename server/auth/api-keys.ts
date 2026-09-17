import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { apiKeys, organizations, type Organization } from "../db/schema";
import { newId, randomToken, sha256Hex } from "../lib/ids";

export async function createApiKey(db: Database, orgId: string, name: string, scopes: string[] = ["read"]): Promise<{ id: string; key: string }> {
  const key = `pyl_${randomToken(24)}`;
  const id = newId("key");
  await db.insert(apiKeys).values({ id, orgId, name, prefix: key.slice(0, 12), keyHash: await sha256Hex(key), scopes });
  return { id, key };
}

/** Resolve `Authorization: Bearer pyl_…` to an organization. */
export async function authenticateApiKey(db: Database, request: Request): Promise<{ org: Organization; scopes: string[] } | null> {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(pyl_[A-Za-z0-9_-]+)$/i);
  const token = m?.[1] ?? new URL(request.url).searchParams.get("api_key");
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await db.select({ key: apiKeys, org: organizations }).from(apiKeys).innerJoin(organizations, eq(organizations.id, apiKeys.orgId)).where(eq(apiKeys.keyHash, hash)).get();
  if (!row) return null;
  await db.update(apiKeys).set({ lastUsedAt: Date.now() }).where(eq(apiKeys.id, row.key.id));
  return { org: row.org, scopes: row.key.scopes };
}
