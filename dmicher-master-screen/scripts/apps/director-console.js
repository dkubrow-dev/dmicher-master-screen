import { text as t } from "../localization.js";
import { debugEnabled } from "../debug.js";
import { clearDiagnostics, getDiagnosticEntries, subscribeDiagnostics } from "../diagnostics.js";
import { escapeHTML as esc } from "./form-fields.js";

const signalEvents = () => ({
  emitted: t("Сигнал создан", "Signal emitted"),
  "subscriber.accepted": t("Подписчик принял", "Subscriber accepted"),
  "subscriber.completed": t("Подписчик отработал", "Subscriber completed"),
  "subscriber.failed": t("Ошибка подписчика", "Subscriber failed"),
  "subscriber.stale": t("Исполнение устарело", "Execution became stale"),
  "subscriber.skipped": t("Подписчик пропущен", "Subscriber skipped"),
  completed: t("Сигнал обработан", "Signal completed"),
  rejected: t("Сигнал отклонён", "Signal rejected")
});
const levelName = (level) => ({ debug: t("Отладка", "Debug"), signal: t("Сигнал", "Signal"), error: t("Ошибка", "Error") })[level] ?? level;
const resultNames = () => ({ stale: t("Исполнение устарело", "Execution became stale"), failed: t("Ошибка", "Failed"),
  removed: t("Подписка удалена", "Subscription removed"), "player-character": t("Персонаж игрока", "Player character"),
  disabled: t("Отключён", "Disabled"), halted: t("Остановлен", "Stopped"), blocked: t("Запуск заблокирован", "Execution blocked") });
const formatTime = (at) => {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return String(at ?? "");
  return `${date.toLocaleTimeString([], { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
};

export function diagnosticSummary(entry) {
  const context = entry.context ?? {};
  const participants = [context.emitterName ?? context.emitterKey, context.subscriberName ?? context.subscriberKey].filter(Boolean).join(" → ");
  return [context.signalName, participants, context.objectName ?? context.objectKey, context.scriptName,
    context.stepId ? `${t("Шаг", "Step")} ${context.stepId}` : null,
    resultNames()[context.status] ?? resultNames()[context.reason], context.allowed === false ? t("Отказ", "Rejected") : null,
    entry.error?.message].filter(Boolean).join(" · ");
}

export function renderDiagnosticEntry(entry) {
  const title = entry.category === "signal" ? signalEvents()[entry.event] ?? entry.event : entry.event;
  const details = { ...entry.context, ...(entry.error ? { error: entry.error } : {}) };
  return `<tr data-console-entry="${esc(entry.id)}" data-level="${esc(entry.level)}"><td class="ms-console-time"><time datetime="${esc(entry.at)}">${esc(formatTime(entry.at))}</time><small>${esc(levelName(entry.level))}</small></td><td><details><summary><span class="ms-console-event">${esc(title)}</span><code>${esc(entry.category)}.${esc(entry.event)}</code><span class="ms-console-summary">${esc(diagnosticSummary(entry))}</span></summary><pre>${esc(JSON.stringify(details, null, 2))}</pre></details></td></tr>`;
}

export function renderDirectorConsole() {
  return `<section class="ms-director-console" data-director-console aria-label="${t("Консоль сцены", "Scene console")}"><div class="ms-console-toolbar"><span class="ms-note" data-console-filter></span><button type="button" data-console-clear title="${t("Очистить локальный журнал сцены", "Clear this scene's local log")}"><i class="fa-solid fa-trash"></i><span>${t("Очистить", "Clear")}</span></button></div><div class="ms-console-scroll" data-console-scroll tabindex="0" aria-label="${t("Записи консоли", "Console entries")}"><table class="ms-console-table"><thead><tr><th>${t("Время", "Time")}</th><th>${t("Событие и участники", "Event and participants")}</th></tr></thead><tbody data-console-entries></tbody></table><p class="ms-note" data-console-empty>${t("Для этой сцены пока нет записей.", "No entries for this scene yet.")}</p></div></section>`;
}

/** Subscribe only while the Console is visible. Updating rows never renders the
 * IDE, touches a draft, or writes Foundry documents. DOM nodes are retained so
 * expanded details and a reader's scroll position survive incoming messages. */
