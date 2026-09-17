# Status pages

Each status page is a server-rendered, edge-cached HTML document with live updates over WebSockets. Pages weigh a few kilobytes of JavaScript and work without it.

## Structure

- **Sections** group components (*Game servers*, *Voice*, *Web*).
- **Components** link to a monitor and control what's shown: uptime history, players, latency, version, plus *extra fields* from the snapshot (e.g. `map`, `tps`, `fps`).
- Static components (no monitor) are allowed for things you update manually through incidents.

## Hero

The hero block shows the overall state, a **connect address with a copy button**, an optional tagline, a banner image, and the **total players online** across game monitors.

## Branding

Accent color, light/dark/system mode, corner radius, history style (bars/dots), font, logo (uploaded to R2 or a URL), favicon, and free-form **custom CSS**. Useful variables: `--accent`, `--bg`, `--surface`, `--fg`, `--fg-muted`, `--line`, `--radius`.

## Incidents & maintenance

- Monitors going down open **automatic incidents** on every page that shows them and resolve them on recovery.
- Post manual incidents with Markdown updates (investigating → identified → monitoring → resolved).
- Schedule **maintenance windows**; affected components render as "Maintenance" during the window and the page announces upcoming ones.
- Subscribers (email via Resend, or Discord/webhook URLs) are notified on every update. RSS is always available.

## Custom domains

Pro teams (and every team on a self-hosted instance) can serve a page from their own hostname. The page is then served at `/` on that hostname, and `robots.txt`, `sitemap.xml`, `llms.txt`, `feed.xml`, `status.json`, `status.md` and `badge.svg` are scoped to it. Dashboard, sign-in and API paths on a customer domain redirect to the main host.

**On the hosted service**, add the hostname in the **Domain** tab and create one DNS record:

| Type | Name | Target |
|---|---|---|
| CNAME | `status` (your subdomain) | the edge hostname shown in the Domain tab |
| A | bare domain only | the edge IP shown in the Domain tab |

On Cloudflare DNS, set the record to **DNS only** (grey cloud). Pylon checks DNS every few minutes; once it points at the edge the domain shows **Connected** and the HTTPS certificate is issued on the first visit. Unconnected claims are released after 7 days, and the page on the main host redirects (301) to the connected domain so search engines index one URL.

**Self-hosting**, pick one:

- **Worker Custom Domains** (default, no extra infrastructure): leave `CUSTOM_DOMAIN_TARGET` empty and add each hostname as a Custom Domain on your Worker. The domain has to be on your Cloudflare account. Pylon trusts it as soon as it's saved.
- **Your own edge server** for domains you don't control: run Caddy with on-demand TLS on any VPS — see [`deploy/edge`](https://github.com/jackh54/Pylon/tree/main/deploy/edge) — and set `CUSTOM_DOMAIN_TARGET`, `CUSTOM_DOMAIN_IPS` and the `EDGE_SECRET` secret.
- **Cloudflare for SaaS**: 100 custom hostnames are included with any zone; point the fallback origin at the Worker.

## Access control

Set a password under **Access** for private community pages. Crawlers, feeds and the JSON API are blocked too.

## SEO

Every page ships: unique title/description, canonical URL, Open Graph + Twitter cards with a generated 1200×630 image, `theme-color`, JSON-LD (`WebSite`, `Organization`, `WebPage`, `ItemList` of components, `Event` for maintenance, `NewsArticle` for incidents, `BreadcrumbList`), a sitemap entry, an RSS feed, `Cache-Control` for the edge and `Vary: Accept`.

## AI-first

- `Accept: text/markdown` on any page URL returns a Markdown twin; also at `/status.md`.
- `/llms.txt` and `/llms-full.txt` index docs and public pages.
- `/mcp` is a Model Context Protocol endpoint with `get_status`, `list_incidents`, `list_status_pages`.
- `robots.txt` lists AI crawlers explicitly and emits a `Content-Signal` line. Choose *allow*, *search-only* (no training) or *disallow* per page under **SEO & AI**.

## Embeds

- Badge: `![status](https://…/s/slug/badge.svg)` (`?players` shows the player count, `?label=Survival`).
- Widget: `<iframe src="https://…/s/slug/embed" width="360" height="240"></iframe>`.
