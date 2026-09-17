/**
 * Plans for the hosted service. Self-hosted instances (INSTANCE_MODE=self-hosted) get `unlimited`.
 * Plan assignment is manual for now (admin page) — a billing provider can flip `organizations.plan` later.
 */
export type PlanId = "free" | "pro" | "unlimited";

export interface PlanLimits {
  monitors: number;
  statusPages: number;
  relays: number;
  channels: number;
  members: number;
  apiKeys: number;
  minIntervalSec: number;
  historyDays: number;
  customDomain: boolean;
  hideBranding: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** shown on the pricing page only when billing is enabled */
  price: string;
  blurb: string;
  limits: PlanLimits;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "For one server or a small community.",
    limits: { monitors: 10, statusPages: 1, relays: 1, channels: 3, members: 2, apiKeys: 1, minIntervalSec: 60, historyDays: 30, customDomain: false, hideBranding: false },
    features: ["10 monitors, 60 s checks", "1 status page, 30-day history", "Live player counts & incidents", "Discord, Slack, Telegram, webhook alerts", "1 relay, 3 alert channels", "Markdown twins, RSS, badges, MCP"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "$9 / month",
    blurb: "For networks that want their own domain and white-label pages.",
    limits: { monitors: 100, statusPages: 10, relays: 5, channels: 20, members: 15, apiKeys: 10, minIntervalSec: 20, historyDays: 90, customDomain: true, hideBranding: true },
    features: ["100 monitors, 20 s checks", "10 status pages, 90-day history", "Custom domains", "Remove “Powered by” branding", "5 relays, 20 alert channels, 15 teammates", "Priority support"],
  },
  unlimited: {
    id: "unlimited",
    name: "Self-hosted",
    price: "Free",
    blurb: "Your own Cloudflare account, no limits.",
    limits: { monitors: Infinity, statusPages: Infinity, relays: Infinity, channels: Infinity, members: Infinity, apiKeys: Infinity, minIntervalSec: 20, historyDays: 90, customDomain: true, hideBranding: true },
    features: [],
  },
};

type PlanEnv = { INSTANCE_MODE?: string; DEFAULT_PLAN?: string; BILLING_URL?: string; ADMIN_EMAILS?: string };

export function isHosted(env: unknown): boolean {
  return String((env as PlanEnv).INSTANCE_MODE ?? "hosted") !== "self-hosted";
}

export function planFor(env: unknown, org: { plan: string }): Plan {
  if (!isHosted(env)) return PLANS.unlimited;
  return (PLANS as Record<string, Plan>)[org.plan] ?? PLANS.free;
}

/** Plan granted to newly created teams (set DEFAULT_PLAN=pro during a beta to unlock everything). */
export function defaultPlan(env: unknown): PlanId {
  const p = String((env as PlanEnv).DEFAULT_PLAN ?? "free");
  return p === "pro" ? "pro" : "free";
}

export function billingUrl(env: unknown): string | null {
  const u = String((env as PlanEnv).BILLING_URL ?? "").trim();
  return u.startsWith("http") ? u : null;
}

export function isInstanceAdmin(env: unknown, email: string): boolean {
  return String((env as PlanEnv).ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

export function upgradeHint(env: unknown): string {
  const url = billingUrl(env);
  return url ? `Upgrade your plan at ${url}.` : "Pro plans are coming soon — contact us to raise the limit.";
}

const SINGULAR: Partial<Record<keyof PlanLimits, string>> = {
  monitors: "monitor", statusPages: "status page", relays: "relay", channels: "alert channel", members: "team member", apiKeys: "API key",
};

/** Human message when a limit is hit, or null when within limits. `noun` is the plural form. */
export function limitMessage(env: unknown, plan: Plan, used: number, key: keyof PlanLimits, noun: string): string | null {
  const limit = plan.limits[key];
  if (typeof limit !== "number" || used < limit) return null;
  const label = limit === 1 ? (SINGULAR[key] ?? noun) : noun;
  return `The ${plan.name} plan includes ${limit} ${label}. ${upgradeHint(env)}`;
}

export function fmtLimit(n: number): string {
  return Number.isFinite(n) ? String(n) : "∞";
}
