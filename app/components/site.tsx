import { Link } from "react-router";
import { Logo } from "./icons";
import { BRAND } from "~/lib/brand";

export function GithubIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function SiteHeader({ user }: { user?: { name: string } | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold"><Logo className="size-6" />{BRAND.name}</Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm">
          <a href="/#pricing" className="btn-ghost btn-sm hidden sm:inline-flex">Pricing</a>
          <Link to="/docs" className="btn-ghost btn-sm">Docs</Link>
          <a href={BRAND.repo} className="btn-ghost btn-sm" target="_blank" rel="noopener"><GithubIcon />GitHub</a>
          {user ? <Link to="/app" className="btn-primary btn-sm">Dashboard</Link> : (
            <>
              <Link to="/login" className="btn-ghost btn-sm hidden sm:inline-flex">Sign in</Link>
              <Link to="/register" className="btn-primary btn-sm">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line mt-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid gap-8 sm:grid-cols-4 text-sm">
        <div className="sm:col-span-2">
          <p className="flex items-center gap-2 font-semibold"><Logo className="size-5" />{BRAND.name}</p>
          <p className="mt-2 text-fg-muted max-w-sm">{BRAND.tagline}. Open source, self-hostable on Cloudflare's free tier.</p>
        </div>
        <div>
          <p className="font-medium mb-2">Product</p>
          <ul className="space-y-1 text-fg-muted">
            <li><Link to="/docs" className="hover:text-fg">Documentation</Link></li>
            <li><Link to="/docs/monitors" className="hover:text-fg">Supported games</Link></li>
            <li><Link to="/docs/api" className="hover:text-fg">API &amp; MCP</Link></li>
            <li><Link to="/docs/self-hosting" className="hover:text-fg">Self-hosting</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-medium mb-2">For agents</p>
          <ul className="space-y-1 text-fg-muted">
            <li><a href="/llms.txt" className="hover:text-fg">llms.txt</a></li>
            <li><a href="/api/openapi.json" className="hover:text-fg">OpenAPI</a></li>
            <li><a href="/mcp" className="hover:text-fg">MCP endpoint</a></li>
            <li><a href="/sitemap.xml" className="hover:text-fg">Sitemap</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-8 flex flex-wrap gap-4 text-xs text-fg-faint"><span>© {new Date().getFullYear()} {BRAND.author}. AGPL-3.0.</span><Link to="/legal/terms" className="hover:text-fg">Terms</Link><Link to="/legal/privacy" className="hover:text-fg">Privacy</Link></div>
    </footer>
  );
}
