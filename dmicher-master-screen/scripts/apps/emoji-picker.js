import { text } from "../localization.js";
import { escapeHTML as e } from "./form-fields.js";
import { EMOJI_GROUPS } from "./emoji-catalog.js";

const openPickers = new WeakMap();
let pickerId = 0;
export const EMOJI_COLUMNS = 5;

export function renderEmojiPicker(id, language) {
  const label = (value) => text(value.ru, value.en, language);
  return `<nav aria-label="${e(text("Группы символов", "Symbol groups", language))}">${EMOJI_GROUPS.map((group) => `<a href="#${id}-${group.id}" data-emoji-anchor="${group.id}" title="${e(label(group.label))}" aria-label="${e(label(group.label))}">${group.icon}</a>`).join("")}</nav>
    <div class="ms-emoji-scroll">${EMOJI_GROUPS.map((group) => `<section id="${id}-${group.id}" data-emoji-section="${group.id}" aria-label="${e(label(group.label))}"><h4>${e(label(group.label))}</h4><table aria-label="${e(label(group.label))}"><tbody>${Array.from({ length: Math.ceil(group.items.length / EMOJI_COLUMNS) }, (_, row) => `<tr>${group.items.slice(row * EMOJI_COLUMNS, (row + 1) * EMOJI_COLUMNS).map((item) => `<td><button type="button" data-emoji-value="${e(item.symbol)}" title="${e(label(item))}" aria-label="${e(label(item))}">${e(item.symbol)}</button></td>`).join("")}</tr>`).join("")}</tbody></table></section>`).join("")}</div>`;
}

/** One lightweight picker per document. Native popover supplies Escape and
 * outside-click dismissal; the owning form supplies its lifetime signal. */
export function openEmojiPicker(anchor, { onSelect, signal } = {}) {
  const document = anchor.ownerDocument, view = document.defaultView;
  openPickers.get(document)?.();
  if (!anchor.isConnected || signal?.aborted) return () => {};
  const popup = document.createElement("div"), events = new view.AbortController();
  popup.id = `ms-emoji-picker-${++pickerId}`;
  popup.className = "ms-emoji-picker";
  popup.setAttribute("popover", "auto"); popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", text("Выбрать эмоцию", "Choose emotion")); popup.tabIndex = -1;
  popup.innerHTML = renderEmojiPicker(popup.id);
  anchor.closest(".dmicher-master-screen").append(popup);
  anchor.setAttribute("aria-controls", popup.id); anchor.setAttribute("aria-expanded", "true");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; events.abort(); signal?.removeEventListener("abort", close);
    if (popup.matches(":popover-open")) popup.hidePopover();
    popup.remove(); anchor.removeAttribute("aria-controls"); anchor.setAttribute("aria-expanded", "false");
    if (openPickers.get(document) === close) openPickers.delete(document);
  };
  openPickers.set(document, close); signal?.addEventListener("abort", close, { once: true });
  popup.addEventListener("toggle", (event) => { if (event.newState === "closed") close(); }, { signal: events.signal });
  popup.addEventListener("click", (event) => {
    const group = event.target.closest("[data-emoji-anchor]"), choice = event.target.closest("[data-emoji-value]");
    event.stopPropagation();
    if (group) {
      event.preventDefault();
      popup.querySelector(`[data-emoji-section="${group.dataset.emojiAnchor}"]`).scrollIntoView({ block: "start" });
    } else if (choice) { const symbol = choice.dataset.emojiValue; close(); onSelect?.(symbol); }
  }, { signal: events.signal });
  popup.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); anchor.focus(); return; }
    const choice = event.target.closest("[data-emoji-value]");
    if (!choice || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const choices = [...choice.closest("section").querySelectorAll("[data-emoji-value]")], index = choices.indexOf(choice);
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -EMOJI_COLUMNS, ArrowDown: EMOJI_COLUMNS }[event.key];
    choices[event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + offset + choices.length) % choices.length].focus();
  }, { signal: events.signal });
  // Closing on viewport changes prevents an orphaned picker after moving its host.
  view.addEventListener("resize", close, { signal: events.signal });
  popup.showPopover();
  const bounds = anchor.getBoundingClientRect(), width = popup.offsetWidth, height = popup.offsetHeight;
  const left = Math.max(4, Math.min(bounds.right - width, view.innerWidth - width - 4));
  const top = bounds.bottom + height + 4 <= view.innerHeight ? bounds.bottom + 3 : Math.max(4, bounds.top - height - 3);
  popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  popup.querySelector("a")?.focus();
  return close;
}
