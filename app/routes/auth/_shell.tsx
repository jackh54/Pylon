import { Link } from "react-router";
import type { ReactNode } from "react";
import { Logo } from "~/components/icons";
import { BRAND } from "~/lib/brand";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="flex items-center gap-2 font-semibold mb-8"><Logo className="size-7" />{BRAND.name}</Link>
      <div className="card w-full max-w-sm p-6 sm:p-7">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <p className="mt-6 text-sm text-fg-muted">{footer}</p>}
    </main>
  );
}

export function DiscordButton({ next }: { next?: string }) {
  return (
    <a href={`/auth/discord${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="btn-secondary w-full">
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.4a18.3 18.3 0 0 1 4.4 2.2 15.5 15.5 0 0 0-15.2 0A18.3 18.3 0 0 1 8.8 3.4L8.6 3a19.8 19.8 0 0 0-4.9 1.5C.6 9 0 13.4.3 17.8a20 20 0 0 0 6 3l1.3-2a12.6 12.6 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4-2 1 1.2 2a20 20 0 0 0 6-3c.4-5-.7-9.4-3.5-13.4ZM8.7 15.1c-1.2 0-2.1-1.1-2.1-2.4s1-2.4 2.1-2.4c1.2 0 2.2 1.1 2.1 2.4 0 1.3-.9 2.4-2.1 2.4Zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z" /></svg>
      Continue with Discord
    </a>
  );
}
