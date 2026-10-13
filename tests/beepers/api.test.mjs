import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.BEEPERS_URL;
const limitedBase = process.env.BEEPERS_LIMITED_URL;

async function client(url) {
  let cookie = "";
  async function request(path, body, extra = {}) {
    const response = await fetch(url + "/api/beepers/" + path, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json", ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return { response, data: await response.json() };
  }
  const initial = await request("state");
  return { request, initial, get cookie() { return cookie; } };
}

const start = (type = 1) => ({ type, requestId: crypto.randomUUID(), pressedAtMs: Date.now() });

test("shared Worker: synchronization, authorization, finalization, concurrent FIFO and idempotency", {
  skip: !base, timeout: 30000,
}, async () => {
  const a = await client(base);
  const b = await client(base);
  assert.equal(a.initial.data.postLimitEnabled, false);
  assert.equal(a.initial.data.debugMode, true);
  assert.equal(a.initial.data.postIntervalMs, 5000);
  assert.equal(a.initial.data.epochMs, b.initial.data.epochMs);
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/api/beepers/ws");
  const events = [];
  socket.addEventListener("message", event => events.push(JSON.parse(event.data)));
  async function wait(predicate) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("WebSocket state timed out");
  }
  try {
    await wait(event => event.type === "state");
    assert.equal((await a.request("start", start(21))).response.status, 400);
    assert.equal((await a.request("start", start(), { Origin: "https://elsewhere.example" })).response.status, 403);
    const operation = start(17);
    const posted = await a.request("start", operation);
    assert.equal(posted.response.status, 201);
    const sound = posted.data.sounds.find(sound => sound.id === posted.data.id);
    assert.equal(sound.status, "pending");
    assert.ok(sound.positionMs >= 0 && sound.positionMs < 10000);
    const event = await wait(event => event.version === posted.data.version);
    assert.ok(!JSON.stringify(event).includes(posted.data.token));
    const duplicate = await a.request("start", operation);
    assert.equal(duplicate.data.id, posted.data.id);
    assert.equal(duplicate.data.version, posted.data.version);
    const finish = { id: posted.data.id, token: posted.data.token, durationMs: 2000 };
    assert.equal((await b.request("finish", finish)).response.status, 403);
    assert.equal((await a.request("finish", { ...finish, token: "wrong" })).response.status, 403);
    const completed = await a.request("finish", finish);
    assert.equal(completed.data.sounds.find(sound => sound.id === finish.id).durationMs, 2000);
    const immutable = await a.request("finish", { ...finish, durationMs: 50 });
    assert.equal(immutable.data.version, completed.data.version);
    const minClient = await client(base);
    const minimum = await minClient.request("start", start(1));
    const minEnd = await minClient.request("finish", { id: minimum.data.id, token: minimum.data.token, durationMs: 1 });
    assert.equal(minEnd.data.sounds.find(sound => sound.id === minimum.data.id).durationMs, 50);
    const pendingClient = await client(base);
    const pending = await pendingClient.request("start", start(9));
    const finalized = await wait(event => event.sounds.some(sound => sound.id === pending.data.id && sound.status === "finalized"));
    assert.equal(finalized.sounds.find(sound => sound.id === pending.data.id).durationMs, 3000);
    const clients = await Promise.all(Array.from({ length: 105 }, () => client(base)));
    const batch = await Promise.all(clients.map((browser, index) => browser.request("start", start(index % 20 + 1))));
    assert.ok(batch.every(item => item.response.status === 201));
    const final = (await b.request("state")).data;
    assert.equal(final.sounds.length, 100);
    assert.equal(new Set(final.sounds.map(sound => sound.sequence)).size, 100);
    assert.ok(final.sounds.every((sound, index) => index === 0 || sound.sequence === final.sounds[index - 1].sequence + 1));
    assert.ok(!final.sounds.some(sound => sound.id === posted.data.id));
    const reconnect = await client(base);
    assert.deepEqual(reconnect.initial.data.sounds, final.sounds);
    assert.equal((await fetch(base + "/beepers/")).status, 200);
    assert.equal((await a.request("ws")).response.status, 426);
  } finally { socket.close(); }
});

test("debug mode: five-second interval and shared clear keep epoch and sequence", {
  skip: !base, timeout: 15000,
}, async () => {
  const a = await client(base);
  const accepted = await a.request("start", start());
  assert.equal(accepted.response.status, 201);
  assert.ok(accepted.data.nextPostAtMs - accepted.data.serverTimeMs > 4900);
  assert.ok(accepted.data.nextPostAtMs - accepted.data.serverTimeMs <= 5000);
  assert.equal((await a.request("start", start())).response.status, 429);
  const cleared = await a.request("clear", {});
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.data.sounds.length, 0);
  assert.equal(cleared.data.epochMs, accepted.data.epochMs);
  assert.equal(cleared.data.nextSequence, accepted.data.nextSequence);
  assert.ok(cleared.data.version > accepted.data.version);
  const b = await client(base);
  assert.equal(b.initial.data.sounds.length, 0);
  const lateFinish = await a.request("finish", { id: accepted.data.id, token: accepted.data.token, durationMs: 2000 });
  assert.equal(lateFinish.data.sounds.length, 0);
  assert.equal((await a.request("start", start())).response.status, 429);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, accepted.data.nextPostAtMs - Date.now()) + 50));
  assert.equal((await a.request("start", start())).response.status, 201);
});

test("production default: signed cookie, hourly limit, no consumption on rejection", {
  skip: !limitedBase, timeout: 10000,
}, async () => {
  const a = await client(limitedBase);
  assert.equal(a.initial.data.postLimitEnabled, true);
  assert.equal(a.initial.data.debugMode, false);
  assert.equal(a.initial.data.postIntervalMs, 3_600_000);
  assert.equal((await a.request("clear", {})).response.status, 403);
  const malformed = await a.request("start", start(0));
  assert.equal(malformed.response.status, 400);
  const operation = start();
  const accepted = await a.request("start", operation);
  assert.equal(accepted.response.status, 201);
  assert.ok(accepted.data.nextPostAtMs > Date.now() + 3_590_000);
  const duplicate = await a.request("start", operation);
  assert.equal(duplicate.data.id, accepted.data.id);
  const rejected = await a.request("start", start());
  assert.equal(rejected.response.status, 429);
  assert.equal(rejected.data.nextPostAtMs, accepted.data.nextPostAtMs);
  const state = await a.request("state");
  assert.equal(state.data.nextSequence, accepted.data.nextSequence);
  const tamperedCookie = a.cookie.slice(0, -1) + (a.cookie.endsWith("0") ? "1" : "0");
  const tampered = await a.request("state", undefined, { Cookie: tamperedCookie });
  assert.equal(tampered.data.nextPostAtMs, 0);
});
