/* Client-safe status helpers (no server imports). */
import type { MonitorStatus } from "../db/schema";

export type ComponentState = "operational" | "degraded" | "down" | "maintenance" | "unknown";
export type OverallState = ComponentState;

export const STATE_LABEL: Record<OverallState, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  down: "Service disruption",
  maintenance: "Scheduled maintenance in progress",
  unknown: "Status unknown",
};

export function componentState(status: MonitorStatus | null | undefined, underMaintenance: boolean): ComponentState {
  if (underMaintenance) return "maintenance";
  switch (status) {
    case "up": return "operational";
    case "degraded": return "degraded";
    case "down": return "down";
    default: return "unknown";
  }
}
