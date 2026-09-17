import { useState } from "react";
import { Form, Link, NavLink, Outlet, redirect, useLocation } from "react-router";
import { Activity, Bell, FileText, LayoutDashboard, LogOut, Menu, Radio, Settings, Siren, X, BookOpen, Moon, Sun, ShieldCheck } from "lucide-react";
import type { Route } from "./+types/layout";
import { Logo } from "~/components/icons";
import { cn } from "~/components/ui";
import { BRAND } from "~/lib/brand";
import { authContext } from "~/lib/context";
import { getDb, getEnv } from "~/lib/server";
import { isInstanceAdmin } from "@server/plans";
import { getAuth } from "@server/auth/session";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, context }, next) => {
    const auth = await getAuth(getDb(context), request);
    if (!auth) {
      const url = new URL(request.url);
      throw redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    }
    if (!auth.org) throw redirect("/onboarding");
    context.set(authContext, auth);
    return next();
  },
];

export async function loader({ context }: Route.LoaderArgs) {
  const auth = context.get(authContext)!;
  return {
    user: { name: auth.user.name, email: auth.user.email, avatarUrl: auth.user.avatarUrl },
    org: { id: auth.org!.id, name: auth.org!.name, slug: auth.org!.slug, role: auth.org!.role },
    orgs: auth.orgs.map((o) => ({ id: o.id, name: o.name })),
    instanceAdmin: isInstanceAdmin(getEnv(context), auth.user.email),
  };
}

export const meta: Route.MetaFunction = () => [{ name: "robots", content: "noindex" }];

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/monitors", label: "Monitors", icon: Activity },
  { to: "/app/pages", label: "Status pages", icon: FileText },
  { to: "/app/incidents", label: "Incidents", icon: Siren },
  { to: "/app/channels", label: "Notifications", icon: Bell },
  { to: "/app/relays", label: "Relays", icon: Radio },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

function ThemeToggle() {
  return (
    <button type="button" className="btn-ghost btn-sm" aria-label="Toggle theme" onClick={() => {
      const d = document.documentElement; const dark = !d.classList.contains("dark");
      d.classList.toggle("dark", dark); try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* ignore */ }
    }}>
      <Sun className="size-4 dark:hidden" /><Moon className="size-4 hidden dark:block" />
    </button>
  );
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, org, orgs, instanceAdmin } = loaderData;
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const nav = (
    <nav className="flex flex-col gap-0.5">
      {[...NAV, ...(instanceAdmin ? [{ to: "/app/admin", label: "Admin", icon: ShieldCheck, end: false }] : [])].map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
          className={({ isActive }) => cn("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm", isActive ? "bg-surface-2 font-medium text-fg" : "text-fg-muted hover:bg-surface-2/60 hover:text-fg")}>
          <n.icon className="size-4" />{n.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden lg:flex flex-col border-r border-line bg-surface/50 px-3 py-4 sticky top-0 h-dvh">
        <Link to="/app" className="flex items-center gap-2 px-2 font-semibold"><Logo className="size-6" />{BRAND.name}</Link>
        <div className="mt-5">
          {orgs.length > 1 ? (
            <Form method="post" action="/app/switch-org">
              <select name="orgId" defaultValue={org.id} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="input text-xs py-1.5">
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Form>
          ) : (
            <p className="px-2 text-xs text-fg-muted truncate">{org.name}</p>
          )}
        </div>
        <div className="mt-4 flex-1">{nav}</div>
        <div className="border-t border-line pt-3 space-y-1">
          <Link to="/docs" className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted hover:text-fg"><BookOpen className="size-4" />Docs</Link>
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="size-6 rounded-full" /> : <span className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-[11px] font-semibold text-accent">{user.name.slice(0, 1).toUpperCase()}</span>}
            <span className="min-w-0 flex-1 truncate text-xs">{user.name}</span>
            <ThemeToggle />
            <Form method="post" action="/logout"><button type="submit" className="btn-ghost btn-sm" aria-label="Sign out"><LogOut className="size-4" /></button></Form>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/90 backdrop-blur px-4">
          <Link to="/app" className="flex items-center gap-2 font-semibold"><Logo className="size-6" />{BRAND.name}</Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button type="button" className="btn-ghost btn-sm" aria-label="Menu" onClick={() => setOpen((v) => !v)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          </div>
        </header>
        {open && (
          <div className="lg:hidden border-b border-line bg-surface px-3 py-3">
            {nav}
            <Form method="post" action="/logout" className="mt-2 border-t border-line pt-2"><button type="submit" className="btn-ghost w-full justify-start"><LogOut className="size-4" />Sign out</button></Form>
          </div>
        )}
        <main key={location.pathname} className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
