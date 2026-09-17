/** Cloudflare rate-limiting bindings (optional: when a binding is absent, everything is allowed). */
type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

export type LimiterName = "AUTH_LIMITER" | "PUSH_LIMITER" | "PUBLIC_LIMITER";

export async function rateLimit(env: unknown, name: LimiterName, key: string): Promise<boolean> {
  const binding = (env as Record<string, unknown>)[name] as Limiter | undefined;
  if (!binding || typeof binding.limit !== "function") return true;
  try {
    return (await binding.limit({ key })).success;
  } catch {
    return true;
  }
}

export function clientIp(request: Request): string {
  // x-pylon-client-ip is set by the Worker only for requests from the trusted edge proxy
  return request.headers.get("x-pylon-client-ip") || request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
