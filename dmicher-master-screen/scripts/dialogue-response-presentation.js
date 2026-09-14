import { text } from "./localization.js";
import { escapeScriptText as esc } from "./script-text.js";

export function dialogueWindowTitle(name) {
  return `${text("Диалог", "Dialogue")}${name ? `. ${name}` : ""}`;
}

/** Whitespace separates words in both supported languages; Unicode code points
 * keep an emoji from counting as two characters at the 80-character boundary. */
export function dialogueUsesResponseButtons(responses) {
  return responses.every(({ label }) => {
    const value = String(label ?? "").trim();
    return Boolean(value) && value.split(/\s+/u).length <= 3 && [...value].length <= 80;
  });
}

/** The caller owns commands and permissions. This renderer only describes the
 * current choices, with a separate radio group per window or chat card. */
export function renderDialogueResponses(responses = [], {
  actionAttribute = "data-action", answerAction = "answer", finishAction = "finish",
  canFinish = false, busy = false, groupName = "dialogue-response", selectedId = ""
} = {}) {
  if (!/^data-[a-z][a-z0-9-]*$/.test(actionAttribute)) throw new TypeError("Invalid dialogue action attribute");
  if (!responses.length && !canFinish) return "";
  const buttons = dialogueUsesResponseButtons(responses);
  const selected = responses.find((response) => response.id === selectedId && !response.disabled);
  const action = (value) => `${actionAttribute}="${esc(value)}"`;
  const page = (response) => response.pageId ? ` data-page-id="${esc(response.pageId)}"` : "";
  const choices = responses.map((response) => {
    const disabled = busy || response.disabled ? " disabled" : "";
    return buttons
      ? `<button type="button" ${action(answerAction)} data-response-id="${esc(response.id)}"${page(response)}${disabled}>${esc(response.label)}</button>`
      : `<label class="ms-dialogue-response-choice"><input type="radio" name="${esc(groupName)}" value="${esc(response.id)}" data-response-id="${esc(response.id)}"${page(response)}${selected === response ? " checked" : ""}${disabled}><span>${esc(response.label)}</span></label>`;
  }).join("");
  const answer = !buttons && responses.length
    ? `<button type="button" ${action(answerAction)} data-dialogue-answer${page(responses[0])}${busy || !selected ? " disabled" : ""}>${text("Ответить", "Reply")}</button>` : "";
  const finish = canFinish
    ? `<button type="button" ${action(finishAction)}${busy ? " disabled" : ""}>${text("Завершить диалог", "Finish dialogue")}</button>` : "";
  return `<div class="ms-dialogue-responses" data-dialogue-responses data-busy="${busy}" data-response-mode="${buttons ? "buttons" : "radio"}"><div class="ms-dialogue-response-options"${buttons ? "" : ` role="radiogroup" aria-label="${text("Варианты ответа", "Response choices")}"`}>${choices}</div><div class="ms-dialogue-response-actions">${answer}${finish}</div></div>`;
}

export function dialogueResponseId(button) {
  return button?.dataset?.responseId
    ?? button?.closest?.("[data-dialogue-responses]")?.querySelector('input[type="radio"]:checked')?.value ?? "";
}

/** Selectors stay inside the owning group: two cards must never share a reply.
 * onSelect lets a caller retain selection across its own harmless rerenders. */
export function bindDialogueResponses(root, onSelect) {
  for (const group of root?.querySelectorAll?.("[data-dialogue-responses]") ?? []) {
    group.onchange = (event) => {
      if (!event.target.matches?.('input[type="radio"]') || event.target.closest("[data-dialogue-responses]") !== group) return;
      const answer = group.querySelector("[data-dialogue-answer]");
      if (answer) answer.disabled = group.dataset.busy === "true" || !group.querySelector('input[type="radio"]:checked:not(:disabled)');
      onSelect?.(event.target.value, group);
    };
  }
}

/** Display snapshots identically in a window, a local preview and a chat card. */
export function dialogueMessages(view, responses = []) {
  // A session without stored history can display only its supplied current page.
  // This is a read-only presentation fallback, never a data migration.
  const history = view?.history?.length ? view.history : view ? [{ id: "current-page", role: "object",
    name: view.targetName, text: view.text, img: view.art, audio: view.audio, imageAlignment: view.imageAlignment }] : [];
  return history.map((entry, index) => ({ ...entry,
    isPlayer: entry.role === "player", imageRight: entry.role === "player" || entry.imageAlignment === "right",
    hasAudio: entry.role === "object" && typeof entry.audio === "string" && Boolean(entry.audio.trim()),
    imageAlignment: entry.role === "player" || entry.imageAlignment === "right" ? "right" : "left",
    responses: index === history.length - 1 ? responses : [] }));
}

/** Accept raw or prepared snapshots, including a one-entry array for chat.
 * Author text is escaped; portrait alignment and replay markup stay shared. */
export function renderDialogueMessages(messages = []) {
  if (!messages.length) return "";
  return dialogueMessages({ history: messages }).map((entry) => {
    const image = entry.img ? `<img class="ms-dialogue-avatar is-${entry.imageAlignment}" src="${esc(entry.img)}" alt="">` : "";
    const replayLabel = text("Повторить звук блока", "Replay page audio");
    const replay = entry.hasAudio ? `<button type="button" class="ms-dialogue-audio-replay" data-dialogue-audio-replay data-message-id="${esc(entry.id)}" hidden disabled aria-label="${replayLabel}" data-tooltip="${replayLabel}"><i class="fa-solid fa-volume-high" aria-hidden="true"></i></button>` : "";
    return `<article class="ms-dialogue-message ${entry.isPlayer ? "is-player" : "is-object"}" data-message-id="${esc(entry.id)}" data-image-alignment="${entry.imageAlignment}"><div class="ms-dialogue-bubble">${image}<strong class="ms-dialogue-speaker">${esc(entry.name)}</strong>${entry.text ? `<p class="ms-dialogue-text">${esc(entry.text)}</p>` : ""}${replay}</div></article>`;
  }).join("");
}
