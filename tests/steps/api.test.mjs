import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleSteps, validDate } from "../../src/api/steps/index.ts";

const origin = "https://example.test";
const base = "/api/v1/daily-steps";
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", pair.publicKey), kid: "steps-test", alg: "RS256", use: "sig" };
const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");

async function token(overrides = {}, signingKey = pair.privateKey) {
  const header = encode({ alg: "RS256", kid: jwk.kid });
  const payload = encode({ iss: "https://accounts.google.com", aud: "test-client", sub: "allowed-sub",
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...overrides });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signingKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../migrations/0005_create_steps.sql", import.meta.url), "utf8"));
  function statement(sql, args = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      execute() { return { results: sqlite.prepare(sql).all(...args) }; },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map(item => item.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
    close() { sqlite.close(); },
  };
}

function request(path, method = "GET", body, bearer) {
  return new Request(origin + path, { method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("steps API: actual SQLite migration, authentication, versioning and public reads", async t => {
  const logs = [];
  t.mock.method(console, "warn", value => logs.push({ level: "warn", ...JSON.parse(value) }));
  t.mock.method(console, "error", value => logs.push({ level: "error", ...JSON.parse(value) }));
  const db = database();
  t.after(() => db.close());
  const env = { DB: db, STEPS_GOOGLE_CLIENT_ID: "test-client", STEPS_GOOGLE_SUB: "allowed-sub" };
  const bearer = await token();
  const body = { steps: 8432, timezone: "Asia/Tokyo", recordedAt: "2026-10-01T23:58:12+09:00" };
  const put = (value = body, auth = bearer, environment = env) => handleSteps(request(`${base}/2026-10-01`, "PUT", value, auth), environment);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Network unavailable"); });
  const unavailableKeys = await put();
  assert.equal(unavailableKeys.status, 503);
  assert.equal((await unavailableKeys.json()).code, "SERVICE_UNAVAILABLE");
  fetchMock.mock.restore();
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://www.googleapis.com/oauth2/v3/certs");
    return Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } });
  });

  await t.test("missing/invalid token, wrong subject, audience, issuer, expiry and signature", async () => {
    assert.equal((await put(body, null)).status, 401);
    assert.equal((await put(body, "invalid.jwt.token")).status, 401);
    assert.equal((await put(body, await token({ sub: "other" }))).status, 403);
    for (const claims of [{ aud: "other" }, { iss: "https://attacker.test" }, { exp: 1 }, { iat: Date.now() / 1000 + 600 }, { nbf: Date.now() / 1000 + 600 }]) {
      assert.equal((await put(body, await token(claims))).status, 401);
    }
    const otherPair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    assert.equal((await put(body, await token({}, otherPair.privateKey))).status, 401);
    assert.equal((await put(body, bearer, { DB: db })).status, 503);
  });

  await t.test("create, UTC normalization, idempotency, newer update and conflicts", async () => {
    const created = await put();
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("Location"), `${base}/2026-10-01`);
    const stored = await created.json();
    assert.equal(stored.recordedAt, "2026-10-01T14:58:12.000Z");
    assert.deepEqual(Object.keys(stored).sort(), ["date", "steps", "timezone", "recordedAt", "updatedAt"].sort());
    const retry = await put({ ...body, recordedAt: "2026-10-01T14:58:12Z" });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), stored);
    assert.equal((await put({ ...body, steps: 9 })).status, 409);
    assert.equal((await put({ ...body, recordedAt: "2026-10-01T00:00:00Z" })).status, 409);
    const newer = await put({ ...body, steps: 10000, recordedAt: "2026-10-02T00:00:00Z" });
    assert.equal(newer.status, 200);
    assert.equal((await newer.json()).steps, 10000);
    const read = await handleSteps(request(`${base}/2026-10-01`, "GET", undefined, "invalid"), { DB: db });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("Cache-Control"), "no-store");
    assert.equal((await read.json()).steps, 10000);
  });

  await t.test("strict request validation", async () => {
    for (const value of [null, [], {}, { ...body, steps: -1 }, { ...body, steps: 1000001 },
      { ...body, steps: 1.5 }, { ...body, steps: "1" }, { ...body, source: "phone" },
      { ...body, timezone: "+09:00" }, { ...body, timezone: "Not/AZone" },
      { ...body, recordedAt: "2026-02-30T12:00:00Z" }, { ...body, recordedAt: "2026-10-01T12:00:00" },
      { ...body, recordedAt: "2026-10-01T24:00:00Z" }]) {
      assert.equal((await put(value)).status, 400, JSON.stringify(value));
    }
    const malformed = new Request(origin + `${base}/2026-10-01`, { method: "PUT",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: "{" });
    assert.equal((await handleSteps(malformed, env)).status, 400);
    assert.equal((await handleSteps(request(`${base}/2026-02-30`), env)).status, 400);
  });

  await t.test("validation response identifies fields and logs the same trace without input values", async () => {
    const response = await put({ ...body, steps: "private-input", timezone: "private-zone",
      recordedAt: "private-timestamp", "private-extra-field": "private-extra-value" });
    assert.equal(response.status, 400);
    const problem = await response.json();
    assert.deepEqual(problem.errors.map(error => error.field), ["body", "body.steps", "body.timezone", "body.recordedAt"]);
    assert.ok(problem.errors.every(error => error.code && error.message));
    const log = logs.at(-1);
    assert.equal(log.level, "warn");
    assert.equal(log.traceId, problem.traceId);
    assert.deepEqual(log.errors, problem.errors);
    const output = JSON.stringify({ problem, log });
    for (const secret of ["private-input", "private-zone", "private-timestamp", "private-extra-field", "private-extra-value", bearer, "allowed-sub"]) {
      assert.ok(!output.includes(secret));
    }
    const malformed = await handleSteps(new Request(origin + `${base}/2026-10-01`, {
      method: "PUT", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: "{private-json",
    }), env);
    assert.equal((await malformed.json()).errors[0].code, "INVALID_JSON");
    const wrongType = await handleSteps(new Request(origin + `${base}/2026-10-01`, {
      method: "PUT", headers: { Authorization: `Bearer ${bearer}` }, body: "private-body",
    }), env);
    assert.equal((await wrongType.json()).errors[0].field, "headers.content-type");
    const badDate = await handleSteps(request(`${base}/2026-02-30`), env);
    assert.equal((await badDate.json()).errors[0].field, "path.date");
    const badQuery = await handleSteps(request(`${base}?from=2026-10-01&to=2026-10-02&source=private-query`), env);
    assert.equal((await badQuery.json()).errors[0].code, "UNEXPECTED_QUERY");
    assert.ok(!JSON.stringify(logs).includes("private-"));
  });

  await t.test("simultaneous writes converge to the newest record", async () => {
    const responses = await Promise.all([3, 1, 4, 2].map(day =>
      handleSteps(request(`${base}/2026-10-05`, "PUT", { ...body, steps: day,
        recordedAt: `2026-10-0${day}T00:00:00Z` }, bearer), env)));
    assert.ok(responses.every(response => [200, 201, 409].includes(response.status)));
    const read = await handleSteps(request(`${base}/2026-10-05`), env);
    assert.equal((await read.json()).steps, 4);
  });

  await t.test("list bounds, ascending order, missing days and zero steps", async () => {
    assert.equal((await handleSteps(request(`${base}/2026-09-30`, "PUT", { ...body, steps: 0 }, bearer), env)).status, 201);
    const response = await handleSteps(request(`${base}?from=2026-09-29&to=2026-10-02`), { DB: db });
    const { items } = await response.json();
    assert.deepEqual(items.map(item => [item.date, item.steps]), [["2026-09-30", 0], ["2026-10-01", 10000]]);
    assert.deepEqual(await (await handleSteps(request(`${base}?from=2025-01-01&to=2025-01-31`), env)).json(), { items: [] });
    assert.equal((await handleSteps(request(`${base}?from=2024-01-01&to=2024-12-31`), env)).status, 200);
    for (const query of ["from=2024-01-01&to=2025-01-01", "from=2026-10-02&to=2026-10-01",
      "from=2026-02-30&to=2026-03-01", "from=2026-10-01", "from=2026-10-01&to=2026-10-02&source=phone",
      "from=2026-10-01&from=2026-10-01&to=2026-10-02"]) {
      assert.equal((await handleSteps(request(`${base}?${query}`), env)).status, 400, query);
    }
  });

  await t.test("problem responses, removed synchronization, methods and DB outage", async () => {
    const missing = await handleSteps(request(`${base}/2026-10-03`), env);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("Content-Type"), "application/problem+json");
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    const problem = await missing.json();
    assert.equal(problem.code, "DAILY_STEPS_NOT_FOUND");
    assert.ok(problem.traceId);
    assert.equal((await handleSteps(request("/api/v1/users/me", "PUT"), env)).status, 404);
    assert.equal((await handleSteps(request(`${base}/source/phone`), env)).status, 404);
    assert.equal((await handleSteps(request(base, "POST"), env)).status, 405);
    const unavailable = await handleSteps(request(`${base}/2026-10-01`), { DB: { prepare() { throw new Error("private data"); } } });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("Retry-After"), "30");
    assert.ok(!(await unavailable.text()).includes("private data"));
    assert.equal(logs.at(-1).level, "error");
    assert.equal(logs.at(-1).code, "SERVICE_UNAVAILABLE");
    assert.ok(!JSON.stringify(logs).includes("private data"));
  });
});

test("date validation includes leap years and rejects normalization", () => {
  for (const date of ["2024-02-29", "0001-01-01", "9999-12-31"]) assert.equal(validDate(date), true);
  for (const date of [null, "2026-02-29", "0000-01-01", "2026-2-01", "2026-04-31"]) assert.equal(validDate(date), false);
});
