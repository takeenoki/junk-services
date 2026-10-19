import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleJevMazeDemo, japanDate } from '../../src/api/jev-maze-demo/index.ts';
import { CHOICES, INSTRUCTIONS } from '../../public/jev-maze-demo/maze.js';

const bytes = Buffer.alloc(33);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
bytes.write('IHDR', 12);
bytes.writeUInt32BE(720, 16);
bytes.writeUInt32BE(720, 20);
const image = bytes.toString('base64');
let sqlite;
let env;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0007_create_jev_maze_access_cnt.sql', import.meta.url), 'utf8'));
  env = {
    JEV_IMAGE_PLAYGROUND_API_KEY: 'test-secret',
    DB: { prepare: sql => ({ bind: (...args) => ({ first: async () => sqlite.prepare(sql).get(...args) ?? null }) }) },
  };
});
afterEach(() => sqlite.close());
function request(input = { image }, headers = {}) {
  return new Request('https://example.test/api/jev-maze-demo', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
}

test('invalid requests never reach Jev', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  assert.equal((await handleJevMazeDemo(new Request('https://example.test', { method: 'DELETE' }), env)).status, 405);
  assert.equal((await handleJevMazeDemo(request({}, { Origin: 'https://other.test' }), env)).status, 403);
  assert.equal((await handleJevMazeDemo(request({}, { 'Content-Type': 'text/plain' }), env)).status, 415);
  for (const input of [null, {}, { image: 'bad' }, { image: btoa('not png') }]) {
    assert.equal((await handleJevMazeDemo(request(input), env)).status, 400);
  }
  assert.equal((await handleJevMazeDemo(request(), {})).status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jev_maze_access_cnt').get().n, 0);
});

test('sends fixed image choice payload, hides image and key, and counts submissions', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.headers['TypeSafe-Danger-Zone-Images'], 'true');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'jev-1.14.0');
    assert.equal(payload.assets[payload.state.image].data_base64, image);
    assert.deepEqual(Object.keys(payload.questions), ['decision']);
    assert.equal(payload.questions.decision.type, 'choice');
    assert.equal(payload.questions.decision.instructions, INSTRUCTIONS);
    assert.deepEqual(Object.keys(payload.questions.decision.criteria), CHOICES);
    return Response.json({ answers: { decision: { type: 'choice', choice: CHOICES[2], confidence: 0.8 } } });
  });
  for (let i = 0; i < 2; i++) {
    const response = await handleJevMazeDemo(request(), env);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(image) && !text.includes('test-secret'));
    assert.equal(JSON.parse(text).result, CHOICES[2]);
    assert.equal(JSON.parse(text).remaining, 1999 - i);
  }
  assert.equal(calls, 2);
});

test('upstream failures and invalid decisions return diagnostics without retry', async t => {
  for (const reply of [
    () => Response.json({ error: 'unavailable' }, { status: 503 }),
    () => Response.json({ answers: { decision: 'invalid' } }),
    () => new Response('not json'),
    () => { throw new Error('timeout'); },
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', reply);
    const response = await handleJevMazeDemo(request(), env);
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.ok(data.request && data.error);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
  assert.equal(sqlite.prepare('SELECT count FROM jev_maze_access_cnt').get().count, 4);
});

test('quota GET reads only today and midnight uses Japan time', async () => {
  assert.equal(japanDate(new Date('2026-10-20T14:59:59Z')), '2026-10-20');
  assert.equal(japanDate(new Date('2026-10-20T15:00:00Z')), '2026-10-21');
  sqlite.prepare('INSERT INTO jev_maze_access_cnt VALUES (?, ?)').run('2000-01-01', 2000);
  const get = () => handleJevMazeDemo(new Request('https://example.test/api/jev-maze-demo'), env);
  let response = await get();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { date: japanDate(), limit: 2000, remaining: 2000 });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jev_maze_access_cnt').get().n, 1);
  sqlite.prepare('INSERT INTO jev_maze_access_cnt VALUES (?, ?)').run(japanDate(), 23);
  response = await get();
  assert.equal((await response.json()).remaining, 1977);
});

test('concurrent submissions at 1999 admit one request and cap at 2000', async t => {
  sqlite.prepare('INSERT INTO jev_maze_access_cnt VALUES (?, ?)').run(japanDate(), 1999);
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'failed' }, { status: 503 }));
  const responses = await Promise.all(Array.from({ length: 8 }, () => handleJevMazeDemo(request(), env)));
  assert.equal(responses.filter(response => response.status === 502).length, 1);
  assert.equal(responses.filter(response => response.status === 429).length, 7);
  assert.equal(mock.mock.callCount(), 1);
  for (const response of responses) assert.equal((await response.json()).remaining, 0);
  assert.equal(sqlite.prepare('SELECT count FROM jev_maze_access_cnt').get().count, 2000);
  assert.throws(() => sqlite.prepare('UPDATE jev_maze_access_cnt SET count = 2001').run());
});

test('database failures block Jev submissions and return a useful error', async t => {
  const mock = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected fetch'); });
  env.DB = { prepare: () => { throw new Error('private database details'); } };
  for (const req of [request(), new Request('https://example.test/api/jev-maze-demo')]) {
    const response = await handleJevMazeDemo(req, env);
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('private database details'));
  }
  assert.equal(mock.mock.callCount(), 0);
});
