#!/usr/bin/env node
/**
 * Pylon relay — pulls monitor assignments from a Pylon instance, runs the checks locally
 * (UDP included, via GameDig), and pushes results back. No inbound ports required.
 *
 *   PYLON_URL=https://status.example.gg PYLON_TOKEN=prl_... node index.js
 *   node index.js --url https://status.example.gg --token prl_...
 */
import { GameDig } from "gamedig";
import net from "node:net";
import dns from "node:dns/promises";

const VERSION = "0.1.0";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1]] : []).filter((x) => x.length));
const URL_BASE = (args.url ?? process.env.PYLON_URL ?? "").replace(/\/$/, "");
const TOKEN = args.token ?? process.env.PYLON_TOKEN ?? "";
if (!URL_BASE || !TOKEN) {
  console.error("Usage: node index.js --url https://<your-pylon> --token prl_...  (or PYLON_URL / PYLON_TOKEN env vars)");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const timers = new Map();  // monitorId -> { cfg, timer }
let queue = [];

const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-pylon-relay-version": VERSION, "user-agent": `pylon-relay/${VERSION}` };

/* ------------------------------------------------------------------ probes */
const GAMEDIG_TYPES = { "minecraft-java": "minecraft", "minecraft-bedrock": "minecraftbedrock", source: "protocol-valve", fivem: "fivem" };

async function viaGamedig(type, cfg, timeoutMs) {
  const started = Date.now();
  // GameDig's "minecraft" tries the UDP query before the TCP ping; keep the socket timeout short so a
  // server without UDP query still resolves within the monitor's timeout budget.
  const socketTimeout = type === "minecraft" ? Math.min(timeoutMs, 4000) : timeoutMs;
  const state = await GameDig.query({ type, host: cfg.host, port: cfg.port ? Number(cfg.port) : undefined, socketTimeout, attemptTimeout: timeoutMs + 2000, maxRetries: 1, givenPortOnly: !!cfg.port });
  const players = state.numplayers ?? state.players?.length ?? 0;
  const maxPlayers = state.maxplayers ?? 0;
  const data = { players, maxPlayers, name: state.name, map: state.map, version: state.version ?? state.raw?.version, ping: state.ping, sample: (state.players ?? []).slice(0, 20).map((p) => p.name).filter(Boolean) };
  if (type === "minecraft") data.motd = String(state.raw?.description?.text ?? state.name ?? "").replace(/§./g, "").slice(0, 200);
  if (typeof cfg.minPlayers === "number" && players < cfg.minPlayers) return { ok: false, latencyMs: state.ping ?? Date.now() - started, error: `Only ${players} players online (minimum ${cfg.minPlayers})`, data };
  return { ok: true, latencyMs: state.ping ?? Date.now() - started, message: `${players}/${maxPlayers} players${state.map ? ` · ${state.map}` : ""}${data.version ? ` · ${data.version}` : ""}`, data };
}

function statusMatches(status, spec = "2xx") {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).some((s) => {
    if (/^\dxx$/i.test(s)) return Math.floor(status / 100) === Number(s[0]);
    const r = s.match(/^(\d{3})-(\d{3})$/);
    return r ? status >= +r[1] && status <= +r[2] : Number(s) === status;
  });
}