export class DirectorConsole {
  constructor({ read = getDiagnosticEntries, subscribe = subscribeDiagnostics, clear = clearDiagnostics, isDebugEnabled = debugEnabled,
    schedule = (callback) => setTimeout(callback, 100), cancel = (timer) => clearTimeout(timer) } = {}) {
    this.read = read; this.subscribe = subscribe; this.clear = clear; this.isDebugEnabled = isDebugEnabled;
    this.schedule = schedule; this.cancel = cancel;
    this.rows = new Map();
  }

  attach(root, sceneId) {
    this.dispose();
    if (!root || !sceneId) return;
    this.root = root; this.sceneId = sceneId;
    this.scroll = root.querySelector("[data-console-scroll]");
    this.body = root.querySelector("[data-console-entries]");
    this.clearButton = root.querySelector("[data-console-clear]");
    this.onClear = () => this.clear(this.sceneId);
    this.clearButton.addEventListener("click", this.onClear);
    this.unsubscribe = this.subscribe((notice) => {
      if (notice?.type === "append" && notice.sceneId && notice.sceneId !== this.sceneId) return;
      if (this.timer !== undefined) return;
      this.timer = this.schedule(() => { this.timer = undefined; this.refresh(); });
    });
    this.refresh();
    this.restoreViewState();
  }

  captureViewState() {
    if (!this.root?.isConnected) return;
    const top = this.scroll.getBoundingClientRect().top;
    const anchor = [...this.body.children].find((row) => row.getBoundingClientRect().bottom > top);
    this.viewState = { sceneId: this.sceneId, scrollTop: this.scroll.scrollTop,
      follow: this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop <= 24,
      expanded: [...this.rows].filter(([, row]) => row.querySelector("details").open).map(([id]) => id),
      anchorId: anchor ? Number(anchor.dataset.consoleEntry) : null, anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : 0 };
  }

  restoreViewState() {
    const state = this.viewState;
    if (state?.sceneId !== this.sceneId) { this.viewState = null; return; }
    for (const id of state.expanded) { const row = this.rows.get(id); if (row) row.querySelector("details").open = true; }
    if (state.follow) { this.scroll.scrollTop = this.scroll.scrollHeight; return; }
    this.scroll.scrollTop = state.scrollTop;
    const anchor = this.rows.get(state.anchorId);
    if (anchor) this.scroll.scrollTop += anchor.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - state.anchorOffset;
  }

  refresh() {
    if (!this.root) return;
    const includeDebug = this.isDebugEnabled();
    this.root.querySelector("[data-console-filter]").textContent = includeDebug
      ? t("Сигналы, ошибки и отладка", "Signals, errors and debug")
      : t("Сигналы и ошибки", "Signals and errors");
    const entries = this.read({ sceneId: this.sceneId, includeDebug });
    const follow = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop <= 24;
    const previousTop = this.scroll.scrollTop;
    const previousAnchor = [...this.body.children].find((row) => row.getBoundingClientRect().bottom > this.scroll.getBoundingClientRect().top);
    const anchorTop = previousAnchor?.getBoundingClientRect().top;
    const wanted = new Set(entries.map((entry) => entry.id));
    for (const [id, row] of this.rows) if (!wanted.has(id)) { row.remove(); this.rows.delete(id); }
    for (const entry of entries) {
      if (this.rows.has(entry.id)) continue;
      const template = this.root.ownerDocument.createElement("template"); template.innerHTML = renderDiagnosticEntry(entry);
      const row = template.content.firstElementChild; this.rows.set(entry.id, row); this.body.append(row);
    }
    // A debug filter can reveal older entries between retained rows.
    entries.forEach((entry, index) => {
      const row = this.rows.get(entry.id);
      if (this.body.children[index] !== row) this.body.insertBefore(row, this.body.children[index] ?? null);
    });
    this.root.querySelector("[data-console-empty]").hidden = entries.length > 0;
    this.clearButton.disabled = entries.length === 0;
    if (follow) this.scroll.scrollTop = this.scroll.scrollHeight;
    else if (previousAnchor?.isConnected) this.scroll.scrollTop = previousTop + previousAnchor.getBoundingClientRect().top - anchorTop;
    else this.scroll.scrollTop = previousTop;
  }

  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined;
    this.clearButton?.removeEventListener("click", this.onClear);
    this.root = null; this.scroll = null; this.body = null; this.clearButton = null;
    this.rows.clear();
  }
}
