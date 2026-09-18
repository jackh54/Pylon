import { useEffect } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { BRAND } from "./lib/brand";
import { getCf } from "./lib/server";
import { looksLikeStaleBuild, reloadOnce, watchForStaleBuild } from "./lib/stale-build";

export const links: Route.LinksFunction = () => [{ rel: "manifest", href: "/site.webmanifest" }];

// A status page on its own domain should show its own icon, so the icon link is rendered from
// loader data rather than being hard-coded here.
export function loader({ context }: Route.LoaderArgs) {
  return { icon: getCf(context).customDomainFavicon ?? null };
}

// Runs before paint: avoids a light/dark flash. Status pages may pin a mode via data-theme.
const themeScript = `(function(){try{var d=document.documentElement;var f=d.getAttribute('data-theme');var m=f&&f!=='system'?f:(localStorage.getItem('theme')||'system');if(m==='system'){m=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.classList.toggle('dark',m==='dark')}catch(e){}})();`;

// Runs before the app's own scripts, so it still works when those are the ones that fail: if this
// document came from the edge cache of a previous deploy, its asset files 404 and nothing boots.
// Reloading fetches the current build. The timestamp guard prevents a reload loop.
const recoverScript = `(function(){var done=false;addEventListener('error',function(e){var t=e.target;if(!t||done)return;var u=t.src||t.href||'';if((t.tagName==='SCRIPT'||t.tagName==='LINK')&&u.indexOf('/assets/')>-1){try{var k='pylon:last-reload';var last=+(sessionStorage.getItem(k)||0);if(Date.now()-last<30000)return;sessionStorage.setItem(k,String(Date.now()))}catch(err){}done=true;location.reload()}},true)})();`;

export function Layout({ children }: { children: React.ReactNode }) {
  const icon = useRouteLoaderData<typeof loader>("root")?.icon;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="generator" content={`${BRAND.name} (open source)`} />
        {icon ? <link rel="icon" href={icon} /> : <><link rel="icon" href="/favicon.svg" type="image/svg+xml" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /></>}
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: recoverScript }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useEffect(() => {
    (window as { __pylonHydrated?: boolean }).__pylonHydrated = true;
    return watchForStaleBuild();
  }, []);
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // A deploy while this tab was open leaves it pointing at files that no longer exist; reload into
  // the new build instead of showing an error the visitor can do nothing about.
  const stale = !isRouteErrorResponse(error) && looksLikeStaleBuild(error);
  useEffect(() => { if (stale) reloadOnce(); }, [stale]);

  let title = "Something went wrong";
  let detail = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    detail = error.status === 404 ? "The page you are looking for doesn't exist." : (typeof error.data === "string" ? error.data : error.statusText || detail);
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
    stack = error.stack;
  }
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-lg w-full text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-fg-faint">{BRAND.name}</p>
        <h1 className="mt-3 text-3xl font-semibold">{stale ? "Updating…" : title}</h1>
        <p className="mt-2 text-fg-muted">{stale ? "This page was updated. Reloading…" : detail}</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">Reload</button>
          <a href="/" className="btn-secondary">Back home</a>
        </div>
        {stack && <pre className="mt-8 text-left text-xs overflow-x-auto p-4 rounded-lg bg-surface-2 border border-line">{stack}</pre>}
      </div>
    </main>
  );
}
