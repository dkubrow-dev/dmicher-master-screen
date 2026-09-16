import { text as t } from "./localization.js";
import { highlightChordMatches, normalizeHighlightKeys } from "./interaction-settings-model.js";

export function highlightKeyName(code) {
  const side = code.endsWith("Left") ? t("Левый", "Left") : t("Правый", "Right");
  if (/^(Alt|Control|Shift|Meta)(Left|Right)$/.test(code)) return `${side} ${code.replace(/Left|Right/, "").replace("Control", "Ctrl").replace("Meta", "Meta")}`;
  return code.replace(/^Key|^Digit/, "");
}
export const highlightChordLabel = keys => keys.map(highlightKeyName).join(" + ");
export const isTypingTarget = target => Boolean(target?.closest?.("input, textarea, select, [contenteditable=true], dialog"));

/** One listener set and one three-second hold timer; key repeat never restarts it. */
export function listenForHighlightChord(target, { onChange, onConfirm, onCancel, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pressed = new Set(); let timer = null, stopped = false;
  const resetTimer = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const down = event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.code === "Escape") { onCancel(); return; }
    if (event.repeat || pressed.has(event.code)) return;
    if (!normalizeHighlightKeys([event.code], []).length) return;
    pressed.add(event.code); resetTimer();
    const keys = normalizeHighlightKeys([...pressed], []);
    onChange(keys);
    if (keys.length) timer = setTimer(() => { timer = null; if (!stopped && highlightChordMatches(pressed, keys)) onConfirm(keys); }, 3000);
  };
  const up = event => { event.preventDefault(); event.stopImmediatePropagation(); pressed.delete(event.code); resetTimer(); onChange([...pressed].sort()); };
  const blur = () => { pressed.clear(); resetTimer(); onChange([]); };
  target.addEventListener("keydown", down, true); target.addEventListener("keyup", up, true); target.addEventListener("blur", blur);
  return () => { stopped = true; resetTimer(); target.removeEventListener("keydown", down, true); target.removeEventListener("keyup", up, true); target.removeEventListener("blur", blur); };
}

export function captureHighlightChord(ownerDocument = document) {
  return new Promise(resolve => {
    const dialog = ownerDocument.createElement("dialog"); dialog.className = "dmicher-master-screen ms-highlight-key-dialog";
    const heading = ownerDocument.createElement("h3"), hint = ownerDocument.createElement("p"), output = ownerDocument.createElement("output"), cancel = ownerDocument.createElement("button");
    heading.textContent = t("Комбинация подсветки", "Highlight shortcut");
    hint.textContent = t("Чтобы задать новую комбинацию, зажмите её на 3 секунды. Для отмены закройте окно или нажмите Escape.", "Hold the new shortcut for 3 seconds. Close this window or press Escape to cancel.");
    output.textContent = t("Нажмите комбинацию", "Press a shortcut"); output.setAttribute("aria-live", "polite");
    cancel.type = "button"; cancel.textContent = t("Отмена", "Cancel");
    dialog.append(heading, hint, output, cancel); ownerDocument.body.append(dialog);
    let settled = false, dispose = () => {};
    const finish = value => { if (settled) return; settled = true; dispose(); dialog.close(); dialog.remove(); resolve(value); };
    dispose = listenForHighlightChord(ownerDocument.defaultView, {
      onChange: keys => { output.textContent = keys.length ? `${highlightChordLabel(keys)} · 3 ${t("сек.", "sec.")}` : t("Нажмите комбинацию", "Press a shortcut"); },
      onConfirm: finish, onCancel: () => finish(null)
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.addEventListener("close", () => finish(null));
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) finish(null);
    });
    cancel.addEventListener("click", () => finish(null)); dialog.showModal(); cancel.focus();
  });
}
