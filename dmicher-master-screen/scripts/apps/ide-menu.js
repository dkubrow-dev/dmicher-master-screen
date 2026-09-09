/** Transient menu popovers never rerender the editor or touch its selection/drafts. */
export function bindIDEMenus(root) {
  const view = root.ownerDocument.defaultView, events = new view.AbortController(), options = { signal: events.signal };
  const popups = [...root.querySelectorAll("[data-menu-popup]")];
  const isOpen = (popup) => popup.matches(":popover-open");
  const triggerFor = (popup) => root.querySelector(`[aria-controls="${popup.id}"]`);
  const chain = (popup) => {
    const ids = new Set();
    while (popup) { ids.add(popup.dataset.menuPopup); popup = popups.find((item) => item.dataset.zone === popup.dataset.zone && item.dataset.menuPopup === popup.dataset.parentMenu); }
    return ids;
  };
  const close = (zone, preserve = new Set()) => {
    for (const popup of popups) if ((!zone || popup.dataset.zone === zone) && !preserve.has(popup.dataset.menuPopup)) {
      if (isOpen(popup)) popup.hidePopover(); triggerFor(popup)?.setAttribute("aria-expanded", "false");
    }
  };
  const open = (button, { focus = false } = {}) => {
    const popup = root.querySelector(`#${button.getAttribute("aria-controls")}`); if (!popup) return;
    const alreadyOpen = isOpen(popup); close(button.dataset.zone, chain(popup));
    if (alreadyOpen && !focus) { close(button.dataset.zone); return; }
    const rect = button.getBoundingClientRect(), nested = Boolean(button.closest("[data-menu-popup]"));
    popup.showPopover(); button.setAttribute("aria-expanded", "true");
    const box = popup.getBoundingClientRect();
    const left = nested ? rect.right + 1 : rect.left, top = nested ? rect.top : rect.bottom;
    popup.style.left = `${Math.max(3, Math.min(left, view.innerWidth - box.width - 3))}px`;
    popup.style.top = `${Math.max(3, Math.min(top, view.innerHeight - box.height - 3))}px`;
    if (focus) popup.querySelector("button")?.focus();
  };
  for (const popup of popups) popup.addEventListener("pointerleave", (event) => {
    const next = event.relatedTarget?.closest?.("[data-menu-popup]");
    if (next?.dataset.zone === popup.dataset.zone) return;
    close(popup.dataset.zone);
  }, options);
  root.ownerDocument.addEventListener("pointerdown", (event) => { if (!event.target.closest?.("[data-menu-popup], [aria-haspopup=menu]")) close(); }, options);
  root.addEventListener("keydown", (event) => {
    const button = event.target.closest('[role="menuitem"]'); if (!button || !root.contains(button)) return;
    const popup = button.closest("[data-menu-popup]"), container = popup ?? button.closest("[role=menubar]");
    const buttons = [...container.querySelectorAll(':scope > button')], index = buttons.indexOf(button);
    let next;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); const trigger = popup && triggerFor(popup); close(button.dataset.zone); trigger?.focus(); return; }
    if (event.key === "Tab") { close(); return; }
    if (button.hasAttribute("aria-haspopup") && ["ArrowDown", "ArrowRight"].includes(event.key) && (popup || event.key === "ArrowDown")) { event.preventDefault(); event.stopPropagation(); open(button, { focus: true }); return; }
    if (popup && event.key === "ArrowLeft") { event.preventDefault(); const trigger = triggerFor(popup); close(button.dataset.zone, chain(popups.find((item) => item.dataset.menuPopup === popup.dataset.parentMenu && item.dataset.zone === popup.dataset.zone))); trigger?.focus(); return; }
    const direction = popup ? { ArrowUp: -1, ArrowDown: 1 }[event.key] : { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (direction) next = buttons[(index + direction + buttons.length) % buttons.length];
    if (event.key === "Home") next = buttons[0]; if (event.key === "End") next = buttons.at(-1);
    if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); next.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }, options);
  view.addEventListener("resize", () => close(), options);
  return { open, close, dispose() { close(); events.abort(); } };
}
