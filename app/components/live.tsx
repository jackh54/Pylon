import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { looksLikeStaleBuild, reloadOnce } from "~/lib/stale-build";
import type { MonitorSnapshot, MonitorStatus } from "@server/db/schema";

export interface LiveUpdate {
  monitorId: string;
  componentId?: string;
  status: MonitorStatus;
  latencyMs: number | null;
  message: string | null;
  data: MonitorSnapshot;
  checkedAt: number;
  changed: boolean;
}

/**
 * Subscribes to a status page's LiveHub over WebSocket. Non-structural updates (players, latency)
 * patch local state; status changes trigger a loader revalidation so incidents/overall stay exact.
 * Falls back to polling the loader every 60s if the socket cannot connect.
 */
export function useLiveStatus(basePath: string, enabled = true) {
  const [updates, setUpdates] = useState<Record<string, LiveUpdate>>({});
  const [connected, setConnected] = useState(false);
  const revalidator = useRevalidator();
  const revalidate = useRef(() => {});
  // Background refreshes are best-effort: a dropped connection must not replace the page with an
  // error, and a refresh that fails because the app was redeployed reloads into the new build.
  revalidate.current = () => {
    Promise.resolve(revalidator.revalidate()).catch((e: unknown) => {
      if (looksLikeStaleBuild(e)) reloadOnce();
      else console.warn("[pylon] background refresh failed", e);
    });
  };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1000;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => { if (!pollTimer) pollTimer = setInterval(() => revalidate.current(), 60_000); };
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      try {
        ws = new WebSocket(`${proto}://${location.host}${basePath}/live`);
      } catch { startPolling(); return; }
      ws.onopen = () => {
        setConnected(true); stopPolling(); retry = 1000;
        // after the browser freezes a background tab the socket can be closing when this fires
        pingTimer = setInterval(() => { try { if (ws?.readyState === WebSocket.OPEN) ws.send("ping"); } catch { /* closing */ } }, 30_000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type: string } & Partial<LiveUpdate>;
          if (msg.type === "monitor" && msg.monitorId) {
            const u = msg as LiveUpdate & { type: string };
            setUpdates((prev) => ({ ...prev, [u.monitorId]: u }));
            if (u.changed) revalidate.current();
          }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (closed) return;
        startPolling();
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 30_000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    const onVisible = () => { if (document.visibilityState === "visible") revalidate.current(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      stopPolling();
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
    };
  }, [basePath, enabled]);

  return { updates, connected };
}
