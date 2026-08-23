const items = document.getElementById("items");
window.desktopPet.onDialogTheme(theme => window.AsterPet.applyDialogTheme(theme));
window.desktopPet.getDialogThemes()
  .then(state => window.AsterPet.applyDialogTheme(state.current))
  .catch(() => {});
window.desktopPet.onPopoverData(payload => {
  document.documentElement.style.setProperty("--ui-scale", String(payload.scale || 1));
  items.replaceChildren();
  for (const item of payload.items) {
    const button = document.createElement("button");
    button.textContent = item.label;
    button.onclick = () => window.desktopPet.selectPopoverItem({ selectId: payload.selectId, value: item.value });
    items.append(button);
  }
});
