import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAboutMe } from "../../src/api/about_me/index.ts"

const request = (method = "GET") => new Request("http://example.test/api/about-me", { method });
const database = (value) => ({ 
    prepare: () => ({
        first: async (column) => {
            assert.equal(column, "access_count");
            return value;
        },
    }),
});

test("正常系", async (t) => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    t.mock.method(globalThis.crypto, "randomUUID", () => requestId);

    const response = await handleAboutMe(request(), database(5));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("X-Request-ID"), requestId);
    assert.equal(body.url, "http://example.test/api/about-me");
    assert.equal(body.accessCount, 5);
})

test("行データなし", async (t) => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    t.mock.method(globalThis.crypto, "randomUUID", () => requestId);

    const response = await handleAboutMe(request(), database(null));
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("X-Request-ID"), requestId);
    assert.equal(body.error, "自己紹介情報の取得に失敗しました。");
})

test("DBアクセスエラー", async (t) => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    t.mock.method(globalThis.crypto, "randomUUID", () => requestId);

    const response = await handleAboutMe(request(), {
        prepare() { throw new Error("Error"); },
    });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("X-Request-ID"), requestId);
    assert.equal(body.error, "自己紹介情報の取得に失敗しました。");
})