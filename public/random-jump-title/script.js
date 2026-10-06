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
  result.hidden = true;

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
