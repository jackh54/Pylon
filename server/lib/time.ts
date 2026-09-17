export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** YYYY-MM-DD in UTC */
export function utcDay(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** List of YYYY-MM-DD strings for the last `days` days ending today (UTC), oldest first. */
export function lastDays(days: number, now: number = Date.now()): string[] {
  const out: string[] = [];
  const start = startOfUtcDay(now) - (days - 1) * DAY;
  for (let i = 0; i < days; i++) out.push(utcDay(start + i * DAY));
  return out;
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 5 * SECOND) return "just now";
  if (abs < MINUTE) return `${Math.round(abs / SECOND)}s ${suffix}`;
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}m ${suffix}`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}h ${suffix}`;
  return `${Math.round(abs / DAY)}d ${suffix}`;
}

export function formatDuration(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / SECOND))}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.round((ms % HOUR) / MINUTE);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.round((ms % DAY) / HOUR);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      try { onTimeout?.(); } catch { /* ignore */ }
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
