import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/login";
import { AuthShell, DiscordButton } from "./_shell";
import { Field, Input, SubmitButton, Alert } from "~/components/ui";
import { getDb, getEnv, parseForm } from "~/lib/server";
import { createSession, getAuth, isSecure } from "@server/auth/session";
import { verifyPassword } from "@server/auth/password";
import { users } from "@server/db/schema";
import { clientIp, rateLimit } from "@server/lib/ratelimit";

export const meta: Route.MetaFunction = () => [{ title: "Sign in — Pylon" }, { name: "robots", content: "noindex" }];

function safeNext(v: string | null): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/app";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getAuth(getDb(context), request)) throw redirect("/app");
  const env = getEnv(context);
  return { discord: !!env.DISCORD_CLIENT_ID, signup: String(env.ALLOW_SIGNUP) !== "false", next: safeNext(new URL(request.url).searchParams.get("next")) };
}

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(1, "Enter your password"), next: z.string().optional() });

export async function action({ request, context }: Route.ActionArgs) {
  const db = getDb(context);
  const env = getEnv(context);
  const parsed = parseForm(await request.formData(), schema);
  if (!parsed.ok) return data({ errors: parsed.errors, values: parsed.values }, { status: 400 });
  if (!(await rateLimit(env, "AUTH_LIMITER", `login:${clientIp(request)}`))) return data({ errors: { _: "Too many attempts. Try again in a minute." }, values: parsed.values }, { status: 429 });
  const user = await db.select().from(users).where(eq(users.email, parsed.data.email)).get();
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return data({ errors: { _: "Incorrect email or password." }, values: parsed.values }, { status: 400 });
  }
  const session = await createSession(db, user.id, request.headers.get("user-agent"));
  return redirect(safeNext(parsed.data.next ?? null), { headers: { "Set-Cookie": session.cookie(isSecure(env.APP_URL)) } });
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const errors: Record<string, string> = actionData?.errors ?? {};
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your dashboard." footer={loaderData.signup ? <>New here? <Link to="/register" className="text-fg underline underline-offset-2">Create an account</Link></> : undefined}>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="next" value={loaderData.next} />
        {errors._ && <Alert tone="down">{errors._}</Alert>}
        <Field label="Email" name="email" error={errors.email}><Input name="email" type="email" autoComplete="email" required defaultValue={actionData?.values?.email} /></Field>
        <Field label="Password" name="password" error={errors.password}><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </Form>
      {loaderData.discord && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-fg-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <DiscordButton next={loaderData.next} />
        </>
      )}
    </AuthShell>
  );
}
