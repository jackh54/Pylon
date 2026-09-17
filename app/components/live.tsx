import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
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
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;

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
      ws.onopen = () => { setConnected(true); stopPolling(); retry = 1000; pingTimer = setInterval(() => ws?.send("ping"), 30_000); };
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
