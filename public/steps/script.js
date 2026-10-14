const monthInput = document.querySelector("#month");
const status = document.querySelector("#status");
const table = document.querySelector("#steps-table");
const days = document.querySelector("#days");
const results = document.querySelector("#results");
const heading = document.querySelector("#month-heading");
const number = new Intl.NumberFormat("ja-JP");
const today = new Date();
monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
let pending;

async function loadMonth() {
  if (!monthInput.validity.valid || !/^\d{4}-\d{2}$/.test(monthInput.value)) return;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const month = monthInput.value;
  const [year, monthNumber] = month.split("-").map(Number);
  // Leap years are calculated directly to also support years 0001–0099.
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const count = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthNumber - 1];
  heading.textContent = `${year}年${monthNumber}月`;
  table.hidden = true;
  days.replaceChildren();
  status.textContent = "読み込み中…";
  results.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/v1/daily-steps?from=${month}-01&to=${month}-${count}`, {
      cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    if (controller.signal.aborted) return;
    const items = new Map(data.items.map(item => [item.date, item.steps]));
    const fragment = document.createDocumentFragment();
    for (let day = 1; day <= count; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const row = document.createElement("tr");
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = `${monthNumber}月${day}日`;
      const value = document.createElement("td");
      value.textContent = items.has(date) ? `${number.format(items.get(date))} 歩` : "—";
      if (!items.has(date)) value.className = "missing";
      row.append(label, value);
      fragment.append(row);
    }
    days.append(fragment);
    status.textContent = items.size ? `${items.size}日分の記録があります。` : "この月の記録はありません。";
    table.hidden = false;
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = "歩数を取得できませんでした。時間をおいて「表示」を押してください。";
  } finally {
    if (pending === controller) results.setAttribute("aria-busy", "false");
  }
}

document.querySelector("#month-form").addEventListener("submit", event => {
  event.preventDefault();
  loadMonth();
});
loadMonth();
