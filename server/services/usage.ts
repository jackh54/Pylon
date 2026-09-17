import { eq, sql } from "drizzle-orm";
import type { Database } from "../db";
import { apiKeys, channels, monitors, orgInvites, orgMembers, relays, statusPages } from "../db/schema";

export interface OrgUsage { monitors: number; statusPages: number; relays: number; channels: number; members: number; apiKeys: number }

export async function orgUsage(db: Database, orgId: string): Promise<OrgUsage> {
  const count = async (table: typeof monitors | typeof statusPages | typeof relays | typeof channels | typeof apiKeys | typeof orgInvites | typeof orgMembers) => {
    const r = await db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.orgId, orgId)).get();
    return r?.n ?? 0;
  };
  const [m, p, r, c, k, members, invites] = await Promise.all([count(monitors), count(statusPages), count(relays), count(channels), count(apiKeys), count(orgMembers), count(orgInvites)]);
  return { monitors: m, statusPages: p, relays: r, channels: c, apiKeys: k, members: members + invites };
}
