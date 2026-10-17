const $ = id => document.getElementById(id);
const API = '/api/jev-image-playground';
const LIMIT_ERROR = '1日のリクエスト上限に達しました。また明日お試しください';
let type = 'noul';
let image = null;
let quota = null;
let busy = false;
let preparing = false;
let generation = 0;

function updateButton() {
  $('submit').disabled = busy || preparing || !image || !quota || quota.remaining <= 0;
}

function showQuota(data) {
  quota = data;
  $('endpoint').textContent = data.endpoint;
  $('model').textContent = data.model;
  $('remaining').textContent = `${data.remaining} / ${data.limit}`;
  $('gauge').value = data.remaining;
  $('gauge').max = data.limit;
  $('gauge').textContent = `${data.remaining} / ${data.limit}`;
  updateButton();
}

async function refreshQuota() {
  const response = await fetch(API, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'リクエスト数を取得できませんでした。');
  showQuota(data);
  if (data.remaining <= 0) $('message').textContent = LIMIT_ERROR;
}

function selectTab(next) {
  type = next;
  for (const tab of document.querySelectorAll('[role=tab]')) {
    const active = tab.dataset.type === type;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = $(tab.getAttribute('aria-controls'));
    panel.hidden = !active;
    for (const input of panel.querySelectorAll('textarea')) input.disabled = !active;
  }
}

const tabs = [...document.querySelectorAll('[role=tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab.dataset.type));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next].dataset.type);
    tabs[next].focus();
  });
});

$('image').addEventListener('change', async () => {
  const current = ++generation;
  image = null;
  preparing = true;
  $('preview-container').hidden = true;
  $('preview').removeAttribute('src');
  $('message').textContent = '';
  updateButton();
  const file = $('image').files[0];
  try {
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    try {
      const ratio = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * ratio);
      const height = Math.round(bitmap.height * ratio);
      if (Math.min(bitmap.width, bitmap.height, width, height) < 280) {
        throw new Error('画像の各辺は280px以上必要です。縮小後の短辺も280px以上になる画像を選択してください。');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('画像を読み込めませんでした。');
      context.drawImage(bitmap, 0, 0, width, height);
      const url = canvas.toDataURL('image/png');
      if (current !== generation) return;
      image = url.split(',')[1];
      $('preview').src = url;
      $('image-info').textContent = `${file.name} · ${bitmap.width} × ${bitmap.height}px → ${width} × ${height}px`;
      $('preview-container').hidden = false;
    } finally {
      bitmap.close();
    }
  } catch (error) {
    if (current === generation) {
      $('message').textContent = error.message || '画像を読み込めませんでした。';
      $('image').value = '';
    }
  } finally {
    if (current === generation) {
      preparing = false;
      updateButton();
    }
  }
});

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || preparing || !image) return;
  busy = true;
  $('message').textContent = '';
  $('result').textContent = '判定中…';
  $('request').textContent = 'まだ送信していません。';
  $('response').textContent = 'まだ受信していません。';
  updateButton();
  try {
    // Refresh before every submission, including after a page has crossed midnight.
    await refreshQuota();
    if (quota.remaining <= 0) throw new Error(LIMIT_ERROR);
    const question = $(`question-${type}`).value.trim();
    if (!question) throw new Error('質問を入力してください。');
    const criteria = type === 'noul' ? undefined : $(`criteria-${type}`).value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (criteria && (criteria.length < 2 || criteria.length > 255 || criteria.some(line => line.length > 1000) || new Set(criteria).size !== criteria.length)) {
      throw new Error('選択肢・クライテリアは重複なしで2〜255行、各1000文字以内にしてください。');
    }
    $('inputs').disabled = true;
    $('submit').textContent = '判定中…';
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, question, criteria, image }),
    });
    const data = await response.json();
    if (typeof data.remaining === 'number') showQuota(data);
    if (data.request) {
      $('request').textContent = JSON.stringify(data.request,
        (key, value) => key === 'data_base64' ? '[画像データ]' : value, 2);
    }
    $('response').textContent = JSON.stringify(data.response ?? { error: data.error }, null, 2);
    if (!response.ok) throw new Error(data.error || '判定に失敗しました。');
    $('result').textContent = JSON.stringify(data.result, null, 2);
    if (data.remaining <= 0) $('message').textContent = LIMIT_ERROR;
  } catch (error) {
    $('result').textContent = '判定できませんでした。';
    $('message').textContent = error.message || '通信に失敗しました。';
  } finally {
    busy = false;
    $('inputs').disabled = false;
    $('submit').textContent = '判定する';
    updateButton();
  }
});

refreshQuota().catch(error => { $('message').textContent = error.message; });
window.addEventListener('focus', () => {
  if (!busy) refreshQuota().catch(error => { $('message').textContent = error.message; });
});
