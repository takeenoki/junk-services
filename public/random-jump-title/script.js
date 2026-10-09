const button = document.querySelector("#draw");
const status = document.querySelector("#status");
const result = document.querySelector("#result");

function setLinkedText(element, text, url) {
  element.replaceChildren();
  if (url && /^https?:\/\//i.test(url)) {
    const link = document.createElement("a");
    link.href = url;
    link.textContent = text;
    element.append(link);
  } else {
    element.textContent = text;
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "作品を選んでいます…";
  if (!result.hidden) {
    // 更新中や短い作品名への切り替えでページが縮み、スクロール位置が動くのを防ぐ。
    result.style.minHeight = `${result.getBoundingClientRect().height}px`;
  }

  try {
    const response = await fetch("/api/random-jump-title", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "作品情報を取得できませんでした。");
    }

    setLinkedText(document.querySelector("#title"), data.title, data.title_url);
    setLinkedText(document.querySelector("#author"), data.author, data.author_url);
    document.querySelector("#start-issue").textContent = data.start_issue;
    document.querySelector("#end-issue").textContent = data.end_issue;
    const amazonSearch = document.querySelector("#amazon-search");
    const searchParams = new URLSearchParams({
      k: `${data.title} ${data.author}`,
      tag: "takeenoki-22",
    });
    amazonSearch.href = `https://www.amazon.co.jp/s?${searchParams}`;
    amazonSearch.textContent = `${data.title}をアマゾンで探す`;
    result.hidden = false;
    status.textContent = "作品を表示しました。";
  } catch (error) {
    status.textContent = error instanceof Error
      ? error.message
      : "作品情報を取得できませんでした。";
  } finally {
    button.disabled = false;
  }
});
