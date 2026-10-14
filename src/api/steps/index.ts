import { authorize, AuthError } from "./auth.ts";
import type { StepsAuthEnv } from "./auth.ts";

interface Env extends StepsAuthEnv { DB: D1Database }
interface StepRow {
  local_date: string;
  steps: number;
  timezone: string;
  recorded_at: string;
  updated_at: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

interface InputError {
  field: string;
  code: string;
  message: string;
}

function problem(request: Request, status: number, code: string, errors?: InputError[]): Response {
  const titles: Record<string, string> = {
    VALIDATION_ERROR: "入力内容が不正です",
    AUTH_INVALID: "認証トークンが無効です",
    FORBIDDEN: "更新する権限がありません",
    DAILY_STEPS_NOT_FOUND: "指定日の歩数がありません",
    DAILY_STEPS_VERSION_CONFLICT: "日次歩数の更新が競合しました",
    SERVICE_UNAVAILABLE: "一時的にサービスを利用できません",
    NOT_FOUND: "APIが見つかりません",
    METHOD_NOT_ALLOWED: "このメソッドは利用できません",
  };
  const traceId = crypto.randomUUID();
  // Only fixed diagnostics are logged; never include tokens, input values or exceptions.
  const log = JSON.stringify({ service: "steps", status, code, traceId, ...(errors ? { errors } : {}) });
  if (status >= 500) console.error(log);
  else console.warn(log);
  return json({
    type: `${new URL(request.url).origin}/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: titles[code], status, code,
    instance: new URL(request.url).pathname, traceId,
    ...(errors ? { errors } : {}),
  }, status, {
    "Content-Type": "application/problem+json",
    ...(status === 503 ? { "Retry-After": "30" } : {}),
    ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
  });
}

function invalid(request: Request, field: string, code: string, message: string): Response {
  return problem(request, 400, "VALIDATION_ERROR", [{ field, code, message }]);
}

export function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value.slice(0, 4) !== "0000"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /^[+-]/.test(value)) return false;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone === value;
  } catch { return false; }
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !validDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  if (match[6] !== "Z" && (+match[6].slice(1, 3) > 23 || +match[6].slice(4) > 59)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function serialize(row: StepRow) {
  return { date: row.local_date, steps: row.steps, timezone: row.timezone,
    recordedAt: row.recorded_at, updatedAt: row.updated_at };
}

export async function handleSteps(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const base = "/api/v1/daily-steps";
  const single = url.pathname.match(/^\/api\/v1\/daily-steps\/([^/]+)$/);
  if (url.pathname !== base && !single) return problem(request, 404, "NOT_FOUND");
  if (request.method !== "GET" && !(single && request.method === "PUT")) {
    const response = problem(request, 405, "METHOD_NOT_ALLOWED");
    response.headers.set("Allow", single ? "GET, PUT" : "GET");
    return response;
  }
  try {
    if (request.method === "PUT") await authorize(request, env);
    if (single) {
      const date = single[1];
      if (!validDate(date)) return invalid(request, "path.date", "INVALID_DATE", "実在する日付をYYYY-MM-DD形式で指定してください。");
      if (url.search) return invalid(request, "query", "UNEXPECTED_QUERY", "単一日のAPIにはクエリを指定できません。");
      if (request.method === "GET") {
        const row = await env.DB.prepare("SELECT * FROM steps WHERE local_date = ?").bind(date).first<StepRow>();
        return row ? json(serialize(row)) : problem(request, 404, "DAILY_STEPS_NOT_FOUND");
      }
      if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return invalid(request, "headers.content-type", "INVALID_CONTENT_TYPE", "Content-Typeにapplication/jsonを指定してください。");
      }
      let body;
      try { body = await request.json() as Record<string, unknown>; }
      catch { return invalid(request, "body", "INVALID_JSON", "本文を有効なJSONで送信してください。"); }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return invalid(request, "body", "INVALID_OBJECT", "本文はJSONオブジェクトで指定してください。");
      }
      const errors: InputError[] = [];
      if (!Object.keys(body).every(key => ["steps", "timezone", "recordedAt"].includes(key))) {
        errors.push({ field: "body", code: "UNEXPECTED_FIELDS", message: "steps、timezone、recordedAt以外の項目は指定できません。" });
      }
      if (!Number.isInteger(body.steps) || (body.steps as number) < 0 || (body.steps as number) > 1000000) {
        errors.push({ field: "body.steps", code: "INVALID_STEPS", message: "stepsは0〜1000000の整数で指定してください。" });
      }
      if (!validTimezone(body.timezone)) {
        errors.push({ field: "body.timezone", code: "INVALID_TIMEZONE", message: "timezoneはAsia/Tokyoなどのcanonical IANA名で指定してください。" });
      }
      const recordedAt = timestamp(body.recordedAt);
      if (!recordedAt) {
        errors.push({ field: "body.recordedAt", code: "INVALID_TIMESTAMP", message: "recordedAtはタイムゾーン付きの実在するISO 8601日時で指定してください。小数秒は最大3桁です。" });
      }
      if (errors.length) return problem(request, 400, "VALIDATION_ERROR", errors);
      const now = new Date().toISOString();
      // D1 batch is a transaction: creation, conditional update and read cannot interleave.
      const results = await env.DB.batch<StepRow>([
        env.DB.prepare(`INSERT INTO steps (local_date, steps, timezone, recorded_at, updated_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(local_date) DO NOTHING RETURNING *`)
          .bind(date, body.steps, body.timezone, recordedAt, now),
        env.DB.prepare(`UPDATE steps SET steps = ?, timezone = ?, recorded_at = ?, updated_at = ?
          WHERE local_date = ? AND recorded_at < ? RETURNING *`)
          .bind(body.steps, body.timezone, recordedAt, now, date, recordedAt),
        env.DB.prepare("SELECT * FROM steps WHERE local_date = ?").bind(date),
      ]);
      const row = results[2].results[0];
      if (!row) throw new Error("Missing step row");
      if (row.recorded_at !== recordedAt || row.steps !== body.steps || row.timezone !== body.timezone) {
        return problem(request, 409, "DAILY_STEPS_VERSION_CONFLICT");
      }
      return json(serialize(row), results[0].results.length ? 201 : 200, { Location: url.pathname });
    }
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const errors: InputError[] = [];
    if (!validDate(from) || url.searchParams.getAll("from").length !== 1) {
      errors.push({ field: "query.from", code: "INVALID_DATE", message: "fromに実在する日付をYYYY-MM-DD形式で1つ指定してください。" });
    }
    if (!validDate(to) || url.searchParams.getAll("to").length !== 1) {
      errors.push({ field: "query.to", code: "INVALID_DATE", message: "toに実在する日付をYYYY-MM-DD形式で1つ指定してください。" });
    }
    if ([...url.searchParams.keys()].some(key => !["from", "to"].includes(key))) {
      errors.push({ field: "query", code: "UNEXPECTED_QUERY", message: "クエリにはfromとtoのみ指定できます。" });
    }
    if (errors.length) return problem(request, 400, "VALIDATION_ERROR", errors);
    if (from! > to! || (Date.parse(to!) - Date.parse(from!)) / 86400000 >= 366) {
      return invalid(request, "query", "INVALID_RANGE", "fromからtoまでを日付順で、両端を含め最大366日にしてください。");
    }
    const result = await env.DB.prepare("SELECT * FROM steps WHERE local_date BETWEEN ? AND ? ORDER BY local_date")
      .bind(from, to).all<StepRow>();
    return json({ items: result.results.map(serialize) });
  } catch (error) {
    if (error instanceof AuthError) return problem(request, error.status, error.code);
    return problem(request, 503, "SERVICE_UNAVAILABLE");
  }
}