async function viaHttp(cfg, timeoutMs) {
  const started = Date.now();
  const hdrs = {};
  for (const line of (cfg.headers ?? "").split(/\r?\n/)) { const i = line.indexOf(":"); if (i > 0) hdrs[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const res = await fetch(cfg.url, { method: cfg.method ?? "GET", headers: { "user-agent": `pylon-relay/${VERSION}`, ...hdrs }, body: cfg.method === "POST" ? cfg.body : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = cfg.method === "HEAD" ? "" : await res.text();
  const latencyMs = Date.now() - started;
  const data = { status: res.status, size: text.length };
  if (!statusMatches(res.status, cfg.expectedStatus)) return { ok: false, latencyMs, error: `Unexpected HTTP ${res.status}`, data };
  if (cfg.keyword && !text.includes(cfg.keyword)) return { ok: false, latencyMs, error: `Keyword "${cfg.keyword}" not found`, data };
  if (cfg.notKeyword && text.includes(cfg.notKeyword)) return { ok: false, latencyMs, error: `Forbidden keyword found`, data };
  return { ok: true, latencyMs, message: `HTTP ${res.status}`, data };
}

function viaTcp(cfg, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const s = net.connect({ host: cfg.host, port: Number(cfg.port) });
    const done = (r) => { try { s.destroy(); } catch {} resolve(r); };
    s.setTimeout(timeoutMs, () => done({ ok: false, error: "Timed out", latencyMs: Date.now() - started }));
    s.once("connect", () => done({ ok: true, latencyMs: Date.now() - started, message: `Port ${cfg.port} open` }));
    s.once("error", (e) => done({ ok: false, error: e.message, latencyMs: Date.now() - started }));
  });
}

async function viaDns(cfg) {
  const started = Date.now();
  const type = cfg.recordType ?? "A";
  const raw = await dns.resolve(cfg.hostname, type);
  const values = raw.map((r) => (typeof r === "string" ? r : Array.isArray(r) ? r.join("") : `${r.priority ?? ""} ${r.weight ?? ""} ${r.port ?? ""} ${r.name ?? r.exchange ?? ""}`.trim()));
  const latencyMs = Date.now() - started;
  if (!values.length) return { ok: false, latencyMs, error: `No ${type} record` };
  if (cfg.expected && !values.some((v) => v.includes(cfg.expected))) return { ok: false, latencyMs, error: `No record contains "${cfg.expected}"`, data: { records: values.join(", ") } };
  return { ok: true, latencyMs, message: values[0], data: { records: values.join(", ") } };
}

async function runCheck(m) {
  const t = m.timeoutMs ?? 10000;
  try {
    switch (m.type) {
      case "gamedig": return await viaGamedig(m.config.game, m.config, t);
      case "minecraft-java": case "minecraft-bedrock": case "source": case "fivem": return await viaGamedig(GAMEDIG_TYPES[m.type], m.config, t);
      case "http": return await viaHttp(m.config, t);
      case "tcp": return await viaTcp(m.config, t);
      case "dns": return await viaDns(m.config);
      default: return { ok: false, error: `Type "${m.type}" is not supported on relays` };
    }
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/* ---------------------------------------------------------------- scheduler */
function schedule(m) {
  const existing = timers.get(m.id);
  if (existing && JSON.stringify(existing.cfg) === JSON.stringify(m)) return;
  if (existing) clearInterval(existing.timer);
  const run = async () => {
    const r = await runCheck(m);
    queue.push({ monitorId: m.id, ...r, checkedAt: Date.now() });
    log(`${r.ok ? "✓" : "✗"} ${m.name}${r.latencyMs !== undefined ? ` ${r.latencyMs}ms` : ""} ${r.ok ? r.message ?? "" : r.error ?? ""}`);
  };
  const timer = setInterval(run, Math.max(10, m.intervalSec) * 1000);
  timers.set(m.id, { cfg: m, timer });
  setTimeout(run, Math.floor(Math.random() * 2000));
}

async function sync() {
  try {
    const res = await fetch(`${URL_BASE}/api/relay/config`, { headers });
    if (!res.ok) { log(`config fetch failed: HTTP ${res.status}`); return; }
    const cfg = await res.json();
    const seen = new Set();
    for (const m of cfg.monitors) { seen.add(m.id); schedule(m); }
    for (const [id, t] of timers) if (!seen.has(id)) { clearInterval(t.timer); timers.delete(id); }
    log(`relay "${cfg.relay.name}" (${cfg.relay.region}) — ${cfg.monitors.length} monitors`);
  } catch (e) {
    log("sync error:", e?.message ?? e);
  }
}

async function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, 200);
  try {
    const res = await fetch(`${URL_BASE}/api/relay/results`, { method: "POST", headers, body: JSON.stringify({ results: batch }) });
    if (!res.ok) { log(`results push failed: HTTP ${res.status}`); queue.unshift(...batch); }
  } catch (e) {
    log("push error:", e?.message ?? e); queue.unshift(...batch.slice(0, 100));
  }
}

log(`pylon-relay v${VERSION} → ${URL_BASE}`);
await sync();
setInterval(sync, 60_000);
setInterval(flush, 3_000);
process.on("SIGTERM", () => { flush().finally(() => process.exit(0)); });
