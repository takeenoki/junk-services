import { advance, PARAMETERS, type Surface } from "../../../public/minamo/physics.js";

export class Minamo {
  private state: DurableObjectState;
  private surface: Surface = { leaves: [], ripples: [] };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState) {
    this.state = state;
    state.blockConcurrencyWhile(async () => {
      this.surface = await state.storage.get<Surface>("surface") ?? this.surface;
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private broadcast(event: object, sender?: WebSocket) {
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(JSON.stringify({ ...event, own: socket === sender })); }
      catch { socket.close(1011, "送信に失敗しました"); }
    }
  }

  private async update(now: number) {
    const previous = this.surface.leaves.map(leaf => leaf.id);
    advance(this.surface, now);
    await this.state.storage.put("surface", this.surface);
    for (const id of previous) {
      if (!this.surface.leaves.some(leaf => leaf.id === id)) {
        this.broadcast({ type: "leaf_remove", id, time: now });
      }
    }
    this.broadcast({ type: "state_update", ...this.surface, time: now });
  }

  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const now = Date.now();
      await this.update(now);
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "init", ...this.surface, time: now }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.serial(async () => {
      const error = (text: string) => socket.send(JSON.stringify({ type: "error", message: text }));
      let event;
      try {
        if (typeof message !== "string" || message.length > 1024) throw new Error();
        event = JSON.parse(message);
      } catch { error("不正な操作です。"); return; }
      if (!event || !["stone", "leaf"].includes(event.type) ||
        !Number.isFinite(event.x) || !Number.isFinite(event.y) ||
        event.x < 0 || event.y < 0 || event.x > PARAMETERS.worldSize || event.y > PARAMETERS.worldSize) {
        error("不正な座標または操作です。"); return;
      }
      const now = Date.now();
      const cooldowns = socket.deserializeAttachment() ?? {};
      const interval = event.type === "stone" ? PARAMETERS.stoneCooldown : PARAMETERS.leafCooldown;
      if (now - (cooldowns[event.type] ?? -Infinity) < interval) {
        error("ゲージの回復をお待ちください。"); return;
      }
      await this.update(now);
      if (event.type === "stone") {
        const ripple = { id: crypto.randomUUID(), x: event.x, y: event.y, createdAt: now, hit: [] };
        this.surface.ripples.push(ripple);
        await this.state.storage.put("surface", this.surface);
        this.broadcast({ type: "stone", ripple, time: now }, socket);
      } else {
        if (this.surface.leaves.length >= PARAMETERS.maxLeaves) {
          const oldest = this.surface.leaves.shift()!;
          this.broadcast({ type: "leaf_remove", id: oldest.id, time: now });
        }
        const leaf = { id: crypto.randomUUID(), x: event.x, y: event.y,
          vx: PARAMETERS.flowSpeed, vy: 0, createdAt: now, updatedAt: now };
        // Waves that already passed this point cannot push a newly placed leaf.
        for (const ripple of this.surface.ripples) {
          if (Math.hypot(leaf.x - ripple.x, leaf.y - ripple.y) <=
            PARAMETERS.rippleSpeed * (now - ripple.createdAt) / 1000) {
            ripple.hit.push(leaf.id);
          }
        }
        this.surface.leaves.push(leaf);
        await this.state.storage.put("surface", this.surface);
        this.broadcast({ type: "leaf", leaf, ripples: this.surface.ripples, time: now }, socket);
      }
      cooldowns[event.type] = now;
      socket.serializeAttachment(cooldowns);
    });
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, "接続に失敗しました");
  }
}
