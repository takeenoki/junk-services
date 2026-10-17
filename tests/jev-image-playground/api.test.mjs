import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleJevImagePlayground, japanDate } from '../../src/api/jev-image-playground/index.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0006_create_jev_image_playground_access_cnt.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) {
      return { bind: (...args) => ({ first: async () => sqlite.prepare(sql).get(...args) ?? null }) };
    },
  };
}

function image(width = 280, height = 280) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

function request(input = {}, method = 'POST') {
  return new Request('https://example.test/api/jev-image-playground', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ image: image(), type: 'noul', question: '猫ですか？', ...input }) } : {}),
  });
}

test('Japanese midnight changes the date', () => {
  assert.equal(japanDate(new Date('2026-10-17T14:59:59Z')), '2026-10-17');
  assert.equal(japanDate(new Date('2026-10-17T15:00:00Z')), '2026-10-18');
});

test('GET reports config and quota without creating rows', async () => {
  const DB = database();
  const result = await handleJevImagePlayground(request({}, 'GET'), { DB, JEV_IMAGE_PLAYGROUND_MODEL: 'jev-future' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  const data = await result.json();
  assert.equal(data.remaining, 200);
  assert.equal(data.model, 'jev-future');
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM "jev-image-playground-access-cnt"').get().n, 0);
  DB.sqlite.close();
});

test('invalid input and missing key never consume slots', async () => {
  const DB = database();
  const env = { DB, JEV_IMAGE_PLAYGROUND_API_KEY: 'secret' };
  for (const input of [
    { question: ' ' }, { type: 'box' }, { image: image(279, 280) },
    { image: image(280, 1569) }, { image: 'broken' },
    { type: 'choice', criteria: ['cat'] }, { type: 'choice', criteria: ['cat', 'cat'] },
    { type: 'score', criteria: [0, 1] },
  ]) {
    assert.equal((await handleJevImagePlayground(request(input), env)).status, 400);
  }
  assert.equal((await handleJevImagePlayground(request(), { DB })).status, 503);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM "jev-image-playground-access-cnt"').get().n, 0);
  DB.sqlite.close();
});

test('all question types use pinned model, image assets, private key and return raw details', async t => {
  const DB = database();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({ answers: { decision: { noul: 0.9 } }, model: 'jev-1.14.0' });
  });
  const env = { DB, JEV_IMAGE_PLAYGROUND_API_KEY: 'private-key' };
  for (const type of ['noul', 'choice', 'score']) {
    const result = await handleJevImagePlayground(request({ type, criteria: ['暗い', '明るい'] }), env);
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.result.noul, 0.9);
    assert.equal(JSON.stringify(data).includes('private-key'), false);
  }
  assert.equal(sent[0].url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  assert.equal(sent[0].body.model, 'jev-1.14.0');
  assert.equal(sent[0].init.headers['TypeSafe-Danger-Zone-Images'], 'true');
  assert.equal(sent[0].init.headers.Authorization, 'Bearer private-key');
  assert.equal(sent[0].init.redirect, 'manual');
  assert.equal(sent[0].body.assets[sent[0].body.state.image].format, 'png');
  assert.deepEqual(sent[1].body.questions.decision.criteria, { 暗い: '暗い', 明るい: '明るい' });
  assert.deepEqual(sent[2].body.questions.decision.criteria, ['暗い', '明るい']);
  DB.sqlite.close();
});

test('parallel submissions at 199 allow only one upstream call, including failed requests', async t => {
  const DB = database();
  DB.sqlite.prepare('INSERT INTO "jev-image-playground-access-cnt" VALUES (?, 199)').run(japanDate());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ error: 'unavailable' }, { status: 503 });
  });
  const env = { DB, JEV_IMAGE_PLAYGROUND_API_KEY: 'secret' };
  const responses = await Promise.all(Array.from({ length: 8 }, () => handleJevImagePlayground(request(), env)));
  assert.equal(calls, 1);
  assert.equal(responses.filter(response => response.status === 502).length, 1);
  assert.equal(responses.filter(response => response.status === 429).length, 7);
  assert.equal((await (await handleJevImagePlayground(request({}, 'GET'), env)).json()).remaining, 0);
  const limited = await responses.find(response => response.status === 429).json();
  assert.equal(limited.error, '1日のリクエスト上限に達しました。また明日お試しください');
  DB.sqlite.close();
});

test('non-200 responses log status and raw body without request credentials', async t => {
  const DB = database();
  const logs = t.mock.method(console, 'error', () => {});
  let status = 401;
  t.mock.method(globalThis, 'fetch', async () => new Response('gateway error body', {
    status, statusText: 'Gateway status',
  }));
  const env = { DB, JEV_IMAGE_PLAYGROUND_API_KEY: 'private-key' };
  // Include 2xx other than 200: these must also be logged.
  for (status of [302, 401, 429, 502, 201]) {
    const response = await handleJevImagePlayground(request(), env);
    assert.equal(response.status, 502);
    const entry = logs.mock.calls.find(call => call.arguments[1]?.status === status);
    assert.ok(entry);
    assert.equal(entry.arguments[1].response, 'gateway error body');
    assert.equal(entry.arguments[1].endpoint, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  }
  assert.equal(JSON.stringify(logs.mock.calls).includes('private-key'), false);
  DB.sqlite.close();
});

test('connection failure and malformed success consume one slot each with no retries', async t => {
  const DB = database();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) throw new Error('private connection details');
    return new Response('not JSON');
  });
  const env = { DB, JEV_IMAGE_PLAYGROUND_API_KEY: 'secret' };
  for (let i = 0; i < 2; i++) {
    const response = await handleJevImagePlayground(request(), env);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).remaining, 199 - i);
  }
  assert.equal(calls, 2);
  DB.sqlite.close();
});

test('unsupported methods, cross-origin submissions and DB failures do not call Jev', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('must not call'); });
  const DB = database();
  assert.equal((await handleJevImagePlayground(request({}, 'DELETE'), { DB })).status, 405);
  const foreign = request();
  foreign.headers.set('Origin', 'https://other.test');
  assert.equal((await handleJevImagePlayground(foreign, { DB })).status, 403);
  const broken = { prepare() { throw new Error('private DB detail'); } };
  const response = await handleJevImagePlayground(request(), { DB: broken, JEV_IMAGE_PLAYGROUND_API_KEY: 'secret' });
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('private DB detail'), false);
  DB.sqlite.close();
});
