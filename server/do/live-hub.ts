import { DurableObject } from "cloudflare:workers";

/**
 * One LiveHub per status page. Browsers connect over WebSocket (hibernation API, so idle
 * connections cost nothing) and monitor runners push updates through `broadcast()`.
 */
export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "hello", viewers: this.ctx.getWebSockets().length, at: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(message: Record<string, unknown>): Promise<number> {
    const payload = JSON.stringify(message);
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); n++; } catch { /* closed */ }
    }
    return n;
  }

  async viewers(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  override async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // clients only ping (auto-answered); nothing else to do
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try { ws.close(1011, "error"); } catch { /* ignore */ }
  }
}
