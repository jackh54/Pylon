import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigation } from "react-router";
import { Check, Copy, Loader2, ArrowLeft } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "up" | "down" | "degraded" | "maint" | "unknown" | "neutral" | "accent";

export function toneFor(state: string | null | undefined): Tone {
  switch (state) {
    case "up": case "operational": case "resolved": return "up";
    case "down": case "critical": case "major": case "investigating": return "down";
    case "degraded": case "minor": case "identified": return "degraded";
    case "maintenance": case "monitoring": return "maint";
    default: return "unknown";
  }
}

const TONE_BG: Record<Tone, string> = {
  up: "bg-up/12 text-up", down: "bg-down/12 text-down", degraded: "bg-degraded/15 text-degraded", maint: "bg-maint/12 text-maint",
  unknown: "bg-unknown/15 text-fg-muted", neutral: "bg-surface-2 text-fg-muted", accent: "bg-accent/15 text-accent",
};
const TONE_DOT: Record<Tone, string> = {
  up: "bg-up", down: "bg-down", degraded: "bg-degraded", maint: "bg-maint", unknown: "bg-unknown", neutral: "bg-fg-faint", accent: "bg-accent",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", TONE_BG[tone], className)}>{children}</span>;
}

export function StatusDot({ tone, live = false, className }: { tone: Tone; live?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-block size-2.5 rounded-full shrink-0", TONE_DOT[tone], live && tone !== "unknown" && "live-dot", className)} style={{ color: `var(--${tone === "maint" ? "maint" : tone === "neutral" ? "unknown" : tone})` }} aria-hidden="true" />
  );
}

export function Field({ label, name, error, help, children, className }: { label: string; name?: string; error?: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-down">{error}</p> : help ? <p className="mt-1 text-xs text-fg-faint">{help}</p> : null}
    </div>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} id={props.id ?? props.name} className={cn("input", props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} id={props.id ?? props.name} className={cn("input", props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} id={props.id ?? props.name} className={cn("input min-h-24", props.className)} />;
}
export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <input type="checkbox" {...props} className={cn("size-4 rounded border-line accent-[var(--accent)]", props.className)} />
      <span>{label}</span>
    </label>
  );
}

export function SubmitButton({ children, className, pendingText, variant = "primary", ...rest }: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "accent" | "secondary" | "danger" | "ghost" }) {
  const nav = useNavigation();
  const pending = nav.state !== "idle" && nav.formMethod !== undefined;
  const cls = { primary: "btn-primary", accent: "btn-accent", secondary: "btn-secondary", danger: "btn-danger", ghost: "btn-ghost" }[variant];
  return (
    <button type="submit" disabled={pending} className={cn(cls, className)} {...rest}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

export function Card({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <Tag className={cn("card", className)}>{children}</Tag>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-line", className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link to={back.to} className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg mb-2"><ArrowLeft className="size-3.5" />{back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold truncate">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center text-center px-6 py-14">
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-surface-2 text-fg-muted">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg px-4 py-3 text-sm", TONE_BG[tone], className)}>{children}</div>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-fg-faint font-medium">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone && tone !== "neutral" && tone !== "unknown" && `text-${tone}`)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("card overflow-x-auto", className)}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-fg-faint border-b border-line bg-surface-2/60", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 border-b border-line last:border-0 align-middle", className)}>{children}</td>;
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t); }, [copied]);
  return (
    <button type="button" className={cn("btn-secondary btn-sm", className)} onClick={() => { navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}>
      {copied ? <Check className="size-3.5 text-up" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function Code({ children, className }: { children: string; className?: string }) {
  return <code className={cn("font-mono text-[12.5px] bg-surface-2 border border-line rounded px-1.5 py-0.5 break-all", className)}>{children}</code>;
}

export function Tabs({ tabs, current, onChange }: { tabs: { id: string; label: string }[]; current: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line mb-5" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={current === t.id} onClick={() => onChange(t.id)}
          className={cn("px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap", current === t.id ? "border-fg text-fg font-medium" : "border-transparent text-fg-muted hover:text-fg")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
