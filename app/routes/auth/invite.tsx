import { Form, data, redirect } from "react-router";
import { and, eq, gt } from "drizzle-orm";
import type { Route } from "./+types/invite";
import { AuthShell } from "./_shell";
import { SubmitButton } from "~/components/ui";
import { getDb, getEnv } from "~/lib/server";
import { ORG_COOKIE, getAuth, isSecure, serializeCookie } from "@server/auth/session";
import { orgInvites, orgMembers, organizations } from "@server/db/schema";

export const meta: Route.MetaFunction = () => [{ title: "Join team — Pylon" }, { name: "robots", content: "noindex" }];

async function findInvite(db: ReturnType<typeof getDb>, token: string) {
  return db.select({ invite: orgInvites, org: organizations }).from(orgInvites).innerJoin(organizations, eq(organizations.id, orgInvites.orgId))
    .where(and(eq(orgInvites.token, token), gt(orgInvites.expiresAt, Date.now()))).get();
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const db = getDb(context);
  const row = await findInvite(db, params.token);
  if (!row) throw data("This invite link is invalid or has expired.", { status: 404 });
  const auth = await getAuth(db, request);
  if (!auth) throw redirect(`/register?next=${encodeURIComponent(`/invite/${params.token}`)}`);
  return { orgName: row.org.name, role: row.invite.role, email: auth.user.email };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const db = getDb(context);
  const auth = await getAuth(db, request);
  if (!auth) throw redirect("/login");
  const row = await findInvite(db, params.token);
  if (!row) throw data("Invite expired", { status: 404 });
  await db.insert(orgMembers).values({ orgId: row.org.id, userId: auth.user.id, role: row.invite.role }).onConflictDoNothing();
  await db.delete(orgInvites).where(eq(orgInvites.id, row.invite.id));
  return redirect("/app", { headers: { "Set-Cookie": serializeCookie(ORG_COOKIE, row.org.id, { maxAge: 365 * 86400, secure: isSecure(getEnv(context).APP_URL) }) } });
}

export default function Invite({ loaderData }: Route.ComponentProps) {
  return (
    <AuthShell title={`Join ${loaderData.orgName}`} subtitle={`You've been invited as ${loaderData.role}. Signed in as ${loaderData.email}.`}>
      <Form method="post"><SubmitButton className="w-full">Accept invite</SubmitButton></Form>
    </AuthShell>
  );
}
