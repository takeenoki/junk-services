interface Env {
  DB: D1Database;
  JEV_IMAGE_PLAYGROUND_API_KEY?: string;
  JEV_IMAGE_PLAYGROUND_MODEL?: string;
}

const ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/";
const LIMIT = 200;
const LIMIT_ERROR = "1日のリクエスト上限に達しました。また明日お試しください";
const MAX_BODY = 24 * 1024 * 1024;

export function japanDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function json(body: unknown, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("入力がありません。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error("画像が大きすぎます。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// The browser re-exports images as PNG. Check the actual PNG header on the server too.
function validateImage(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("画像データが不正です。");
  }
  const bytes = atob(value);
  if (bytes.length > 16 * 1024 * 1024) throw new Error("画像が大きすぎます。");
  if (bytes.length < 33 || bytes.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || bytes.slice(12, 16) !== "IHDR") {
    throw new Error("PNG画像を選択し直してください。");
  }
  const dimension = (offset: number) =>
    bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 +
    bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
  const width = dimension(16);
  const height = dimension(20);
  if (Math.min(width, height) < 280 || Math.max(width, height) > 1568) {
    throw new Error("画像の各辺は280〜1568pxにしてください。");
  }
  return value;
}

function buildPayload(input: unknown, model: string) {
  if (!input || typeof input !== "object") throw new Error("入力が不正です。");
  const { type, question, criteria, image } = input as Record<string, unknown>;
  if (!["noul", "choice", "score"].includes(String(type))) throw new Error("判定形式が不正です。");
  if (typeof question !== "string" || !question.trim() || question.length > 4000) {
    throw new Error("質問を4000文字以内で入力してください。");
  }
  const decision: Record<string, unknown> = { type, instructions: question.trim() };
  if (type !== "noul") {
    if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 255 ||
        criteria.some(item => typeof item !== "string" || !item.trim() || item.length > 1000)) {
      throw new Error("選択肢・クライテリアを2〜255行、各1000文字以内で入力してください。");
    }
    const entries = criteria.map(item => item.trim());
    if (new Set(entries).size !== entries.length) throw new Error("選択肢・クライテリアの重複を除いてください。");
    decision.criteria = type === "score" ? entries : Object.fromEntries(entries.map(item => [item, item]));
  }
  const reference = crypto.randomUUID();
  return {
    model,
    state: { image: reference },
    assets: { [reference]: { type: "image", format: "png", data_base64: validateImage(image) } },
    questions: { decision },
  };
}

export async function handleJevImagePlayground(request: Request, env: Env): Promise<Response> {
  const model = env.JEV_IMAGE_PLAYGROUND_MODEL || "jev-1.14.0";
  const date = japanDate();
  const info = (count: number) => ({ date, limit: LIMIT, remaining: LIMIT - count, endpoint: ENDPOINT, model });
  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "許可されていないメソッドです。" }, 405, { Allow: "GET, POST" });
  }
  try {
    if (request.method === "GET") {
      const row = await env.DB.prepare('SELECT count FROM "jev-image-playground-access-cnt" WHERE date = ?')
        .bind(date).first<{ count: number }>();
      return json(info(row?.count ?? 0));
    }
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "送信元が不正です。" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    let payload;
    try {
      payload = buildPayload(await readBody(request), model);
    } catch (error) {
      return json({ error: error instanceof SyntaxError ? "JSONが不正です。" : (error as Error).message }, 400);
    }
    if (!env.JEV_IMAGE_PLAYGROUND_API_KEY?.trim()) return json({ error: "認証キーが設定されていません。" }, 503);

    // A single atomic statement reserves a slot, even for concurrent requests.
    const row = await env.DB.prepare(`
      INSERT INTO "jev-image-playground-access-cnt" (date, count) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET count = count + 1 WHERE count < 200
      RETURNING count
    `).bind(date).first<{ count: number }>();
    if (!row) return json({ ...info(LIMIT), error: LIMIT_ERROR }, 429);

    const details = { ...info(row.count), request: payload };
    try {
      const upstream = await fetch(`${ENDPOINT}v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.JEV_IMAGE_PLAYGROUND_API_KEY}`,
          "Content-Type": "application/json",
          "TypeSafe-Danger-Zone-Images": "true",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
        redirect: "manual",
      });
      const text = await upstream.text();
      if (upstream.status !== 200) {
        console.error("Jevへのリクエストで200以外のレスポンスを受信しました。", {
          endpoint: `${ENDPOINT}v1/systemone`,
          model,
          status: upstream.status,
          statusText: upstream.statusText,
          response: text,
        });
      }
      let response: unknown;
      try { response = JSON.parse(text); } catch { response = text; }
      if (!upstream.ok) {
        return json({ ...details, response, upstreamStatus: upstream.status, error: "Jevへのリクエストに失敗しました。" }, 502);
      }
      const result = (response as { answers?: { decision?: unknown } } | null)?.answers?.decision;
      if (result === undefined) {
        console.error("Jevのレスポンス形式が不正です。", {
          status: upstream.status,
          response: text,
        });
        return json({ ...details, response, error: "Jevのレスポンス形式が不正です。" }, 502);
      }
      return json({ ...details, result, response });
    } catch (error) {
      console.error("Jevへの接続またはレスポンスの読み取りに失敗しました。", error);
      // Never retry or refund: failed submissions count toward the daily cap.
      return json({ ...details, error: "Jevに接続できませんでした。時間をおいてお試しください。" }, 502);
    }
  } catch {
    return json({ error: "リクエスト数を確認できませんでした。時間をおいてお試しください。" }, 500);
  }
}
