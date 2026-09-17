/* Client-safe formatting helpers */
export { relativeTime, formatDuration } from "@server/lib/time";

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(ts)) + (opts.timeStyle ? " UTC" : "");
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export function formatBytesMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function formatDataValue(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "ms": return `${Math.round(Number(value))} ms`;
    case "mb": return formatBytesMb(Number(value));
    case "percent": return `${Number(value).toFixed(1)}%`;
    case "number": return typeof value === "number" ? formatNumber(value) : String(value);
    default: return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}
