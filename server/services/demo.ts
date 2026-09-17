import type { Database } from "../db";
import { monitors, pageComponents, pageSections, statusPages } from "../db/schema";
import { newId, randomToken, slugify } from "../lib/ids";
import { syncMonitor } from "./monitors";

/** Seeds a realistic demo: real public game servers + a status page. Safe to run once per org. */
export async function seedDemo(env: Env, db: Database, orgId: string, orgSlug: string): Promise<{ pageId: string; slug: string }> {
  const mk = (name: string, type: string, config: Record<string, unknown>, extra: Partial<typeof monitors.$inferInsert> = {}) => ({
    id: newId("mon"), orgId, name, type, config, intervalSec: 60, timeoutMs: 10000, retries: 2, runner: "edge", enabled: true, ...extra,
  });
  const hypixel = mk("Hypixel Network", "minecraft-java", { host: "mc.hypixel.net", port: 25565, protocolVersion: -1 });
  const cubecraft = mk("CubeCraft (Java)", "minecraft-java", { host: "play.cubecraft.net", port: 25565, protocolVersion: -1 });
  const hive = mk("The Hive (Bedrock)", "minecraft-bedrock", { host: "geo.hivebedrock.network", port: 19132 });
  const web = mk("Website", "http", { url: "https://www.cloudflare.com/", method: "GET", expectedStatus: "2xx" });
  const backup = mk("Nightly backup job", "heartbeat", { graceSec: 120 }, { runner: "push", intervalSec: 3600, pushToken: randomToken(24) });
  await db.insert(monitors).values([hypixel, cubecraft, hive, web, backup]);

  const slug = `${slugify(orgSlug)}-demo`.slice(0, 48);
  const pageId = newId("pg");
  await db.insert(statusPages).values({
    id: pageId, orgId, slug, name: "Demo Network", description: "Live status for our Minecraft network, website and infrastructure.",
    hero: { connectAddress: "mc.hypixel.net", connectLabel: "Java IP", tagline: "Playable on Java 1.8 – 1.21", showPlayers: true },
    links: { discord: "https://discord.gg/example", website: "https://example.com" },
    seo: { keywords: ["minecraft", "status", "server status"] },
  });
  const sGames = { id: newId("sec"), pageId, name: "Game servers", position: 0 };
  const sInfra = { id: newId("sec"), pageId, name: "Infrastructure", position: 1 };
  await db.insert(pageSections).values([sGames, sInfra]);
  await db.insert(pageComponents).values([
    { id: newId("cmp"), pageId, sectionId: sGames.id, monitorId: hypixel.id, name: "Hypixel", description: "Main lobby & minigames", position: 0 },
    { id: newId("cmp"), pageId, sectionId: sGames.id, monitorId: cubecraft.id, name: "CubeCraft", description: "Java edition", position: 1 },
    { id: newId("cmp"), pageId, sectionId: sGames.id, monitorId: hive.id, name: "The Hive", description: "Bedrock edition", position: 2 },
    { id: newId("cmp"), pageId, sectionId: sInfra.id, monitorId: web.id, name: "Website", position: 0 },
    { id: newId("cmp"), pageId, sectionId: sInfra.id, monitorId: backup.id, name: "Backups", description: "Nightly world backups", position: 1 },
  ]);
  await Promise.all([hypixel, cubecraft, hive, web, backup].map((m) => syncMonitor(env, db, m.id)));
  return { pageId, slug };
}
