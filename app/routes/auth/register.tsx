import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { Route } from "./+types/register";
import { AuthShell, DiscordButton } from "./_shell";
import { Field, Input, SubmitButton, Alert } from "~/components/ui";
import { getDb, getEnv, parseForm } from "~/lib/server";
import { createOrgForUser, createSession, getAuth, isSecure } from "@server/auth/session";
import { hashPassword, pbkdf2Iterations } from "@server/auth/password";
import { organizations, users } from "@server/db/schema";
import { newId, randomString, slugify } from "@server/lib/ids";
import { clientIp, rateLimit } from "@server/lib/ratelimit";
import { defaultPlan } from "@server/plans";

export const meta: Route.MetaFunction = () => [{ title: "Create account — Pylon" }, { name: "robots", content: "noindex" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getAuth(getDb(context), request)) throw redirect("/app");
  const env = getEnv(context);
  const next = new URL(request.url).searchParams.get("next") ?? "";
  return { discord: !!env.DISCORD_CLIENT_ID, signup: String(env.ALLOW_SIGNUP) !== "false", next: next.startsWith("/") ? next : "" };
}

const schema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  orgName: z.string().trim().min(1, "Name your team or network").max(60),
  next: z.string().optional(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const env = getEnv(context);
  if (String(env.ALLOW_SIGNUP) === "false") return data({ errors: { _: "Sign-ups are disabled on this instance." }, values: {} }, { status: 403 });
  const db = getDb(context);
  const parsed = parseForm(await request.formData(), schema);
  if (!parsed.ok) return data({ errors: parsed.errors, values: parsed.values }, { status: 400 });
  if (!(await rateLimit(env, "AUTH_LIMITER", `register:${clientIp(request)}`))) return data({ errors: { _: "Too many attempts. Try again in a minute." }, values: parsed.values }, { status: 429 });
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).get();
  if (exists) return data({ errors: { email: "An account with this email already exists." }, values: parsed.values }, { status: 400 });
  const userId = newId("usr");
  await db.insert(users).values({ id: userId, email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password, pbkdf2Iterations(env)) });
  let slug = slugify(parsed.data.orgName);
  const clash = await db.select({ n: sql<number>`count(*)` }).from(organizations).where(eq(organizations.slug, slug)).get();
  if (clash && clash.n > 0) slug = `${slug}-${randomString(4)}`;
  await createOrgForUser(db, userId, parsed.data.orgName, slug, defaultPlan(env));
  const session = await createSession(db, userId, request.headers.get("user-agent"));
  const next = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/app";
  return redirect(next, { headers: { "Set-Cookie": session.cookie(isSecure(env.APP_URL)) } });
}

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values: Record<string, string> = actionData?.values ?? {};
  if (!loaderData.signup) {
    return <AuthShell title="Sign-ups are closed" subtitle="This Pylon instance is invite-only. Ask an admin for an invite link." footer={<Link to="/login" className="underline underline-offset-2">Sign in</Link>}><div /></AuthShell>;
  }
  return (
    <AuthShell title="Create your account" subtitle="Free for communities. No credit card." footer={<>Already have an account? <Link to="/login" className="text-fg underline underline-offset-2">Sign in</Link></>}>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="next" value={loaderData.next} />
        {errors._ && <Alert tone="down">{errors._}</Alert>}
        <Field label="Your name" name="name" error={errors.name}><Input name="name" autoComplete="name" required defaultValue={values.name} /></Field>
        <Field label="Email" name="email" error={errors.email}><Input name="email" type="email" autoComplete="email" required defaultValue={values.email} /></Field>
        <Field label="Password" name="password" error={errors.password}><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <Field label="Team / network name" name="orgName" error={errors.orgName} help="Shown on your dashboard. You can add teammates later."><Input name="orgName" placeholder="Example Network" required defaultValue={values.orgName} /></Field>
        <SubmitButton className="w-full" pendingText="Creating…">Create account</SubmitButton>
      </Form>
      {loaderData.discord && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-fg-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <DiscordButton next={loaderData.next || undefined} />
        </>
      )}
    </AuthShell>
  );
}
