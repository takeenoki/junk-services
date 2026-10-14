import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../../src/api/beepers/index.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { handleBeepers } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("operation logs validate input and do not access track storage", async () => {
  const logs = [];
  const original = console.info;
  console.info = value => logs.push(value);
  const env = { BEEPERS: { idFromName() { throw new Error("Unexpected track access"); } } };
  const request = (body, headers = {}, method = "POST") => handleBeepers(
    new Request("https://example.com/api/beepers/log", {
      method, headers, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    }), env,
  );
  try {
    assert.equal((await request({ operation: "SAMPLE", type: 1 })).status, 204);
    assert.equal((await request({ operation: "PUT", type: 20 })).status, 204);
    for (const body of [null, { operation: "FINISH", type: 1 },
      { operation: "PUT", type: 0 }, { operation: "PUT", type: 21 },
      { operation: "SAMPLE", type: "1" }, { operation: "SAMPLE", type: 1.5 }]) {
      assert.equal((await request(body)).status, 400);
    }
    assert.equal((await request({}, {}, "GET")).status, 405);
    assert.equal((await request({ operation: "PUT", type: 1 }, { Origin: "https://other.example" })).status, 403);
    assert.deepEqual(logs, ["BEEPERS [INFO] SAMPLE 1", "BEEPERS [INFO] PUT 20"]);
  } finally {
    console.info = original;
  }
});
