import { useState } from "react";
import { cn, toneFor } from "./ui";
import type { Tone } from "./ui";
import { formatDay, formatDuration } from "~/lib/format";
import type { PublicHistoryDay } from "@server/services/status";

const TONE_VAR: Record<Tone, string> = { up: "var(--up)", down: "var(--down)", degraded: "var(--degraded)", maint: "var(--maint)", unknown: "var(--unknown)", neutral: "var(--unknown)", accent: "var(--accent)" };

export function dayTone(d: PublicHistoryDay): Tone {
  if (d.uptime === null) return "unknown";
  if (d.uptime >= 99.9) return "up";
  if (d.uptime >= 97) return "degraded";
  return "down";
}

/** 90-day uptime history bars. One shared tooltip (not one per bar) keeps the SSR HTML small; `title` covers no-JS. */
export function UptimeBars({ history, style = "bars", className }: { history: PublicHistoryDay[]; style?: "bars" | "dots"; className?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const d = hover !== null ? history[hover] : undefined;
  return (
    <div className="relative">
      <div className={cn("flex items-end gap-px sm:gap-[3px] w-full", className)} role="img" aria-label={`Uptime over the last ${history.length} days`} onMouseLeave={() => setHover(null)}>
        {history.map((h, i) => {
          const tone = dayTone(h);
          return (
            <div key={h.day} onMouseEnter={() => setHover(i)} title={`${formatDay(h.day)} · ${h.uptime === null ? "no data" : `${h.uptime.toFixed(2)}% uptime`}`}
              className={cn("flex-1 min-w-0 transition-opacity hover:opacity-70", style === "dots" ? "aspect-square rounded-full" : "h-8 rounded-[2px]")}
              style={{ background: TONE_VAR[tone], opacity: tone === "unknown" ? 0.35 : 1 }} />
          );
        })}
      </div>
      {d && (
        <div className="pointer-events-none absolute bottom-full z-20 mb-2 w-44 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-left text-xs shadow-lg" style={{ left: `${((hover! + 0.5) / history.length) * 100}%` }}>
          <p className="font-medium">{formatDay(d.day)}</p>
          {d.uptime === null ? <p className="text-fg-muted">No data</p> : (
            <>
              <p className="text-fg-muted">{d.uptime.toFixed(2)}% uptime · {d.checks} checks</p>
              {d.downtimeSec > 0 && <p className="text-down">{formatDuration(d.downtimeSec * 1000)} downtime</p>}
              {d.avgLatency !== null && <p className="text-fg-muted">avg {d.avgLatency} ms</p>}
              {d.playersPeak > 0 && <p className="text-fg-muted">peak {d.playersPeak} players</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Minimal SVG sparkline; `points` are y values in order. */
export function Sparkline({ points, color = "var(--accent)", height = 36, className, fill = true }: { points: (number | null)[]; color?: string; height?: number; className?: string; fill?: boolean }) {
  const valid = points.filter((p): p is number => p !== null);
  if (valid.length < 2) return <div className={cn("text-xs text-fg-faint", className)} style={{ height }}>Not enough data</div>;
  const w = 100;
  const max = Math.max(...valid);
  const min = Math.min(...valid);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  let d = "";
  let started = false;
  points.forEach((p, i) => {
    if (p === null) { started = false; return; }
    const x = i * step;
    const y = height - 2 - ((p - min) / span) * (height - 4);
    d += `${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    started = true;
  });
  const first = points.findIndex((p) => p !== null);
  const last = points.length - 1 - [...points].reverse().findIndex((p) => p !== null);
  const area = `${d} L${(last * step).toFixed(2)},${height} L${(first * step).toFixed(2)},${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }} aria-hidden="true">
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Bar/line chart with axes for the monitor detail page. */
export function TimeChart({ series, height = 160, unit = "", className }: { series: { t: number; v: number | null }[]; height?: number; unit?: string; className?: string }) {
  const vals = series.map((s) => s.v).filter((v): v is number => v !== null);
  if (vals.length < 2) return <div className={cn("flex items-center justify-center text-sm text-fg-faint", className)} style={{ height }}>Not enough data yet</div>;
  const max = Math.max(...vals) * 1.1 || 1;
  const w = 600;
  const padL = 36;
  const padB = 18;
  const innerW = w - padL - 4;
  const innerH = height - padB - 6;
  const step = innerW / Math.max(1, series.length - 1);
  const y = (v: number) => 6 + innerH - (v / max) * innerH;
  let d = "";
  let started = false;
  series.forEach((s, i) => {
    if (s.v === null) { started = false; return; }
    d += `${started ? "L" : "M"}${(padL + i * step).toFixed(1)},${y(s.v).toFixed(1)} `;
    started = true;
  });
  const ticks = [0, max / 2, max];
  const first = series[0]!.t;
  const lastT = series[series.length - 1]!.t;
  const fmt = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  const fmtDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const multiDay = lastT - first > 36 * 3600 * 1000;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={cn("w-full", className)} style={{ height }} role="img" aria-label="Chart">
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={padL} x2={w - 4} y1={y(tk)} y2={y(tk)} stroke="var(--line)" strokeDasharray="2 3" />
          <text x={padL - 6} y={y(tk) + 3} textAnchor="end" fontSize="9" fill="var(--fg-faint)">{Math.round(tk)}{unit}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <text x={padL} y={height - 4} fontSize="9" fill="var(--fg-faint)">{multiDay ? fmtDay(first) : fmt(first)}</text>
      <text x={w - 4} y={height - 4} fontSize="9" fill="var(--fg-faint)" textAnchor="end">{multiDay ? fmtDay(lastT) : fmt(lastT)} UTC</text>
    </svg>
  );
}

export function StateLabel({ state, className }: { state: string; className?: string }) {
  const tone = toneFor(state);
  const label: Record<string, string> = { operational: "Operational", degraded: "Degraded", down: "Down", maintenance: "Maintenance", unknown: "Unknown", up: "Up", pending: "Pending", paused: "Paused" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", className)} style={{ color: TONE_VAR[tone] }}>
      {label[state] ?? state}
    </span>
  );
}
