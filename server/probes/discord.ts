import { z } from "zod";
import { fail, errorMessage, type ProbeDefinition } from "./types";

const schema = z.object({
  mode: z.enum(["widget", "bot"]).default("widget"),
  guildId: z.string().optional(),
  botToken: z.string().optional(),
});
export type DiscordConfig = z.infer<typeof schema>;

interface Widget { id: string; name: string; presence_count?: number; instant_invite?: string | null; members?: unknown[] }

/** Discord community / bot health. Widget mode needs "Enable server widget" in Discord settings. */
export const discordProbe: ProbeDefinition<DiscordConfig> = {
  id: "discord",
  name: "Discord",
  description: "Track a guild's online member count via its widget, or verify a bot is authenticated and reachable.",
  category: "generic",
  badge: "Discord",
  icon: "MessageCircle",
  runsOn: ["edge", "relay"],
  schema,
  defaults: { mode: "widget" },
  fields: [
    { key: "mode", label: "Mode", type: "select", options: [{ value: "widget", label: "Guild widget (online count)" }, { value: "bot", label: "Bot token (bot is online)" }] },
    { key: "guildId", label: "Guild ID", type: "text", placeholder: "123456789012345678", help: "Widget mode. Enable Server Widget in Server Settings → Widget." },
    { key: "botToken", label: "Bot token", type: "password", help: "Bot mode only." },
  ],
  dataFields: [{ key: "online", label: "Online", format: "number" }, { key: "name", label: "Name" }],
  address: (c) => c.mode === "bot" ? "bot" : `guild ${c.guildId ?? ""}`,
  async run(config, ctx) {
    const started = Date.now();
    try {
      if (config.mode === "bot") {
        if (!config.botToken) return fail("Bot token is required");
        const res = await fetch("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bot ${config.botToken}` }, signal: ctx.signal });
        const latencyMs = Date.now() - started;
        if (res.status === 401) return fail("Discord rejected the bot token", { latencyMs });
        if (!res.ok) return fail(`Discord API responded HTTP ${res.status}`, { latencyMs });
        const me = (await res.json()) as { username?: string; id?: string };
        return { ok: true, latencyMs, message: `Bot ${me.username ?? me.id} authenticated`, data: { name: me.username } };
      }
      if (!config.guildId) return fail("Guild ID is required");
      const res = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(config.guildId)}/widget.json`, { signal: ctx.signal });
      const latencyMs = Date.now() - started;
      if (res.status === 403) return fail("Widget is disabled for this guild", { latencyMs });
      if (res.status === 404) return fail("Guild not found", { latencyMs });
      if (!res.ok) return fail(`Discord API responded HTTP ${res.status}`, { latencyMs });
      const w = (await res.json()) as Widget;
      const data = { online: w.presence_count ?? 0, name: w.name, invite: w.instant_invite ?? undefined };
      return { ok: true, latencyMs, message: `${data.online} online in ${w.name}`, data };
    } catch (e) {
      return fail(errorMessage(e), { latencyMs: Date.now() - started });
    }
  },
};
