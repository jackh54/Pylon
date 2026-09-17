/** Markdown docs are bundled at build time; each file becomes /docs/<slug> and /docs/<slug>.md */
const files = import.meta.glob("../../docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface DocPage { slug: string; title: string; body: string; order: number; summary: string }

const ORDER = ["getting-started", "monitors", "heartbeats", "relay", "status-pages", "notifications", "api", "self-hosting"];

export const DOCS: DocPage[] = Object.entries(files)
  .map(([path, body]) => {
    const slug = path.split("/").pop()!.replace(/\.md$/, "");
    const title = body.match(/^#\s+(.+)$/m)?.[1] ?? slug;
    const summary = body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
    const order = ORDER.indexOf(slug);
    return { slug, title, body, summary, order: order === -1 ? 99 : order };
  })
  .sort((a, b) => a.order - b.order);

export function getDoc(slug: string | undefined): DocPage | undefined {
  return DOCS.find((d) => d.slug === (slug ?? "getting-started"));
}
