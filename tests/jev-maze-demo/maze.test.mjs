import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIZES, CHOICES, generateMaze, move } from '../../public/jev-maze-demo/maze.js';

test('all random maze sizes have reachable goals and connected corridors', () => {
  let branches = 0;
  for (const size of SIZES) {
    const layouts = new Set();
    for (let trial = 0; trial < 50; trial++) {
      const maze = generateMaze(size);
      layouts.add(JSON.stringify(maze));
      assert.equal(maze.length, size);
      assert.ok(maze.every(row => row.length === size && row.every(cell => cell === 0 || cell === 1)));
      const queue = [{ x: 0, y: 0 }];
      const seen = new Set(['0,0']);
      for (let i = 0; i < queue.length; i++) {
        const position = queue[i];
        let exits = 0;
        for (const choice of CHOICES) {
          const next = move(maze, position, choice);
          if (next === position) continue;
          exits++;
          const key = `${next.x},${next.y}`;
          if (!seen.has(key)) { seen.add(key); queue.push(next); }
        }
        if (exits >= 3) branches++;
      }
      assert.ok(seen.has(`${size - 1},${size - 1}`));
      assert.equal(seen.size, maze.flat().filter(cell => cell === 0).length);
    }
    assert.ok(layouts.size > 1);
  }
  assert.ok(branches > 0);
});

test('unsupported maze sizes are rejected', () => {
  for (const size of [0, 10, 30, '9', null]) assert.throws(() => generateMaze(size));
});

test('movement rejects walls, bounds, and unknown choices', () => {
  const maze = [[0, 1], [0, 0]];
  const start = { x: 0, y: 0 };
  for (const choice of CHOICES.slice(0, 3)) assert.equal(move(maze, start, choice), start);
  assert.deepEqual(move(maze, start, CHOICES[3]), { x: 0, y: 1 });
  assert.throws(() => move(maze, start, 'invalid'));
});
