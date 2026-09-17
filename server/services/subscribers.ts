import { and, eq } from "drizzle-orm";
import type { Database } from "../db";
import { subscribers } from "../db/schema";

export interface SubscriberEvent {
  pageName: string;
  title: string;
  status: string;
  impact: string;
  body: string;
  url: string;
  unsubscribeBase: string;
}

/** Fan out an incident notification to confirmed subscribers (email via Resend, webhooks via POST). */
export async function notifySubscribers(db: Database, env: Env, pageId: string, ev: SubscriberEvent): Promise<void> {
  const rows = await db.select().from(subscribers).where(and(eq(subscribers.pageId, pageId), eq(subscribers.confirmed, true))).all();
  if (!rows.length) return;
  const secrets = env as unknown as { RESEND_API_KEY?: string; EMAIL_FROM?: string };
  const emails = rows.filter((r) => r.kind === "email").map((r) => r.target);
  const hooks = rows.filter((r) => r.kind === "webhook" || r.kind === "discord");
  const tasks: Promise<unknown>[] = [];
  if (emails.length && secrets.RESEND_API_KEY) {
    for (let i = 0; i < emails.length; i += 50) {
      const batch = emails.slice(i, i + 50);
      tasks.push(fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secrets.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: secrets.EMAIL_FROM || "Pylon <onboarding@resend.dev>",
          to: secrets.EMAIL_FROM || "onboarding@resend.dev",
          bcc: batch,
          subject: `[${ev.pageName}] ${ev.title} — ${ev.status}`,
          text: `${ev.title}\nStatus: ${ev.status} · Impact: ${ev.impact}\n\n${ev.body}\n\n${ev.url}\n\nUnsubscribe: ${ev.unsubscribeBase}`,
        }),
      }).catch(() => {}));
    }
  }
  for (const h of hooks) {
    const payload = h.kind === "discord"
      ? { username: ev.pageName, embeds: [{ title: ev.title, description: ev.body.slice(0, 2000), url: ev.url, color: ev.status === "resolved" ? 0x22c55e : 0xef4444, fields: [{ name: "Status", value: ev.status, inline: true }, { name: "Impact", value: ev.impact, inline: true }] }] }
      : { event: "incident", ...ev };
    tasks.push(fetch(h.target, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Pylon-Subscribers/1.0" }, body: JSON.stringify(payload) }).catch(() => {}));
  }
  await Promise.allSettled(tasks);
}
