import { useEffect, useState, type ReactNode } from "react";
import { Form, Link, useFetcher } from "react-router";
import { ExternalLink, Lock, Moon, Rss, Sun, Bell, X } from "lucide-react";
import { Logo } from "~/components/icons";
import { Input, SubmitButton, cn } from "~/components/ui";
import { GithubIcon } from "~/components/site";
import { BRAND } from "~/lib/brand";
import { StatusLayoutContext } from "~/routes/status/_shared";
import type { StatusShellData } from "~/routes/status/_shared";

function SubscribeBox({ basePath, onClose }: { basePath: string; onClose: () => void }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  return (
    <div className="absolute right-0 top-full mt-2 w-80 card p-4 shadow-xl z-40">
      <div className="flex items-center justify-between"><p className="font-medium text-sm">Get incident updates</p><button type="button" onClick={onClose} className="btn-ghost btn-sm" aria-label="Close"><X className="size-4" /></button></div>
      {fetcher.data?.ok ? <p className="mt-3 text-sm text-up">{fetcher.data.message}</p> : (
        <fetcher.Form method="post" action={`${basePath}/subscribe`} className="mt-3 space-y-2">
          <Input name="email" type="email" required placeholder="you@example.com" />
          <button type="submit" className="btn-accent w-full btn-sm" disabled={fetcher.state !== "idle"}>{fetcher.state !== "idle" ? "Subscribing…" : "Subscribe by email"}</button>
          {fetcher.data && !fetcher.data.ok && <p className="text-xs text-down">{fetcher.data.message}</p>}
          <p className="text-[11px] text-fg-faint">Or use <a href={`${basePath}/feed.xml`} className="underline">RSS</a> · <a href={`${basePath}/status.json`} className="underline">JSON</a></p>
        </fetcher.Form>
      )}
    </div>
  );
}

export function StatusShell({ data: shellData, error, children }: { data: StatusShellData; error?: string; children: ReactNode }) {
  const { shell, basePath, gated } = shellData;
  const t = shell.theme;
  const radius = t.radius === "sharp" ? "0.25rem" : t.radius === "pill" ? "1.25rem" : "0.75rem";
  const font = t.font === "system" ? "ui-sans-serif, system-ui, sans-serif" : t.font === "mono" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "";
  const css = `.status-root{--accent:${t.accent};--radius:${radius};${t.background ? `--bg:${t.background};` : ""}${font ? `font-family:${font};` : ""}}${t.customCss ?? ""}`.replace(/<\/style/gi, "");
  const modeScript = t.mode === "system"
    ? `(function(){var d=document.documentElement;d.setAttribute('data-theme','system');d.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches)})();`
    : `(function(){var d=document.documentElement;d.setAttribute('data-theme','${t.mode}');d.classList.toggle('dark',${t.mode === "dark"})})();`;
  const [subOpen, setSubOpen] = useState(false);
  // The inline script sets the theme before first paint on page load. React can't run scripts it
  // creates during client navigation, so later mounts apply the theme in an effect instead.
  const [clientMount] = useState(() => typeof window !== "undefined" && (window as { __pylonHydrated?: boolean }).__pylonHydrated === true);
  useEffect(() => {
    const d = document.documentElement;
    d.setAttribute("data-theme", t.mode);
    d.classList.toggle("dark", t.mode === "dark" || (t.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches));
  }, [t.mode]);
  const links = [
    shell.links.website && { label: "Website", href: shell.links.website },
    shell.links.store && { label: "Store", href: shell.links.store },
    shell.links.discord && { label: "Discord", href: shell.links.discord },
    shell.links.twitter && { label: "Twitter", href: shell.links.twitter },
  ].filter((x): x is { label: string; href: string } => !!x);

  return (
    <StatusLayoutContext.Provider value={shellData}>
    <div className="status-root min-h-dvh bg-bg text-fg flex flex-col">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {!clientMount && <script dangerouslySetInnerHTML={{ __html: modeScript }} />}
      {shell.faviconUrl && <link rel="icon" href={shell.faviconUrl} />}
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to={basePath || "/"} className="flex min-w-0 items-center gap-2.5 font-semibold">
            {shell.logoUrl ? <img src={shell.logoUrl} alt="" className="size-8 rounded-md object-contain" /> : <Logo className="size-7" />}
            <span className="truncate">{shell.name}</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noopener" className="btn-ghost btn-sm hidden sm:inline-flex">{l.label}<ExternalLink className="size-3" /></a>)}
            <button type="button" className="btn-ghost btn-sm" aria-label="Toggle theme" onClick={() => document.documentElement.classList.toggle("dark")}><Sun className="size-4 dark:hidden" /><Moon className="size-4 hidden dark:block" /></button>
            {!gated && shell.allowSubscribers && (
              <div className="relative">
                <button type="button" className="btn-secondary btn-sm" onClick={() => setSubOpen((v) => !v)}><Bell className="size-3.5" />Subscribe</button>
                {subOpen && <SubscribeBox basePath={basePath} onClose={() => setSubOpen(false)} />}
              </div>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 sm:px-6 py-8">
        {gated ? (
          <div className="mx-auto max-w-sm card p-6 mt-10">
            <div className="flex size-10 items-center justify-center rounded-lg bg-surface-2"><Lock className="size-5 text-fg-muted" /></div>
            <h1 className="mt-4 text-lg font-semibold">This status page is private</h1>
            <p className="mt-1 text-sm text-fg-muted">Enter the password to continue.</p>
            <Form method="post" className="mt-4 space-y-3">
              <Input name="password" type="password" required autoFocus placeholder="Password" />
              {error && <p className="text-xs text-down">{error}</p>}
              <SubmitButton className="w-full">Unlock</SubmitButton>
            </Form>
          </div>
        ) : children}
      </main>
      <footer className="border-t border-line/70">
        <div className={cn("mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-5 text-xs text-fg-muted")}>
          {shell.showBranding ? <p className="flex items-center gap-1.5">Powered by <a href={BRAND.repo} className="inline-flex items-center gap-1 font-medium text-fg hover:underline" rel="noopener"><Logo className="size-3.5" />{BRAND.name}</a></p> : <span />}
          <p className="flex items-center gap-3">
            <a href={`${basePath}/feed.xml`} className="inline-flex items-center gap-1 hover:text-fg"><Rss className="size-3.5" />RSS</a>
            <a href={`${basePath}/status.json`} className="hover:text-fg">JSON</a>
            <a href={`${basePath}/status.md`} className="hover:text-fg">Markdown</a>
            <a href={`${basePath}/badge.svg`} className="hover:text-fg">Badge</a>
            <Link to={`${basePath}/incidents`} className="hover:text-fg">Incident history</Link>
            <a href={BRAND.repo} className="hover:text-fg" rel="noopener" aria-label="GitHub"><GithubIcon className="size-3.5" /></a>
          </p>
        </div>
      </footer>
    </div>
    </StatusLayoutContext.Provider>
  );
}
