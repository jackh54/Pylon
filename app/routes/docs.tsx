import { Link, data } from "react-router";
import type { Route } from "./+types/docs";
import { DOCS, getDoc } from "~/lib/docs";
import { Markdown } from "~/lib/markdown";
import { SiteHeader, SiteFooter } from "~/components/site";
import { BRAND } from "~/lib/brand";
import { appUrl, PUBLIC_CACHE } from "~/lib/server";

export async function loader({ params, context }: Route.LoaderArgs) {
  const doc = getDoc(params.slug);
  if (!doc) throw data("Not found", { status: 404 });
  return data({ doc, nav: DOCS.map((d) => ({ slug: d.slug, title: d.title })), site: appUrl(context) }, { headers: { "Cache-Control": PUBLIC_CACHE } });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [];
  const url = `${loaderData.site}/docs/${loaderData.doc.slug}`;
  return [
    { title: `${loaderData.doc.title} — ${BRAND.name} Docs` },
    { name: "description", content: loaderData.doc.summary.slice(0, 160) },
    { tagName: "link", rel: "canonical", href: url },
    { tagName: "link", rel: "alternate", type: "text/markdown", href: `${url}.md` },
    { property: "og:title", content: loaderData.doc.title },
    { property: "og:type", content: "article" },
    { "script:ld+json": { "@context": "https://schema.org", "@type": "TechArticle", headline: loaderData.doc.title, url, isPartOf: { "@type": "WebSite", name: BRAND.name, url: loaderData.site } } },
  ];
};

export default function Docs({ loaderData }: Route.ComponentProps) {
  const { doc, nav } = loaderData;
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid gap-10 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-20 self-start">
          <p className="text-xs font-medium uppercase tracking-widest text-fg-faint mb-3">Documentation</p>
          <nav className="flex lg:flex-col gap-1 overflow-x-auto">
            {nav.map((n) => (
              <Link key={n.slug} to={`/docs/${n.slug}`} className={`px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap ${n.slug === doc.slug ? "bg-surface-2 font-medium" : "text-fg-muted hover:text-fg"}`}>{n.title}</Link>
            ))}
          </nav>
          <a href={`/docs/${doc.slug}.md`} className="mt-6 hidden lg:inline-block text-xs text-fg-faint hover:text-fg">View as Markdown ↗</a>
        </aside>
        <article className="prose-doc min-w-0 max-w-3xl">
          <Markdown text={doc.body} />
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}
