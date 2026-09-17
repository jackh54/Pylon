import type { Channel, MonitorStatus } from "../db/schema";
import { hmacHex } from "../lib/ids";

export interface NotificationPayload {
  event: "monitor.status_changed" | "incident.created" | "incident.updated" | "test";
  monitor?: { id: string; name: string; type: string; address: string; url: string };
  from?: MonitorStatus;
  to?: MonitorStatus;
  message?: string;
  latencyMs?: number;
  data?: Record<string, unknown>;
  incident?: { id: string; title: string; status: string; impact: string; url: string; body?: string };
  at: number;
  appName: string;
}

const STATUS_COLOR: Record<string, number> = { up: 0x22c55e, down: 0xef4444, degraded: 0xf59e0b, pending: 0x64748b, paused: 0x64748b };
const STATUS_EMOJI: Record<string, string> = { up: "🟢", down: "🔴", degraded: "🟡", pending: "⚪", paused: "⏸️" };

export function titleFor(p: NotificationPayload): string {
  if (p.event === "test") return `${p.appName} test notification`;
  if (p.event === "monitor.status_changed" && p.monitor) {
    const emoji = STATUS_EMOJI[p.to ?? "pending"] ?? "";
    const verb = p.to === "up" ? "is back up" : p.to === "down" ? "is DOWN" : p.to === "degraded" ? "is degraded" : `is ${p.to}`;
    return `${emoji} ${p.monitor.name} ${verb}`;
  }
  if (p.incident) return `${p.event === "incident.created" ? "🚨 New incident" : "📝 Incident update"}: ${p.incident.title}`;
  return `${p.appName} notification`;
}

export function bodyFor(p: NotificationPayload): string {
  const lines: string[] = [];
  if (p.monitor) lines.push(`${p.monitor.name} (${p.monitor.type}${p.monitor.address ? ` · ${p.monitor.address}` : ""})`);
  if (p.from && p.to) lines.push(`Status: ${p.from} → ${p.to}`);
  if (p.message) lines.push(p.message);
  if (p.latencyMs !== undefined) lines.push(`Latency: ${p.latencyMs} ms`);
  if (p.incident) lines.push(`${p.incident.status} · impact ${p.incident.impact}`, p.incident.body ?? "");
  const url = p.incident?.url ?? p.monitor?.url;
  if (url) lines.push(url);
  return lines.filter(Boolean).join("\n");
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Pylon-Notify/1.0", ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded HTTP ${res.status}`);
}

export interface NotifySecrets { RESEND_API_KEY?: string; EMAIL_FROM?: string }

/** Deliver one payload to one channel. Throws on delivery failure so callers can log it. */
export async function sendToChannel(channel: Channel, p: NotificationPayload, secrets: NotifySecrets): Promise<void> {
  const c = channel.config;
  const title = titleFor(p);
  const body = bodyFor(p);
  switch (channel.type) {
    case "discord": {
      if (!c.webhookUrl) throw new Error("Discord channel has no webhookUrl");
      const fields: { name: string; value: string; inline?: boolean }[] = [];
      if (p.from && p.to) fields.push({ name: "Status", value: `${p.from} → **${p.to}**`, inline: true });
      if (p.latencyMs !== undefined) fields.push({ name: "Latency", value: `${p.latencyMs} ms`, inline: true });
      if (p.data && typeof p.data.players === "number") fields.push({ name: "Players", value: `${p.data.players}${typeof p.data.maxPlayers === "number" ? `/${p.data.maxPlayers}` : ""}`, inline: true });
      if (p.message) fields.push({ name: "Details", value: p.message.slice(0, 1000) });
      await post(c.webhookUrl, {
        username: c.username || p.appName,
        content: c.mention ? c.mention : undefined,
        embeds: [{
          title,
          url: p.incident?.url ?? p.monitor?.url,
          description: p.incident?.body?.slice(0, 2000) || (p.monitor ? `${p.monitor.type}${p.monitor.address ? ` · \`${p.monitor.address}\`` : ""}` : undefined),
          color: STATUS_COLOR[p.to ?? (p.incident ? "down" : "pending")],
          fields,
          timestamp: new Date(p.at).toISOString(),
          footer: { text: p.appName },
        }],
      });
      return;
    }
    case "slack": {
      if (!c.webhookUrl) throw new Error("Slack channel has no webhookUrl");
      await post(c.webhookUrl, { text: `*${title}*\n${body}` });
      return;
    }
    case "telegram": {
      if (!c.botToken || !c.chatId) throw new Error("Telegram channel needs botToken and chatId");
      await post(`https://api.telegram.org/bot${c.botToken}/sendMessage`, { chat_id: c.chatId, text: `${title}\n${body}`, disable_web_page_preview: true });
      return;
    }
    case "webhook": {
      if (!c.url) throw new Error("Webhook channel has no url");
      const raw = JSON.stringify({ title, ...p });
      const headers: Record<string, string> = {};
      if (c.secret) headers["x-pylon-signature"] = `sha256=${await hmacHex(c.secret, raw)}`;
      const res = await fetch(c.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Pylon-Notify/1.0", ...headers }, body: raw });
      if (!res.ok) throw new Error(`Webhook responded HTTP ${res.status}`);
      return;
    }
    case "email": {
      if (!secrets.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
      if (!c.to) throw new Error("Email channel has no recipient");
      await post("https://api.resend.com/emails", {
        from: secrets.EMAIL_FROM || "Pylon <onboarding@resend.dev>",
        to: c.to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: title,
        text: body,
      }, { authorization: `Bearer ${secrets.RESEND_API_KEY}` });
      return;
    }
    default:
      throw new Error(`Unknown channel type ${String(channel.type)}`);
  }
}

export const CHANNEL_TYPES: { id: Channel["type"]; name: string; fields: { key: string; label: string; type: "text" | "password" | "url"; placeholder?: string; help?: string; required?: boolean }[] }[] = [
  { id: "discord", name: "Discord", fields: [
    { key: "webhookUrl", label: "Webhook URL", type: "url", placeholder: "https://discord.com/api/webhooks/…", required: true },
    { key: "mention", label: "Mention", type: "text", placeholder: "@here or <@&roleId>", help: "Optional text placed above the embed." },
    { key: "username", label: "Bot name", type: "text", placeholder: "Pylon" },
  ] },
  { id: "slack", name: "Slack", fields: [{ key: "webhookUrl", label: "Incoming webhook URL", type: "url", required: true }] },
  { id: "telegram", name: "Telegram", fields: [
    { key: "botToken", label: "Bot token", type: "password", required: true },
    { key: "chatId", label: "Chat ID", type: "text", required: true },
  ] },
  { id: "webhook", name: "Webhook", fields: [
    { key: "url", label: "URL", type: "url", required: true },
    { key: "secret", label: "Signing secret", type: "password", help: "Sent as x-pylon-signature: sha256=HMAC(body)" },
  ] },
  { id: "email", name: "Email (Resend)", fields: [{ key: "to", label: "Recipients", type: "text", placeholder: "ops@example.com, you@example.com", required: true }] },
];
