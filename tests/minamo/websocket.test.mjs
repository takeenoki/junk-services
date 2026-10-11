import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.MINAMO_URL;

test("local Worker synchronizes sockets, validates operations, and caps leaves", {
  skip: !base, timeout: 30000,
}, async () => {
  const sockets = [];
  async function connect() {
    const socket = new WebSocket(base.replace(/^http/, "ws") + "/api/minamo");
    sockets.push(socket);
    const events = [];
    socket.addEventListener("message", event => events.push(JSON.parse(event.data)));
    async function wait(predicate) {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const index = events.findIndex(predicate);
        if (index >= 0) return events.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("WebSocket event timed out");
    }
    const initial = await wait(event => event.type === "init");
    return { socket, wait, initial };
  }
  try {
    const response = await fetch(base + "/minamo/");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /canvas/);
    assert.equal((await fetch(base + "/api/minamo")).status, 426);
    const a = await connect();
    const b = await connect();
    a.socket.send(JSON.stringify({ type: "stone", x: 500, y: 500 }));
    const stone = await a.wait(event => event.type === "stone" && event.own);
    const shared = await b.wait(event => event.type === "stone");
    assert.equal(shared.ripple.id, stone.ripple.id);
    a.socket.send(JSON.stringify({ type: "stone", x: 500, y: 500 }));
    await a.wait(event => event.type === "error");
    a.socket.send(JSON.stringify({ type: "leaf", x: -1, y: 0 }));
    await a.wait(event => event.type === "error");
    a.socket.send("null");
    await a.wait(event => event.type === "error");
    a.socket.send(JSON.stringify({ type: "leaf", x: 100, y: 100 }));
    const placed = await a.wait(event => event.type === "leaf" && event.own);
    await b.wait(event => event.type === "leaf" && event.leaf.id === placed.leaf.id);
    a.socket.send(JSON.stringify({ type: "leaf", x: 100, y: 100 }));
    await a.wait(event => event.type === "error");
    const reconnected = await connect();
    assert.ok(reconnected.initial.leaves.some(leaf => leaf.id === placed.leaf.id));
    reconnected.socket.send(JSON.stringify({ type: "stone", x: 500, y: 500 }));
    await reconnected.wait(event => event.type === "stone" && event.own);
    for (let index = 0; index < 21; index++) {
      const client = await connect();
      client.socket.send(JSON.stringify({ type: "leaf", x: 100, y: 100 }));
      await client.wait(event => event.type === "leaf" && event.own);
    }
    const final = await connect();
    assert.equal(final.initial.leaves.length, 20);
    assert.ok(!final.initial.leaves.some(leaf => leaf.id === placed.leaf.id));
  } finally {
    for (const socket of sockets) socket.close();
  }
});
