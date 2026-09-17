import { data } from "react-router";
import type { Route } from "./+types/legal";
import { Markdown } from "~/lib/markdown";
import { SiteHeader, SiteFooter } from "~/components/site";
import { BRAND } from "~/lib/brand";
import { PUBLIC_CACHE } from "~/lib/server";

const files = import.meta.glob("../../legal/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export async function loader({ params }: Route.LoaderArgs) {
  const body = files[`../../legal/${params.slug}.md`];
  if (!body) throw data("Not found", { status: 404 });
  const title = body.match(/^#\s+(.+)$/m)?.[1] ?? params.slug;
  return data({ title, body }, { headers: { "Cache-Control": PUBLIC_CACHE } });
}

export const headers: Route.HeadersFunction = ({ loaderHeaders }) => loaderHeaders;
export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.title ?? "Legal"} — ${BRAND.name}` }];

export default function Legal({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-dvh">
      <SiteHeader />
      <article className="prose-doc mx-auto max-w-3xl px-4 sm:px-6 py-12"><Markdown text={loaderData.body} /></article>
      <SiteFooter />
    </div>
  );
}
