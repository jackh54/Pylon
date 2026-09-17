import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/subscribe";
import { getCf, getDb, json } from "~/lib/server";
import { resolvePublicPage } from "~/lib/public.server";
import { subscribers } from "@server/db/schema";
import { newId, randomToken } from "@server/lib/ids";
import { clientIp, rateLimit } from "@server/lib/ratelimit";

export async function action({ params, request, context }: Route.ActionArgs) {
  const ctx = await resolvePublicPage(context, request, params);
  if (ctx.gated || !ctx.page.allowSubscribers) return json({ ok: false, message: "Subscriptions are disabled for this page." }, { status: 403 });
  const db = getDb(context);
  const { env, ctx: exec } = getCf(context);
  if (!(await rateLimit(env, "PUBLIC_LIMITER", `subscribe:${clientIp(request)}`))) return json({ ok: false, message: "Too many requests. Try again in a minute." }, { status: 429 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const webhook = String(form.get("webhook") ?? "").trim();
  const secrets = env as unknown as { RESEND_API_KEY?: string; EMAIL_FROM?: string };
  if (webhook) {
    if (!/^https:\/\//.test(webhook)) return json({ ok: false, message: "Webhook must be an https URL." }, { status: 400 });
    const kind = /discord(app)?\.com\/api\/webhooks\//.test(webhook) ? "discord" : "webhook";
    await db.insert(subscribers).values({ id: newId("sub"), pageId: ctx.page.id, kind, target: webhook, confirmed: true, token: randomToken(24) });
    return json({ ok: true, message: "Webhook subscribed." });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, message: "Enter a valid email address." }, { status: 400 });
  const existing = await db.select().from(subscribers).where(and(eq(subscribers.pageId, ctx.page.id), eq(subscribers.target, email))).get();
  const token = existing?.token ?? randomToken(24);
  if (!existing) await db.insert(subscribers).values({ id: newId("sub"), pageId: ctx.page.id, kind: "email", target: email, confirmed: !secrets.RESEND_API_KEY, token });
  if (!secrets.RESEND_API_KEY) return json({ ok: true, message: "Subscribed. You'll get an email when incidents are posted." });
  if (existing?.confirmed) return json({ ok: true, message: "You're already subscribed." });
  exec.waitUntil(fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secrets.RESEND_API_KEY}` },
    body: JSON.stringify({ from: secrets.EMAIL_FROM || "Pylon <onboarding@resend.dev>", to: [email], subject: `Confirm your subscription to ${ctx.page.name} status`, text: `Click to confirm: ${ctx.site}/confirm/${token}\n\nIf you didn't request this, ignore this email.` }),
  }).catch(() => {}));
  return json({ ok: true, message: "Check your inbox to confirm your subscription." });
}

export function loader() {
  return json({ error: "POST an email or webhook to subscribe" }, { status: 405 });
}
