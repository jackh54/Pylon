/** Small binary helpers for game protocols (Minecraft VarInts, Source RCON frames). */

export function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function writeVarInt(value: number): Uint8Array {
  const out: number[] = [];
  let v = value >>> 0;
  for (;;) {
    if ((v & ~0x7f) === 0) { out.push(v); break; }
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Uint8Array.from(out);
}

export function encodeString(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  return concat(writeVarInt(b.length), b);
}

export function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >> 8) & 0xff, n & 0xff);
}

export function i32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

export function i64be(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, false);
  return b;
}

/** Minecraft packet framing: VarInt length prefix + payload. */
export function mcPacket(...parts: Uint8Array[]): Uint8Array {
  const payload = concat(...parts);
  return concat(writeVarInt(payload.length), payload);
}

/** Buffered reader over a ReadableStream of bytes with exact-size reads. */
export class StreamReader {
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private done = false;
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  private available() { return this.buf.length - this.pos; }

  private async fill(n: number): Promise<void> {
    while (this.available() < n) {
      if (this.done) throw new Error("Connection closed before enough data was received");
      const { value, done } = await this.reader.read();
      if (done) { this.done = true; continue; }
      if (!value) continue;
      if (this.pos > 0) { this.buf = this.buf.subarray(this.pos); this.pos = 0; }
      this.buf = concat(this.buf, value);
    }
  }

  async readBytes(n: number): Promise<Uint8Array> {
    await this.fill(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  async readByte(): Promise<number> {
    return (await this.readBytes(1))[0]!;
  }

  async readVarInt(): Promise<number> {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = await this.readByte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error("VarInt too big");
    }
    return result;
  }

  async readInt32LE(): Promise<number> {
    const b = await this.readBytes(4);
    return new DataView(b.buffer, b.byteOffset, 4).getInt32(0, true);
  }

  async readInt64BE(): Promise<bigint> {
    const b = await this.readBytes(8);
    return new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, false);
  }
}
