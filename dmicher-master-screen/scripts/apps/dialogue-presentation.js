import { text } from "../localization.js";

/** Display snapshots identically for live dialogue and local GM reading. */
export function dialogueMessages(view, responses = []) {
  // Old open-session snapshots expose their current page only. Do not invent
  // past replies or write reconstructed history into scene data.
  const history = view?.history?.length ? view.history : view ? [{ id: "current-page", role: "object",
    name: view.targetName, text: view.text, img: view.art, imageAlignment: view.imageAlignment }] : [];
  return history.map((entry, index) => ({ ...entry,
    isPlayer: entry.role === "player", imageRight: entry.role === "player" || entry.imageAlignment === "right",
    imageAlignment: entry.role === "player" || entry.imageAlignment === "right" ? "right" : "left",
    responses: index === history.length - 1 ? responses : [] }));
}

export function captureDialogueScroll(application) {
  const history = application.element?.querySelector?.(".ms-dialogue-history");
  if (history) application.scrollState = { top: history.scrollTop, atEnd: history.scrollHeight - history.clientHeight - history.scrollTop < 36 };
}

export function restoreDialogueScroll(application) {
  const history = application.element?.querySelector?.(".ms-dialogue-history");
  if (history) history.scrollTop = !application.scrollState || application.scrollState.atEnd ? history.scrollHeight : application.scrollState.top;
}

export function confirmDialogueClose() {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: text("Завершить и закрыть диалог?", "Finish and close the dialogue?") },
    content: `<p>${text("Диалог будет завершён, а окно закрыто. Продолжить?", "The dialogue will end and its window will close. Continue?")}</p>`, rejectClose: false
  });
}
