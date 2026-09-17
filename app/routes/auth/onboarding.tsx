import { Form, data, redirect } from "react-router";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { Route } from "./+types/onboarding";
import { AuthShell } from "./_shell";
import { Field, Input, SubmitButton } from "~/components/ui";
import { getDb, getEnv, parseForm } from "~/lib/server";
import { createOrgForUser, getAuth } from "@server/auth/session";
import { organizations } from "@server/db/schema";
import { randomString, slugify } from "@server/lib/ids";
import { defaultPlan } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Create a team — Pylon" }, { name: "robots", content: "noindex" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = await getAuth(getDb(context), request);
  if (!auth) throw redirect("/login");
  if (auth.org) throw redirect("/app");
  return { name: auth.user.name };
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const auth = await getAuth(db, request);
  if (!auth) throw redirect("/login");
  const parsed = parseForm(await request.formData(), z.object({ orgName: z.string().trim().min(1).max(60) }));
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 400 });
  let slug = slugify(parsed.data.orgName);
  const clash = await db.select({ n: sql<number>`count(*)` }).from(organizations).where(eq(organizations.slug, slug)).get();
  if (clash && clash.n > 0) slug = `${slug}-${randomString(4)}`;
  await createOrgForUser(db, auth.user.id, parsed.data.orgName, slug, defaultPlan(getEnv(context)));
  return redirect("/app");
}

export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <AuthShell title={`Hi ${loaderData.name}`} subtitle="Create a team to hold your monitors and status pages.">
      <Form method="post" className="space-y-4">
        <Field label="Team / network name" name="orgName" error={actionData?.errors?.orgName}><Input name="orgName" required placeholder="Example Network" /></Field>
        <SubmitButton className="w-full">Continue</SubmitButton>
      </Form>
    </AuthShell>
  );
}
