import { INSTRUCTIONS, CHOICES, generateMaze, move } from './maze.js';

const $ = id => document.getElementById(id);
const canvas = $('maze');
const context = canvas.getContext('2d');
let maze = null;
let size = 9;
let position = { x: 0, y: 0 };
let busy = false;
let quota = null;
const API = '/api/jev-maze-demo';
const LIMIT_ERROR = '1日のリクエスト上限に達しました。また明日お試しください';

function showQuota(data) {
  quota = data;
  $('remaining').textContent = `${data.remaining} / ${data.limit}`;
  $('gauge').value = data.remaining;
  $('gauge').max = data.limit;
  $('gauge').textContent = `${data.remaining} / ${data.limit}`;
  $('quota-message').textContent = data.remaining <= 0 ? LIMIT_ERROR : '';
  updateButtons();
}

async function refreshQuota() {
  const response = await fetch(API, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    quota = null;
    $('remaining').textContent = '取得できませんでした';
    updateButtons();
    throw new Error(data.error || 'リクエスト数を取得できませんでした。');
  }
  showQuota(data);
}

$('instructions').textContent = INSTRUCTIONS;
for (const choice of CHOICES) {
  const item = document.createElement('li');
  item.textContent = choice;
  $('choices').append(item);
}

function atGoal() { return position.x === size - 1 && position.y === size - 1; }
function updateButtons() {
  $('generate').disabled = busy;
  $('size').disabled = busy;
  $('advance').disabled = busy || !maze || atGoal() || !quota || quota.remaining <= 0;
  $('advance').textContent = busy ? '判定中…' : '迷路を進む';
}

function draw() {
  const cell = canvas.width / size;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!maze) return;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (maze[y][x]) {
        context.fillStyle = '#000';
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  context.beginPath();
  context.strokeStyle = '#a0a0a0';
  context.lineWidth = 1;
  for (let i = 0; i <= size; i++) {
    context.moveTo(i * cell, 0); context.lineTo(i * cell, canvas.height);
    context.moveTo(0, i * cell); context.lineTo(canvas.width, i * cell);
  }
  context.stroke();
  context.fillStyle = '#000';
  context.font = `bold ${cell * .7}px system-ui`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('S', cell / 2, cell / 2);
  context.fillText('G', (size - .5) * cell, (size - .5) * cell);
  context.beginPath();
  context.fillStyle = '#e32636';
  context.arc((position.x + .5) * cell, (position.y + .5) * cell, cell * .3, 0, Math.PI * 2);
  context.fill();
  canvas.setAttribute('aria-label', `${size}×${size}の迷路。現在位置は左から${position.x + 1}列、上から${position.y + 1}行。ゴールは右下のG。`);
}

$('generate').addEventListener('click', () => {
  if (busy) return;
  size = Number($('size').value);
  maze = generateMaze(size);
  position = { x: 0, y: 0 };
  $('result').textContent = size + '×' + size + 'の迷路を生成しました。「迷路を進む」ボタンを押してください。';
  $('request').textContent = 'まだ送信していません。';
  $('response').textContent = 'まだ受信していません。';
  draw();
  updateButtons();
});

canvas.addEventListener('click', event => {
  if (!maze || busy) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width - canvas.clientLeft * 2;
  const height = rect.height - canvas.clientTop * 2;
  const x = Math.floor((event.clientX - rect.left - canvas.clientLeft) / width * size);
  const y = Math.floor((event.clientY - rect.top - canvas.clientTop) / height * size);
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  maze[y][x] = maze[y][x] === 0 ? 1 : 0;
  draw();
});

$('advance').addEventListener('click', async () => {
  if (busy || !maze || atGoal()) return;
  busy = true;
  updateButtons();
  $('result').textContent = 'Jevが選択中です…';
  $('request').textContent = '送信中…';
  $('response').textContent = '受信待ち…';
  try {
    await refreshQuota();
    if (quota.remaining <= 0) throw new Error(LIMIT_ERROR);
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: canvas.toDataURL('image/png').split(',')[1] }),
    });
    const data = await response.json();
    if (typeof data.remaining === 'number') showQuota(data);
    $('request').textContent = data.request ? JSON.stringify(data.request, null, 2) : 'Jevへの送信は行われませんでした。';
    $('response').textContent = JSON.stringify(data.response ?? { error: data.error }, null, 2);
    if (!response.ok) throw new Error(data.error || 'Jevへのリクエストに失敗しました。');
    const next = move(maze, position, data.result);
    const moved = next !== position;
    position = next;
    $('result').textContent = `Jevは「${data.result}」を選択しました${moved ? '。' : 'が、移動できませんでした。'}${atGoal() ? ' ゴールに到達しました。' : ''}`;
    draw();
  } catch (error) {
    $('result').textContent = error.message || '通信に失敗しました。';
    if ($('response').textContent === '受信待ち…') $('response').textContent = 'レスポンスを取得できませんでした。';
    if ($('request').textContent === '送信中…') $('request').textContent = 'リクエストの詳細を取得できませんでした。';
  } finally {
    busy = false;
    updateButtons();
  }
});

draw();
refreshQuota().catch(error => { $('quota-message').textContent = error.message; });
window.addEventListener('focus', () => {
  if (!busy) refreshQuota().catch(error => { $('quota-message').textContent = error.message; });
});
