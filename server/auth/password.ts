import { base64url } from "../lib/ids";

/** Default stays within the Workers Free cap; the Paid plan config raises it via PBKDF2_ITERATIONS. */
const DEFAULT_ITERATIONS = 100_000;

export function pbkdf2Iterations(env: unknown): number {
  const raw = (env as { PBKDF2_ITERATIONS?: string | number }).PBKDF2_ITERATIONS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 10_000 && n <= 5_000_000 ? Math.floor(n) : DEFAULT_ITERATIONS;
}
const KEY_BYTES = 32;

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Workers caps a single PBKDF2 call at 100k iterations on every plan, while OWASP recommends 600k
 * for PBKDF2-SHA256. We reach the target by chaining 100k-iteration blocks, feeding each block's
 * output in as the next block's password. Cost scales exactly with the total iteration count, and a
 * count of 100000 or less is a single plain PBKDF2 call, so older hashes still verify.
 */
const MAX_PER_CALL = 100_000;

async function pbkdf2(secret: BufferSource, salt: Uint8Array, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  let remaining = Math.max(1, iterations);
  let block: BufferSource = new TextEncoder().encode(password);
  let out = new Uint8Array(KEY_BYTES);
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_PER_CALL);
    out = await pbkdf2(block, salt, step);
    block = out as BufferSource;
    remaining -= step;
  }
  return out;
}

export async function hashPassword(password: string, iterations: number = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const expected = fromBase64url(hashB64);
  const actual = await derive(password, fromBase64url(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
