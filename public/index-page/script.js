const cards = document.querySelectorAll(".service-card");

function updateCards() {
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
