interface Env {
  BEEPERS: DurableObjectNamespace;
  ENABLE_POST_LIMIT?: string;
}

interface Sound {
  id: string;
  sequence: number;
  type: number;
  positionMs: number;
  durationMs: number;
  createdAtMs: number;
  status: "pending" | "finalized";
}

interface Track {
  epochMs: number;
  version: number;
  nextSequence: number;
  sounds: Sound[];
}

interface Receipt {
  id: string;
  token: string;
  browser: string;
  requestId: string;
  nextPostAtMs: number;
}

const HOUR = 3_600_000;
const COOKIE = "beepers_browser";

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function handleBeepers(request: Request, env: Env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "同じサイトから操作してください。" }, 403);
  if (url.pathname === "/api/beepers/log") {
    if (request.method !== "POST") return json({ error: "POSTを使用してください。" }, 405);
    let body: Record<string, unknown>;
    try {
      const text = await request.text();
      if (text.length > 2048) throw new Error();
      body = JSON.parse(text);
      if (!body || typeof body !== "object") throw new Error();
    } catch { return json({ error: "不正なリクエストです。" }, 400); }
    if ((body.operation !== "SAMPLE" && body.operation !== "PUT") ||
        !Number.isInteger(body.type) || Number(body.type) < 1 || Number(body.type) > 20) {
      return json({ error: "不正な操作またはボタン番号です。" }, 400);
    }
    console.info(`BEEPERS [INFO] ${body.operation} ${body.type}`);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  return env.BEEPERS.get(env.BEEPERS.idFromName("shared-track")).fetch(request);
}

