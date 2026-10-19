export const SIZES = [9, 16, 25];
export const INSTRUCTIONS = 'This is an image of a maze. Your current position is indicated by a red circle. Black cells are walls and cannot be traversed. The position marked G is the goal. Choose the best option to reach the goal.';
export const CHOICES = ['Move one cell up', 'Move one cell left', 'Move one cell right', 'Move one cell down'];
const DIRECTIONS = [[0, -1], [-1, 0], [1, 0], [0, 1]];


export function generateMaze(size) {
  if (!SIZES.includes(size)) throw new Error('迷路サイズが不正です。');
  const maze = Array.from({ length: size }, () => Array(size).fill(1));
  const stack = [[0, 0]];
  maze[0][0] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const candidates = DIRECTIONS.filter(([dx, dy]) => {
      const nx = x + dx * 2;
      const ny = y + dy * 2;
      return nx >= 0 && ny >= 0 && nx < size && ny < size && maze[ny][nx] === 1;
    });
    if (!candidates.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = candidates[Math.floor(Math.random() * candidates.length)];
    maze[y + dy][x + dx] = 0;
    maze[y + dy * 2][x + dx * 2] = 0;
    stack.push([x + dx * 2, y + dy * 2]);
  }
  // Even-sized grids need two more cells to connect the bottom-right goal.
  if (size % 2 === 0) {
    maze[size - 2][size - 1] = 0;
    maze[size - 1][size - 1] = 0;
  }
  return maze;
}

export function move(maze, position, choice) {
  const index = CHOICES.indexOf(choice);
  if (index < 0) throw new Error('Jevの選択結果が不正です。');
  const [dx, dy] = DIRECTIONS[index];
  const next = { x: position.x + dx, y: position.y + dy };
  return maze[next.y]?.[next.x] === 0 ? next : position;
}
