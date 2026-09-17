import { Form, data } from "react-router";
import { desc, eq, sql } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import type { Route } from "./+types/admin";
import { Badge, Card, CardHeader, PageHeader, Select, Stat, Table, Td, Th } from "~/components/ui";
import { formatDate } from "~/lib/format";
import { getDb, getEnv, requireAuth } from "~/lib/server";
import { monitors, orgMembers, organizations, statusPages, users } from "@server/db/schema";
import { PLANS, defaultPlan, isHosted, isInstanceAdmin } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Instance admin — Pylon" }];

function requireInstanceAdmin(context: Route.LoaderArgs["context"]) {
  const auth = requireAuth(context);
  if (!isInstanceAdmin(getEnv(context), auth.user.email)) throw data("Not found", { status: 404 });
  return auth;
}

export async function loader({ context }: Route.LoaderArgs) {
  requireInstanceAdmin(context);
  const db = getDb(context);
  const env = getEnv(context);
  const [orgs, userCount, monitorCount] = await Promise.all([
    db.select({
      org: organizations,
      monitors: sql<number>`(select count(*) from ${monitors} where ${monitors.orgId} = ${organizations.id})`,
      pages: sql<number>`(select count(*) from ${statusPages} where ${statusPages.orgId} = ${organizations.id})`,
      members: sql<number>`(select count(*) from ${orgMembers} where ${orgMembers.orgId} = ${organizations.id})`,
      owner: sql<string | null>`(select ${users.email} from ${orgMembers} join ${users} on ${users.id} = ${orgMembers.userId} where ${orgMembers.orgId} = ${organizations.id} and ${orgMembers.role} = 'owner' limit 1)`,
    }).from(organizations).orderBy(desc(organizations.createdAt)).limit(500).all(),
    db.select({ n: sql<number>`count(*)` }).from(users).get(),
    db.select({ n: sql<number>`count(*)` }).from(monitors).get(),
  ]);
  return {
    mode: isHosted(env) ? "hosted" : "self-hosted",
    defaultPlan: defaultPlan(env),
    plans: (Object.keys(PLANS) as (keyof typeof PLANS)[]).filter((p) => p !== "unlimited"),
    totals: { orgs: orgs.length, users: userCount?.n ?? 0, monitors: monitorCount?.n ?? 0 },
    orgs: orgs.map((r) => ({ id: r.org.id, name: r.org.name, slug: r.org.slug, plan: r.org.plan, createdAt: r.org.createdAt, monitors: r.monitors, pages: r.pages, members: r.members, owner: r.owner })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  requireInstanceAdmin(context);
  const db = getDb(context);
  const form = await request.formData();
  if (form.get("intent") === "set-plan") {
    const orgId = String(form.get("orgId") ?? "");
    const plan = String(form.get("plan") ?? "");
    if (!(plan in PLANS) || plan === "unlimited") throw data("Invalid plan", { status: 400 });
    await db.update(organizations).set({ plan }).where(eq(organizations.id, orgId));
  }
  return null;
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { mode, defaultPlan: def, plans, totals, orgs } = loaderData;
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2"><ShieldCheck className="size-6 text-accent" />Instance admin</span>} description={`Mode: ${mode} · new teams start on the ${def} plan`} />
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Stat label="Teams" value={totals.orgs} />
        <Stat label="Users" value={totals.users} />
        <Stat label="Monitors" value={totals.monitors} />
      </div>
      <Card>
        <CardHeader title="Teams" description="Change a team's plan here until billing is wired up." />
        <Table className="border-0 rounded-none">
          <thead><tr><Th>Team</Th><Th>Owner</Th><Th>Plan</Th><Th>Monitors</Th><Th>Pages</Th><Th>Members</Th><Th>Created</Th></tr></thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <Td><p className="font-medium">{o.name}</p><p className="text-xs text-fg-muted">{o.slug}</p></Td>
                <Td className="text-xs text-fg-muted">{o.owner ?? "—"}</Td>
                <Td>
                  {mode === "hosted" ? (
                    <Form method="post"><input type="hidden" name="intent" value="set-plan" /><input type="hidden" name="orgId" value={o.id} />
                      <Select name="plan" defaultValue={o.plan} className="w-28 py-1 text-xs" onChange={(e) => e.currentTarget.form?.requestSubmit()}>{plans.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
                    </Form>
                  ) : <Badge>unlimited</Badge>}
                </Td>
                <Td className="tabular-nums">{o.monitors}</Td>
                <Td className="tabular-nums">{o.pages}</Td>
                <Td className="tabular-nums">{o.members}</Td>
                <Td className="text-xs text-fg-muted whitespace-nowrap">{formatDate(o.createdAt, { dateStyle: "medium" })}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
