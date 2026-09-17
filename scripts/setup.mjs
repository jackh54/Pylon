#!/usr/bin/env node
/**
 * Pylon self-hosting setup.
 *
 * Provisions the Cloudflare resources Pylon needs, for either Workers plan, and wires wrangler.jsonc:
 *   Paid  → D1 + R2 + Queue (retried alert delivery) + strong password hashing
 *   Free  → D1 + R2, alerts sent inline, PBKDF2 at the Free-plan cap
 *
 *   pnpm setup                                   # interactive
 *   pnpm setup --plan free --url https://status.example.gg --yes
 *   pnpm setup --dry-run                         # print what would happen
 *   pnpm setup --hosted                          # keep plan limits + pricing on (you are running it as a service)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : undefined; };
const DRY = !!flag("dry-run");
const YES = !!flag("yes");
const CONFIG = "wrangler.jsonc";

const c = { bold: (s) => `\x1b[1m${s}\x1b[22m`, dim: (s) => `\x1b[2m${s}\x1b[22m`, green: (s) => `\x1b[32m${s}\x1b[39m`, yellow: (s) => `\x1b[33m${s}\x1b[39m`, red: (s) => `\x1b[31m${s}\x1b[39m` };
const log = (...a) => console.log(...a);
const step = (s) => log(`\n${c.bold("▸ " + s)}`);

function wrangler(args, { capture = false, input, allowFail = false } = {}) {
  log(c.dim(`  $ wrangler ${args.join(" ")}`));
  if (DRY) return { ok: true, out: "" };
  const r = spawnSync("npx", ["wrangler", ...args], { stdio: capture ? ["pipe", "pipe", "pipe"] : [input ? "pipe" : "inherit", "inherit", "inherit"], input, encoding: "utf8", shell: process.platform === "win32" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  if (r.status !== 0 && !allowFail) {
    if (capture) log(out);
    throw new Error(`wrangler ${args[0]} ${args[1] ?? ""} failed (exit ${r.status})`);
  }
  return { ok: r.status === 0, out };
}

async function main() {
  log(c.bold("\nPylon setup") + c.dim(" — status pages for game servers, on your Cloudflare account\n"));
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const ask = async (q, def) => { if (YES) return def; const a = (await rl.question(`${q}${def !== undefined ? c.dim(` (${def})`) : ""}: `)).trim(); return a || def; };

  // --- 1. plan
  let plan = typeof flag("plan") === "string" ? flag("plan") : undefined;
  if (!plan) {
    log("Which Cloudflare Workers plan is this account on?");
    log(`  ${c.bold("paid")}  $5/mo — Queues for retried alerts, 50M D1 writes/mo (~1,000 monitors), 30 s CPU`);
    log(`  ${c.bold("free")}  $0    — no Queues (alerts sent inline), 100k D1 writes/day (~60 monitors)`);
    plan = await ask("Plan [paid/free]", "paid");
  }
  plan = plan.toLowerCase() === "free" ? "free" : "paid";

  // --- 2. names + url
  const name = typeof flag("name") === "string" ? flag("name") : await ask("Worker name", "pylon");
  const url = typeof flag("url") === "string" ? flag("url") : await ask("Public URL (e.g. https://status.example.gg; leave empty to set after the first deploy)", "");
  const admin = typeof flag("admin") === "string" ? flag("admin") : await ask("Your email, for the instance admin page (optional)", "");
  const hosted = !!flag("hosted");
  const dbName = name, bucket = `${name}-uploads`, queue = `${name}-notify`;
  rl.close();

  log(`\n  mode: ${c.bold(hosted ? "hosted (plan limits on)" : "self-hosted (no limits)")}   plan: ${c.bold(plan)}   worker: ${c.bold(name)}   d1: ${dbName}   r2: ${bucket}${plan === "paid" ? `   queue: ${queue}` : ""}${url ? `   url: ${url}` : ""}`);

  // --- 3. auth
  step("Checking Wrangler login");
  const who = wrangler(["whoami"], { capture: true, allowFail: true });
  if (!DRY && !/logged in/i.test(who.out)) { log(c.red("  Not logged in. Run `npx wrangler login` and try again.")); process.exit(1); }
  log(c.green("  ok"));

  // --- 4. D1
  step(`D1 database "${dbName}"`);
  let databaseId = "00000000-0000-0000-0000-000000000000";
  const list = wrangler(["d1", "list", "--json"], { capture: true, allowFail: true });
  let existing = null;
  try { existing = JSON.parse(list.out || "[]").find((d) => d.name === dbName); } catch { /* not json */ }
  if (existing) { databaseId = existing.uuid; log(c.green(`  exists (${databaseId})`)); }
  else {
    wrangler(["d1", "create", dbName]);
    const again = wrangler(["d1", "list", "--json"], { capture: true });
    if (!DRY) databaseId = JSON.parse(again.out).find((d) => d.name === dbName).uuid;
    log(c.green(`  created (${databaseId})`));
  }

  // --- 5. R2
  step(`R2 bucket "${bucket}"`);
  const r2 = wrangler(["r2", "bucket", "create", bucket], { capture: true, allowFail: true });
  log(r2.ok || /already exists/i.test(r2.out) ? c.green("  ok") : c.yellow(`  ${r2.out.trim().split("\n").pop()}`));

  // --- 6. Queue (paid only)
  if (plan === "paid") {
    step(`Queue "${queue}"`);
    const q = wrangler(["queues", "create", queue], { capture: true, allowFail: true });
    if (!q.ok && !/already exists/i.test(q.out)) {
      log(c.yellow("  Could not create the queue. If this account is actually on the Free plan, re-run with --plan free."));
      log(c.dim(q.out.trim().split("\n").slice(-2).join("\n")));
      process.exit(1);
    }
    log(c.green("  ok"));
  }

  // --- 7. wrangler.jsonc
  step(`Writing ${CONFIG}`);
  let cfg = readFileSync(CONFIG, "utf8");
  cfg = cfg.replace(/"name": "[^"]*"/, `"name": "${name}"`)
    .replace(/"database_name": "[^"]*"/, `"database_name": "${dbName}"`)
    .replace(/"database_id": "[^"]*"/, `"database_id": "${databaseId}"`)
    .replace(/"bucket_name": "[^"]*"/, `"bucket_name": "${bucket}"`)
    .replace(/"PBKDF2_ITERATIONS": "[^"]*"/, '"PBKDF2_ITERATIONS": "600000"')
    .replace(/"INSTANCE_MODE": "[^"]*"/, `"INSTANCE_MODE": "${hosted ? "hosted" : "self-hosted"}"`)
    .replace(/"ADMIN_EMAILS": "[^"]*"/, `"ADMIN_EMAILS": "${admin}"`);
  if (url) cfg = cfg.replace(/"APP_URL": "[^"]*"/, `"APP_URL": "${url.replace(/\/$/, "")}"`);
  const block = /[ \t]*\/\/ BEGIN paid-only[\s\S]*?\/\/ END paid-only\n?/;
  if (plan === "free") cfg = cfg.replace(block, "");
  else if (block.test(cfg)) cfg = cfg.replace(/"queue": "[^"]*"/g, `"queue": "${queue}"`);
  else cfg = cfg.replace(/(\n\s*"d1_databases":)/, `\n  // BEGIN paid-only — Cloudflare Queues need Workers Paid. \`pnpm setup --plan free\` removes this block; alerts are then sent inline.\n  "queues": {\n    "producers": [{ "binding": "NOTIFY_QUEUE", "queue": "${queue}" }],\n    "consumers": [{ "queue": "${queue}", "max_batch_size": 10, "max_batch_timeout": 5, "max_retries": 5, "retry_delay": 30 }]\n  },\n  // END paid-only$1`);
  if (DRY) { log(c.dim("  (dry run) resulting config:\n")); log(cfg.split("\n").map((l) => "    " + l).join("\n")); }
  else { writeFileSync(CONFIG, cfg); log(c.green("  ok")); }

  // --- 8. migrations
  step("Applying D1 migrations (remote)");
  wrangler(["d1", "migrations", "apply", dbName, "--remote"]);

  // --- 9. deploy
  step("Deploy");
  const deploy = YES ? "y" : (await readline.createInterface({ input: stdin, output: stdout }).question("Build and deploy now? [Y/n]: ")).trim().toLowerCase();
  if (deploy === "" || deploy === "y" || deploy === "yes") {
    log(c.dim("  $ pnpm build"));
    if (!DRY) { const b = spawnSync("pnpm", ["build"], { stdio: "inherit", shell: process.platform === "win32" }); if (b.status !== 0) throw new Error("build failed"); }
    wrangler(["deploy"]);
    step("Secrets");
    wrangler(["secret", "put", "SESSION_SECRET"], { input: randomBytes(32).toString("hex") + "\n" });
    log(c.green("  SESSION_SECRET set"));
  } else {
    log(c.yellow("  Skipped. When ready: pnpm deploy && npx wrangler secret put SESSION_SECRET"));
  }

  // --- 10. next steps
  log(`\n${c.bold("Done.")} Next:`);
  log(`  1. Open your Worker URL${url ? ` (${url})` : ""} and register the first account.`);
  if (!url) log(`  2. Put the URL Wrangler printed into "APP_URL" in ${CONFIG} and run \`pnpm deploy\` again.`);
  log(`  ${url ? 2 : 3}. Optional secrets: npx wrangler secret put STEAM_API_KEY | RESEND_API_KEY | EMAIL_FROM | DISCORD_CLIENT_ID | DISCORD_CLIENT_SECRET`);
  log(`  ${url ? 3 : 4}. Invite-only instance: set "ALLOW_SIGNUP": "false" in ${CONFIG} and redeploy.`);
  if (plan === "free") log(`  ${url ? 4 : 5}. Upgrading to Workers Paid later? Run \`pnpm setup --plan paid\` to add the alert queue.`);
  log("");
}

main().catch((e) => { console.error(c.red(`\n✗ ${e.message}`)); process.exit(1); });