export class Beepers {
  private track: Track = { epochMs: Date.now(), version: 0, nextSequence: 0, sounds: [] };
  private secret!: CryptoKey;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private state: DurableObjectState, private env: Env) {
    state.blockConcurrencyWhile(async () => {
      this.track = await state.storage.get<Track>("track") ?? this.track;
      let key = await state.storage.get<string>("cookie-key");
      if (!key) key = crypto.randomUUID() + crypto.randomUUID();
      this.secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      await state.storage.put({ track: this.track, "cookie-key": key });
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  private async sign(id: string) {
    const signature = await crypto.subtle.sign("HMAC", this.secret, new TextEncoder().encode(id));
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  private async browser(request: Request) {
    const value = request.headers.get("Cookie")?.split(";").map(part => part.trim())
      .find(part => part.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    if (value) {
      const [id, signature] = value.split(".");
      if (/^[\da-f-]{36}$/.test(id) && /^[\da-f]{64}$/.test(signature ?? "")) {
        const bytes = Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16));
        if (await crypto.subtle.verify("HMAC", this.secret, bytes, new TextEncoder().encode(id))) return id;
      }
    }
    return crypto.randomUUID();
  }

  private async cookie(id: string, request: Request) {
    return `${COOKIE}=${id}.${await this.sign(id)}; Path=/api/beepers; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  }

  private limited() { return this.env.ENABLE_POST_LIMIT !== "false"; }

  private snapshot() { return { type: "state", ...this.track, serverTimeMs: Date.now() }; }

  private broadcast() {
    const message = JSON.stringify(this.snapshot());
    for (const socket of this.state.getWebSockets()) {
      try { socket.send(message); } catch { socket.close(1011, "送信失敗"); }
    }
  }

  private async save() {
    const pending = this.track.sounds.filter(sound => sound.status === "pending");
    await this.state.storage.transaction(async storage => {
      await storage.put("track", this.track);
      if (pending.length) await storage.setAlarm(Math.min(...pending.map(sound => sound.createdAtMs + 3000)));
      else await storage.deleteAlarm();
    });
  }

  private async finalizeOverdue() {
    let changed = false;
    for (const sound of this.track.sounds) {
      if (sound.status === "pending" && Date.now() >= sound.createdAtMs + 3000) {
        sound.status = "finalized";
        sound.durationMs = 3000;
        changed = true;
      }
    }
    if (changed) {
      this.track.version++;
      await this.save();
      this.broadcast();
    }
  }

  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      await this.finalizeOverdue();
      const path = new URL(request.url).pathname;
      const browser = await this.browser(request);
      const headers = { "Set-Cookie": await this.cookie(browser, request) };
      const limitKey = `${this.limited() ? "limit" : "debug-limit"}:${browser}`;
      const nextPostAtMs = await this.state.storage.get<number>(limitKey) ?? 0;

      if (path === "/api/beepers/state" && request.method === "GET") {
        return json({ ...this.snapshot(), nextPostAtMs, postLimitEnabled: this.limited(),
          debugMode: !this.limited(), postIntervalMs: this.limited() ? HOUR : 5000 }, 200, headers);
      }
      if (path === "/api/beepers/ws" && request.method === "GET") {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket接続が必要です。" }, 426);
        const pair = new WebSocketPair();
        this.state.acceptWebSocket(pair[1]);
        pair[1].send(JSON.stringify({ ...this.snapshot(), nextPostAtMs }));
        return new Response(null, { status: 101, webSocket: pair[0], headers });
      }
      if (!["/api/beepers/start", "/api/beepers/finish", "/api/beepers/clear"].includes(path)) return json({ error: "APIが見つかりません。" }, 404);
      if (request.method !== "POST") return json({ error: "POSTを使用してください。" }, 405);
      if (path.endsWith("/clear")) {
        if (this.limited()) return json({ error: "デバッグ時のみ利用できます。" }, 403);
        this.track.sounds = [];
        this.track.version++;
        await this.save();
        this.broadcast();
        return json(this.snapshot(), 200, headers);
      }
      let body: Record<string, unknown>;
      try {
        const text = await request.text();
        if (text.length > 2048) throw new Error();
        body = JSON.parse(text);
        if (!body || typeof body !== "object") throw new Error();
      } catch { return json({ error: "不正なリクエストです。" }, 400); }

      if (path.endsWith("/start")) {
        if (typeof body.requestId !== "string" || !/^[\da-f-]{36}$/.test(body.requestId) ||
            !Number.isInteger(body.type) || Number(body.type) < 1 || Number(body.type) > 20 ||
            typeof body.pressedAtMs !== "number" || !Number.isFinite(body.pressedAtMs)) {
          return json({ error: "不正な音色または時刻です。" }, 400);
        }
        const receiptKey = `request:${browser}:${body.requestId}`;
        const previous = await this.state.storage.get<Receipt>(receiptKey);
        if (previous) return json({ ...this.snapshot(), id: previous.id, token: previous.token,
          nextPostAtMs: previous.nextPostAtMs }, 200, headers);
        if (Date.now() < nextPostAtMs) return json({ error: "次の投稿までお待ちください。", nextPostAtMs }, 429, headers);
        const now = Date.now();
        const pressedAtMs = Math.min(now, Math.max(now - 10_000, body.pressedAtMs));
        const sound: Sound = {
          id: crypto.randomUUID(), sequence: this.track.nextSequence++, type: Number(body.type),
          positionMs: ((pressedAtMs - this.track.epochMs) % 10_000 + 10_000) % 10_000,
          durationMs: 3000, createdAtMs: now, status: "pending",
        };
        const receipt: Receipt = { id: sound.id, token: crypto.randomUUID(), browser,
          requestId: body.requestId, nextPostAtMs: now + (this.limited() ? HOUR : 5000) };
        this.track.sounds.push(sound);
        this.track.sounds = this.track.sounds.slice(-100);
        this.track.version++;
        await this.state.storage.transaction(async storage => {
          await storage.put(receiptKey, receipt);
          await storage.put(`sound:${sound.id}`, receipt);
          await storage.put(limitKey, receipt.nextPostAtMs);
          await storage.put("track", this.track);
          await storage.setAlarm(Math.min(...this.track.sounds.filter(item => item.status === "pending").map(item => item.createdAtMs + 3000)));
        });
        this.broadcast();
        return json({ ...this.snapshot(), id: receipt.id, token: receipt.token,
          nextPostAtMs: receipt.nextPostAtMs }, 201, headers);
      }

      if (typeof body.id !== "string" || typeof body.token !== "string" ||
          typeof body.durationMs !== "number" || !Number.isFinite(body.durationMs)) {
        return json({ error: "不正な長さ更新です。" }, 400);
      }
      const receipt = await this.state.storage.get<Receipt>(`sound:${body.id}`);
      if (!receipt || receipt.token !== body.token || receipt.browser !== browser) return json({ error: "更新権限がありません。" }, 403);
      const sound = this.track.sounds.find(item => item.id === body.id);
      if (sound?.status === "pending") {
        sound.durationMs = Math.round(Math.min(3000, Math.max(50, body.durationMs)));
        sound.status = "finalized";
        this.track.version++;
        await this.save();
        this.broadcast();
      }
      return json(this.snapshot(), 200, headers);
    });
  }

  alarm() { return this.serial(async () => { await this.finalizeOverdue(); await this.save(); }); }

  webSocketClose(socket: WebSocket) { socket.close(1000, "接続終了"); }
  webSocketError(socket: WebSocket) { socket.close(1011, "接続失敗"); }
}
