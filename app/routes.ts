import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("docs/:slug.md", "routes/docs-md.ts"),
  route("docs/:slug?", "routes/docs.tsx"),
  route("legal/:slug", "routes/legal.tsx"),

  route("login", "routes/auth/login.tsx"),
  route("register", "routes/auth/register.tsx"),
  route("logout", "routes/auth/logout.ts"),
  route("auth/discord", "routes/auth/discord.ts"),
  route("auth/discord/callback", "routes/auth/discord-callback.ts"),
  route("invite/:token", "routes/auth/invite.tsx"),
  route("onboarding", "routes/auth/onboarding.tsx"),

  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/index.tsx"),
      route("monitors", "routes/app/monitors.tsx"),
      route("monitors/new", "routes/app/monitor-edit.tsx", { id: "monitor-new" }),
      route("monitors/:id/edit", "routes/app/monitor-edit.tsx", { id: "monitor-edit" }),
      route("monitors/:id", "routes/app/monitor-detail.tsx"),
      route("pages", "routes/app/pages.tsx"),
      route("pages/:id", "routes/app/page-editor.tsx"),
      route("incidents", "routes/app/incidents.tsx"),
      route("incidents/new", "routes/app/incident-new.tsx"),
      route("incidents/:id", "routes/app/incident-detail.tsx"),
      route("channels", "routes/app/channels.tsx"),
      route("relays", "routes/app/relays.tsx"),
      route("settings", "routes/app/settings.tsx"),
      route("admin", "routes/app/admin.tsx"),
      route("switch-org", "routes/app/switch-org.ts"),
    ]),
  ]),

  ...prefix("s/:slug", [
    layout("routes/status/layout.tsx", [
      index("routes/status/index.tsx"),
      route("incidents", "routes/status/incidents.tsx"),
      route("incidents/:id", "routes/status/incident.tsx"),
    ]),
    route("status.json", "routes/status/json.ts"),
    route("status.md", "routes/status/markdown.ts"),
    route("feed.xml", "routes/status/feed.ts"),
    route("badge.svg", "routes/status/badge.ts"),
    route("og.png", "routes/status/og.ts"),
    route("subscribe", "routes/status/subscribe.ts"),
    route("confirm/:token", "routes/status/confirm.ts"),
    route("unsubscribe/:token", "routes/status/unsubscribe.ts"),
    route("embed", "routes/status/embed.tsx"),
  ]),

  // Custom-domain copies of the status routes. They only answer when the request's host is a
  // page's verified custom domain (the slug comes from the host); otherwise they 404.
  // "/" itself is routes/home.tsx, which renders the status page on a custom domain.
  layout("routes/status/layout.tsx", { id: "cd-status-layout" }, [
    route("incidents", "routes/status/incidents.tsx", { id: "cd-incidents" }),
    route("incidents/:id", "routes/status/incident.tsx", { id: "cd-incident" }),
  ]),
  route("status.json", "routes/status/json.ts", { id: "cd-json" }),
  route("status.md", "routes/status/markdown.ts", { id: "cd-markdown" }),
  route("feed.xml", "routes/status/feed.ts", { id: "cd-feed" }),
  route("badge.svg", "routes/status/badge.ts", { id: "cd-badge" }),
  route("og.png", "routes/status/og.ts", { id: "cd-og" }),
  route("subscribe", "routes/status/subscribe.ts", { id: "cd-subscribe" }),
  route("confirm/:token", "routes/status/confirm.ts", { id: "cd-confirm" }),
  route("unsubscribe/:token", "routes/status/unsubscribe.ts", { id: "cd-unsubscribe" }),
  route("embed", "routes/status/embed.tsx", { id: "cd-embed" }),

  route("robots.txt", "routes/seo/robots.ts"),
  route("sitemap.xml", "routes/seo/sitemap.ts"),
  route("llms.txt", "routes/seo/llms.ts"),
  route("llms-full.txt", "routes/seo/llms-full.ts"),
  route("mcp", "routes/api/mcp.ts"),
  ...prefix("api", [
    route("health", "routes/api/health.ts"),
    route("edge/ask", "routes/api/edge-ask.ts"),
    route("openapi.json", "routes/api/openapi.ts"),
    route("push/:token", "routes/api/push.ts"),
    route("relay/config", "routes/api/relay-config.ts"),
    route("relay/results", "routes/api/relay-results.ts"),
    route("v1/status/:slug", "routes/api/v1-status.ts"),
    route("v1/monitors", "routes/api/v1-monitors.ts"),
    route("v1/monitors/:id/history", "routes/api/v1-monitor-history.ts"),
  ]),
  route("uploads/*", "routes/uploads.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
