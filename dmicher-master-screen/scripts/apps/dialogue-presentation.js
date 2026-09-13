import { text } from "../localization.js";
import { DialogueAudioController } from "../dialogue-audio.js";
import { onExecutionChange } from "../execution.js";

/** Display snapshots identically for live dialogue and local GM reading. */
export function dialogueMessages(view, responses = []) {
  // Old open-session snapshots expose their current page only. Do not invent
  // past replies or write reconstructed history into scene data.
  const history = view?.history?.length ? view.history : view ? [{ id: "current-page", role: "object",
    name: view.targetName, text: view.text, img: view.art, audio: view.audio, imageAlignment: view.imageAlignment }] : [];
  return history.map((entry, index) => ({ ...entry,
    isPlayer: entry.role === "player", imageRight: entry.role === "player" || entry.imageAlignment === "right",
    hasAudio: entry.role === "object" && typeof entry.audio === "string" && Boolean(entry.audio.trim()),
    imageAlignment: entry.role === "player" || entry.imageAlignment === "right" ? "right" : "left",
    responses: index === history.length - 1 ? responses : [] }));
}

function updateAudioButtons(application) {
  for (const button of application.element?.querySelectorAll?.("[data-dialogue-audio-replay]") ?? []) {
    const state = application.dialogueAudio?.messageState(button.dataset.messageId);
    button.hidden = !(state?.available && state.canReplay && !state.playing);
    button.disabled = button.hidden;
  }
}

/** Audio is tied to displayed snapshots, never to form preparation or rerenders.
 * Updating only replay buttons also preserves the reader's scroll position. */
export function renderDialogueAudio(application, history, lifecycle) {
  application.dialogueAudio ??= new DialogueAudioController({ onChange: () => updateAudioButtons(application) });
  watchAudioExecution(application, lifecycle);
  application.dialogueAudio.sync(history ?? []);
  application.dialogueAudioCancellation?.check();
  for (const button of application.element?.querySelectorAll?.("[data-dialogue-audio-replay]") ?? []) {
    button.onclick = (event) => {
      event.preventDefault(); event.stopPropagation();
      void application.dialogueAudio?.replay(button.dataset.messageId);
    };
  }
  updateAudioButtons(application);
}

/** Live dialogue supplies its execution predicate. Local GM reading deliberately
 * omits it, so an emergency stop does not disable deliberate manual playback. */
function watchAudioExecution(application, lifecycle) {
  const previous = application.dialogueAudioCancellation;
  if (previous?.scene === lifecycle?.scene) { if (previous) previous.isCurrent = lifecycle.isCurrent; return; }
  previous?.dispose(); application.dialogueAudioCancellation = null;
  if (!lifecycle?.scene) return;
  const watch = { ...lifecycle };
  watch.check = (reason) => {
    if (reason === "canvas-teardown" || reason === "halt-all" || !watch.isCurrent()) {
      application.dialogueAudio?.stop(); updateAudioButtons(application);
    }
  };
  const unsubscribe = onExecutionChange(watch.scene, watch.check);
  const hook = globalThis.Hooks?.on("updateScene", scene => { if (scene.id === watch.scene.id) watch.check(); });
  watch.dispose = () => { unsubscribe(); if (hook !== undefined) Hooks.off("updateScene", hook); };
  application.dialogueAudioCancellation = watch;
}

export function disposeDialogueAudio(application) {
  application.dialogueAudioCancellation?.dispose(); application.dialogueAudioCancellation = null;
  application.dialogueAudio?.dispose();
  application.dialogueAudio = null;
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
