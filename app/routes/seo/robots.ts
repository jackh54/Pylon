import { eq } from "drizzle-orm";
import type { Route } from "./+types/robots";
import { appUrl, getCf, getDb, text } from "~/lib/server";
import { statusPages } from "@server/db/schema";

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "Claude-SearchBot", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "Meta-ExternalAgent", "Amazonbot", "DuckAssistBot", "cohere-ai", "MistralAI-User", "Diffbot"];

/**
 * robots.txt with explicit AI-crawler policy. On a custom domain the page's own aiPolicy applies.
 * Content-Signal follows Cloudflare's Content Signals Policy (search / ai-input / ai-train).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const cf = getCf(context);
  let site = appUrl(context);
  let policy: "allow" | "search-only" | "disallow" = "allow";
  let noindex = false;
  if (cf.customDomainSlug) {
    const page = await getDb(context).select({ seo: statusPages.seo, domain: statusPages.customDomain }).from(statusPages).where(eq(statusPages.slug, cf.customDomainSlug)).get();
    if (page) { policy = page.seo.aiPolicy ?? "allow"; noindex = !!page.seo.noindex; site = `https://${page.domain ?? new URL(request.url).host}`; }
  }
  const signal = policy === "allow" ? "search=yes, ai-input=yes, ai-train=yes" : policy === "search-only" ? "search=yes, ai-input=yes, ai-train=no" : "search=yes, ai-input=no, ai-train=no";
  const lines: string[] = ["# Pylon — status pages for game servers", `# Content signals: https://contentsignals.org`, `Content-Signal: ${signal}`, ""];
  if (noindex) {
    lines.push("User-agent: *", "Disallow: /");
  } else {
    lines.push("User-agent: *", "Allow: /", "Disallow: /app", "Disallow: /login", "Disallow: /register", "Disallow: /auth/", "Disallow: /api/push/", "Disallow: /api/relay/", "Disallow: /invite/", "");
    for (const bot of AI_BOTS) lines.push(`User-agent: ${bot}`, policy === "disallow" ? "Disallow: /" : "Allow: /", "");
    lines.push(`Sitemap: ${site}/sitemap.xml`, `# Machine-readable index for agents: ${site}/llms.txt`);
  }
  return text(lines.join("\n") + "\n", "text/plain; charset=utf-8", { headers: { "Cache-Control": "public, max-age=3600" } });
}
