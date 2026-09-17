import { connect } from "cloudflare:sockets";
import { StreamReader } from "./bytes";
import { withTimeout } from "./time";

export interface OpenedSocket {
  socket: Socket;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  reader: StreamReader;
  close: () => void;
}

/** Opens a TCP connection from the edge with a hard timeout on the connect phase. */
export async function openTcp(host: string, port: number, timeoutMs: number): Promise<OpenedSocket> {
  const socket = connect({ hostname: host, port });
  const close = () => { try { socket.close(); } catch { /* already closed */ } };
  await withTimeout(socket.opened, timeoutMs, close);
  const writer = socket.writable.getWriter();
  const reader = new StreamReader(socket.readable.getReader());
  return { socket, writer, reader, close };
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

export function isIp(host: string): boolean {
  return IPV4.test(host) || (host.includes(":") && IPV6.test(host));
}

interface DohAnswer { name: string; type: number; TTL: number; data: string }
interface DohResponse { Status: number; Answer?: DohAnswer[] }

/** DNS over HTTPS via Cloudflare 1.1.1.1. */
export async function resolveDns(name: string, type: string, signal?: AbortSignal): Promise<DohAnswer[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" }, signal });
  if (!res.ok) throw new Error(`DoH request failed with HTTP ${res.status}`);
  const json = (await res.json()) as DohResponse;
  return json.Answer ?? [];
}

/** Resolve a hostname to an IPv4 address (pass-through if already an IP). */
export async function resolveIpv4(host: string, signal?: AbortSignal): Promise<string> {
  if (isIp(host)) return host;
  const answers = await resolveDns(host, "A", signal);
  const a = answers.find((x) => x.type === 1);
  if (!a) throw new Error(`Could not resolve ${host}`);
  return a.data;
}

/** Minecraft-style SRV lookup: _minecraft._tcp.host -> { target, port } */
export async function resolveSrv(service: string, host: string, signal?: AbortSignal): Promise<{ target: string; port: number } | null> {
  if (isIp(host)) return null;
  try {
    const answers = await resolveDns(`${service}.${host}`, "SRV", signal);
    const srv = answers.find((x) => x.type === 33);
    if (!srv) return null;
    // "priority weight port target."
    const parts = srv.data.trim().split(/\s+/);
    if (parts.length < 4) return null;
    return { target: parts[3]!.replace(/\.$/, ""), port: Number(parts[2]) };
  } catch {
    return null;
  }
}

/** Reject hosts that would let a tenant probe the platform's own internals. */
export function assertPublicHost(host: string): void {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    throw new Error("Host is not allowed");
  }
  if (IPV4.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 127 || a === 0 || a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      throw new Error("Private/loopback addresses are not allowed from the edge. Use a relay for LAN hosts.");
    }
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    throw new Error("Private/loopback addresses are not allowed from the edge. Use a relay for LAN hosts.");
  }
}
