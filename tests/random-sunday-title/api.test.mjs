import assert from "node:assert/strict";
import { test } from "node:test";
import { handleRandomSundayTitle } from "../../src/api/random-sunday-title/index.ts";

const request = (method = "GET") => new Request("https://example.test/api/random-sunday-title", { method });
const database = (value) => ({ prepare: () => ({ first: async () => value }) });

test("returns all fields including null links without caching", async () => {
  const title = {
    title: "作品", title_url: null, author: "作者", author_url: null,
    start_issue: "2000年1号", end_issue: "連載中",
  };
  const response = await handleRandomSundayTitle(request(), database(title));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), title);
});

test("empty database returns a useful 404", async () => {
  const response = await handleRandomSundayTitle(request(), database(null));
  assert.equal(response.status, 404);
  assert.ok((await response.json()).error);
});

test("POST is rejected without querying the database", async () => {
  const response = await handleRandomSundayTitle(request("POST"), {
    prepare() { throw new Error("must not query"); },
  });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});

test("database failure returns 500 without exposing internal details", async () => {
  const response = await handleRandomSundayTitle(request(), {
    prepare: () => ({ first: async () => { throw new Error("private database details"); } }),
  });
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes("private database details"));
});

