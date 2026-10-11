import assert from "node:assert/strict";
import { test } from "node:test";
import { advance, PARAMETERS as P } from "../../public/minamo/physics.js";

const leaf = (overrides = {}) => ({ id: "leaf", x: 100, y: 500,
  vx: P.flowSpeed, vy: 0, createdAt: 0, updatedAt: 0, ...overrides });

test("quiet drift integrates long idle periods and removes leaves outside the world", () => {
  const state = { leaves: [leaf()], ripples: [] };
  advance(state, 10000);
  assert.equal(state.leaves[0].x, 100 + P.flowSpeed * 10);
  advance(state, 14 * 60 * 60 * 1000);
  assert.equal(state.leaves.length, 0);
});

test("a leaf near the center remains for approximately two hours without ripples", () => {
  const state = { leaves: [leaf({ x: 500 })], ripples: [] };
  advance(state, 119 * 60 * 1000);
  assert.equal(state.leaves.length, 1);
  assert.ok(state.leaves[0].x > 990);
  advance(state, 121 * 60 * 1000);
  assert.equal(state.leaves.length, 0);
});

test("ripple applies outward force once and drag returns velocity toward the current", () => {
  const state = { leaves: [leaf()], ripples: [
    { id: "wave", x: 0, y: 500, createdAt: 0, hit: [] },
  ] };
  advance(state, 2000);
  assert.ok(state.leaves[0].vx > P.flowSpeed);
  assert.deepEqual(state.ripples[0].hit, ["leaf"]);
  const velocity = state.leaves[0].vx;
  advance(state, 3000);
  assert.ok(state.leaves[0].vx < velocity);
  advance(state, 10000);
  assert.equal(state.ripples.length, 0);
  // The visible displacement should be substantial even with the slow current.
  assert.ok(state.leaves[0].x - 100 - P.flowSpeed * 10 > 80);
});

test("incremental browser prediction agrees with elapsed-time server updates", () => {
  const state = { leaves: [leaf()], ripples: [
    { id: "wave", x: 0, y: 500, createdAt: 0, hit: [] },
  ] };
  const predicted = structuredClone(state);
  advance(state, 5000);
  for (let now = 50; now <= 5000; now += 50) advance(predicted, now);
  assert.deepEqual(predicted, state);
});
