const cards = document.querySelectorAll(".service-card");

function updateCards() {
  if (document.getElementById("service-panel").hidden) return;
  for (const card of cards) {
    const description = card.querySelector(".description");
    const button = card.querySelector("button");
    const expanded = button.getAttribute("aria-expanded") === "true";
    const cardWidth = card.getBoundingClientRect().width;
    card.style.height = expanded ? "auto" : `${cardWidth}px`;
    card.style.minHeight = expanded ? `${cardWidth}px` : "0";
    card.classList.remove("collapsible");
    const cardStyle = getComputedStyle(card);
    const descriptionStyle = getComputedStyle(description);
    const availableHeight = cardWidth
      - parseFloat(cardStyle.paddingTop)
      - parseFloat(cardStyle.paddingBottom)
      - parseFloat(cardStyle.borderTopWidth)
      - parseFloat(cardStyle.borderBottomWidth)
      - card.querySelector("h3").getBoundingClientRect().height
      - parseFloat(descriptionStyle.marginTop)
      - parseFloat(descriptionStyle.marginBottom);
    const truncated = description.scrollHeight > availableHeight;
    button.hidden = !truncated;
    card.classList.toggle("collapsible", truncated);
    if (!truncated) {
      button.setAttribute("aria-expanded", "false");
      button.textContent = "もっと読む";
      card.classList.remove("expanded");
      card.style.height = `${cardWidth}px`;
      card.style.minHeight = "0";
    } else if (!expanded) {
      const buttonHeight = button.getBoundingClientRect().height;
      const descriptionPadding = parseFloat(descriptionStyle.paddingTop)
        + parseFloat(descriptionStyle.paddingBottom);
      const lines = Math.max(1, Math.floor(
        (availableHeight - buttonHeight - descriptionPadding)
          / parseFloat(descriptionStyle.lineHeight)
      ));
      card.style.setProperty("--description-lines", String(lines));
      description.style.maxHeight = `${Math.max(0, availableHeight - buttonHeight)}px`;
    }
    if (!truncated || expanded) {
      description.style.maxHeight = "";
    }
  }
}

for (const card of cards) {
  const button = card.querySelector("button");
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "閉じる" : "もっと読む";
    card.classList.toggle("expanded", expanded);
    updateCards();
  });
}

updateCards();
window.addEventListener("resize", updateCards);
document.fonts.ready.then(updateCards);

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  }
  if (selected.id === "service-tab") updateCards();
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
    if (event.key === "ArrowLeft") next = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === "Home") next = tabs[0];
    if (event.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    next.focus();
  });
}
