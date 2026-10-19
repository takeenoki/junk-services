interface Env {
  DB: D1Database;
  JEV_IMAGE_PLAYGROUND_API_KEY?: string;
}

const ENDPOINT = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';
const MODEL = 'jev-1.14.0';
const INSTRUCTIONS = 'This is an image of a maze. Your current position is indicated by a red circle. Black cells are walls and cannot be traversed. The position marked G is the goal. Choose the best option to reach the goal.';
const CHOICES = ['Move one cell up', 'Move one cell left', 'Move one cell right', 'Move one cell down'];
const MAX_BODY = 2 * 1024 * 1024;
const LIMIT = 2000;
const LIMIT_ERROR = '1日のリクエスト上限に達しました。また明日お試しください';

export function japanDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function json(body: unknown, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readImage(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('画像がありません。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error('画像が大きすぎます。');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const input = JSON.parse(new TextDecoder().decode(bytes));
  const image: unknown = input?.image;
  if (typeof image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length % 4 !== 0) {
    throw new Error('PNG画像が不正です。');
  }
  const png = atob(image);
  const dimension = (offset: number) =>
    png.charCodeAt(offset) * 16777216 + png.charCodeAt(offset + 1) * 65536 +
    png.charCodeAt(offset + 2) * 256 + png.charCodeAt(offset + 3);
  if (png.length < 33 || png.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
      png.slice(12, 16) !== 'IHDR' || dimension(16) !== 720 || dimension(20) !== 720) {
    throw new Error('720×720pxのPNG画像を送信してください。');
  }
  return image;
}

export async function handleJevMazeDemo(request: Request, env: Env): Promise<Response> {
  try {
    return await handleRequest(request, env);
  } catch {
    return json({ error: 'リクエスト数を確認できませんでした。時間をおいてお試しください。' }, 500);
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method)) {
    return json({ error: '許可されていないメソッドです。' }, 405, { Allow: 'GET, POST' });
  }
  const date = japanDate();
  const info = (count: number) => ({ date, limit: LIMIT, remaining: LIMIT - count });
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT count FROM jev_maze_access_cnt WHERE date = ?')
      .bind(date).first<{ count: number }>();
    return json(info(row?.count ?? 0));
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '送信元が不正です。' }, 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return json({ error: 'JSON形式で送信してください。' }, 415);
  }
  let image: string;
  try { image = await readImage(request); } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'JSONが不正です。' : (error as Error).message }, 400);
  }
  if (!env.JEV_IMAGE_PLAYGROUND_API_KEY?.trim()) return json({ error: '認証キーが設定されていません。' }, 503);
  // Reserve a slot atomically; failed upstream submissions also consume it.
  const row = await env.DB.prepare(`
    INSERT INTO jev_maze_access_cnt (date, count) VALUES (?, 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1 WHERE count < 2000
    RETURNING count
  `).bind(date).first<{ count: number }>();
  if (!row) return json({ ...info(LIMIT), error: LIMIT_ERROR }, 429);
  const reference = crypto.randomUUID();
  const payload = {
    model: MODEL,
    state: { image: reference },
    assets: { [reference]: { type: 'image', format: 'png', data_base64: image } },
    questions: {
      decision: { type: 'choice', instructions: INSTRUCTIONS, criteria: Object.fromEntries(CHOICES.map(choice => [choice, choice])) },
    },
  };
  const details = {
    ...info(row.count),
    request: { ...payload, assets: { [reference]: { type: 'image', format: 'png', data_base64: '[画像データ省略]' } } },
  };
  try {
    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.JEV_IMAGE_PLAYGROUND_API_KEY}`,
        'Content-Type': 'application/json',
        'TypeSafe-Danger-Zone-Images': 'true',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
      redirect: 'manual',
    });
    const text = await upstream.text();
    let response: unknown;
    try {
      // Omit any echoed image data from the diagnostic response too.
      response = JSON.parse(text, (key, value) => key === 'data_base64' ? '[画像データ省略]' : value);
    } catch { response = text.replaceAll(image, '[画像データ省略]'); }
    if (!upstream.ok) return json({ ...details, response, upstreamStatus: upstream.status, error: 'Jevへのリクエストに失敗しました。' }, 502);
    const answers = (response as { answers?: { decision?: unknown } } | null)?.answers;
    const decision = answers?.decision;
    const result = decision && typeof decision === 'object'
      ? (decision as { choice?: unknown }).choice : decision;
    if (typeof result !== 'string' || !CHOICES.includes(result)) {
      return json({ ...details, response, error: 'Jevの選択結果が不正です。' }, 502);
    }
    return json({ ...details, result, response });
  } catch {
    return json({ ...details, error: 'Jevに接続できませんでした。時間をおいてお試しください。' }, 502);
  }
}
