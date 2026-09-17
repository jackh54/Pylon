import { eq } from "drizzle-orm";
import type { Database } from "../db";
import { incidentComponents, incidentUpdates, incidents, type IncidentImpact, type IncidentStatus } from "../db/schema";
import { newId } from "../lib/ids";

export async function createIncident(db: Database, input: {
  orgId: string; pageId: string; title: string; status: IncidentStatus; impact: IncidentImpact; body: string; componentIds: string[]; userId?: string;
}): Promise<string> {
  const id = newId("inc");
  const now = Date.now();
  const stmts = [
    db.insert(incidents).values({ id, orgId: input.orgId, pageId: input.pageId, title: input.title, status: input.status, impact: input.impact, startedAt: now, resolvedAt: input.status === "resolved" ? now : null, createdBy: input.userId ?? null }),
    db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: id, status: input.status, body: input.body, createdBy: input.userId ?? null }),
    ...input.componentIds.map((componentId) => db.insert(incidentComponents).values({ incidentId: id, componentId })),
  ];
  await db.batch([stmts[0]!, ...stmts.slice(1)]);
  return id;
}

export async function addIncidentUpdate(db: Database, input: { incidentId: string; status: IncidentStatus; body: string; userId?: string }): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.insert(incidentUpdates).values({ id: newId("upd"), incidentId: input.incidentId, status: input.status, body: input.body, createdBy: input.userId ?? null }),
    db.update(incidents).set({ status: input.status, updatedAt: now, resolvedAt: input.status === "resolved" ? now : null }).where(eq(incidents.id, input.incidentId)),
  ]);
}
