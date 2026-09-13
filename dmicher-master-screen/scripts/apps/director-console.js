import { text as t } from "../localization.js";
import { debugEnabled } from "../debug.js";
import { clearDiagnostics, getDiagnosticUpdate, subscribeDiagnostics } from "../diagnostics.js";
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
const commandEvents = () => ({ requested: t("Команда принята", "Command received"), completed: t("Команда выполнена", "Command completed"),
  scheduled: t("Восстановление запущено", "Restoration scheduled"), cancelled: t("Команда отменена новой командой", "Command superseded"), failed: t("Ошибка команды", "Command failed") });
const commandNames = () => ({ "start-all": t("Запустить всё", "Start all"), "resume-all": t("Продолжить всё", "Resume all"),
  "stop-all": t("Остановить всё", "Stop all"), "restore-initial": t("Вернуть в исходное состояние", "Restore initial state"),
  "start-group": t("Запуск группы", "Start group"), "stop-group": t("Остановка группы", "Stop group"), "restore-group-initial": t("Восстановление группы", "Restore group") });
const levelName = (level) => ({ debug: t("Отладка", "Debug"), signal: t("Сигнал", "Signal"), command: t("Команда", "Command"), error: t("Ошибка", "Error") })[level] ?? level;
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
  return [commandNames()[context.command], context.initiatorName ?? context.initiatorId, entry.category === "control" ? context.sceneName ?? context.sceneId : null,
    context.groupName, context.signalName, participants, context.objectName ?? context.objectKey, context.scriptName,
    context.stepId ? `${t("Шаг", "Step")} ${context.stepId}` : null,
    resultNames()[context.status] ?? resultNames()[context.reason], context.allowed === false ? t("Отказ", "Rejected") : null,
    entry.error?.message].filter(Boolean).join(" · ");
}

export function renderDiagnosticEntry(entry) {
  const title = (entry.category === "signal" ? signalEvents() : entry.category === "control" ? commandEvents() : {})[entry.event] ?? entry.event;
  return `<tr data-console-entry="${esc(entry.id)}" data-level="${esc(entry.level)}"><td class="ms-console-time"><time datetime="${esc(entry.at)}">${esc(formatTime(entry.at))}</time><small>${esc(levelName(entry.level))}</small></td><td><details><summary><span class="ms-console-event">${esc(title)}</span><code>${esc(entry.category)}.${esc(entry.event)}</code><span class="ms-console-summary">${esc(diagnosticSummary(entry))}</span></summary><pre data-console-details></pre></details></td></tr>`;
}

export function diagnosticDetails(entry) {
  return JSON.stringify({ ...entry.context, ...(entry.error ? { error: entry.error } : {}) }, null, 2);
}

function scrollAnchor(body, scroll) {
  const top = scroll.getBoundingClientRect().top;
  let low = 0, high = body.children.length;
  // Rows are ordered vertically; finding one visible row never scans 500 rects.
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (body.children[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  const row = body.children[low];
  return row ? { row, id: Number(row.dataset.consoleEntry), offset: row.getBoundingClientRect().top - top } : null;
}

export function renderDirectorConsole() {
  return `<section class="ms-director-console" data-director-console aria-label="${t("Консоль сцены", "Scene console")}"><div class="ms-console-toolbar"><span class="ms-note" data-console-filter></span><button type="button" data-console-clear title="${t("Очистить локальный журнал сцены", "Clear this scene's local log")}"><i class="fa-solid fa-trash"></i><span>${t("Очистить", "Clear")}</span></button></div><div class="ms-console-scroll" data-console-scroll tabindex="0" aria-label="${t("Записи консоли", "Console entries")}"><table class="ms-console-table"><thead><tr><th>${t("Время", "Time")}</th><th>${t("Событие и участники", "Event and participants")}</th></tr></thead><tbody data-console-entries></tbody></table><p class="ms-note" data-console-empty>${t("Для этой сцены пока нет записей.", "No entries for this scene yet.")}</p></div></section>`;
}

/** Subscribe only while the Console is visible. Updating rows never renders the
 * IDE, touches a draft, or writes Foundry documents. DOM nodes are retained so
 * expanded details and a reader's scroll position survive incoming messages. */
export class DirectorConsole {
  constructor({ read = getDiagnosticUpdate, subscribe = subscribeDiagnostics, clear = clearDiagnostics, isDebugEnabled = debugEnabled,
    schedule = (callback) => setTimeout(callback, 250), cancel = (timer) => clearTimeout(timer) } = {}) {
    this.read = read; this.subscribe = subscribe; this.clear = clear; this.isDebugEnabled = isDebugEnabled;
    this.schedule = schedule; this.cancel = cancel;
    this.rows = new Map(); this.entries = new Map();
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
    this.onToggle = (event) => { if (event.target.open) this.fillDetails(event.target); };
    this.body.addEventListener("toggle", this.onToggle, true);
    this.unsubscribe = this.subscribe((notice) => {
      if (notice?.type === "append" && notice.sceneId && notice.sceneId !== this.sceneId) return;
      if (notice?.type === "clear") this.reset = true;
      if (this.timer !== undefined) return;
      this.timer = this.schedule(() => { this.timer = undefined; this.refresh(); });
    });
    this.refresh();
    this.restoreViewState();
  }

  captureViewState() {
    if (!this.root?.isConnected) return;
    const follow = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop <= 24;
    const anchor = follow ? null : scrollAnchor(this.body, this.scroll);
    this.viewState = { sceneId: this.sceneId, scrollTop: this.scroll.scrollTop,
      follow,
      expanded: [...this.rows].filter(([, row]) => row.querySelector("details").open).map(([id]) => id),
      anchorId: anchor?.id ?? null, anchorOffset: anchor?.offset ?? 0 };
  }

  restoreViewState() {
    const state = this.viewState;
    if (state?.sceneId !== this.sceneId) { this.viewState = null; return; }
    for (const id of state.expanded) { const row = this.rows.get(id); if (row) { const details = row.querySelector("details"); this.fillDetails(details); details.open = true; } }
    if (state.follow) { this.scroll.scrollTop = this.scroll.scrollHeight; return; }
    this.scroll.scrollTop = state.scrollTop;
    const anchor = this.rows.get(state.anchorId);
    if (anchor) this.scroll.scrollTop += anchor.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - state.anchorOffset;
  }

  refresh() {
    if (!this.root) return;
    const includeDebug = this.isDebugEnabled();
    const reset = this.reset || this.includeDebug !== includeDebug;
    if (reset) this.root.querySelector("[data-console-filter]").textContent = includeDebug
        ? t("Команды, сигналы, ошибки и отладка", "Commands, signals, errors and debug")
        : t("Команды, сигналы и ошибки", "Commands, signals and errors");
    const update = this.read({ sceneId: this.sceneId, includeDebug, afterId: reset ? 0 : this.cursor });
    this.cursor = update.cursor; this.includeDebug = includeDebug; this.reset = false;
    const entries = update.entries, first = this.rows.keys().next().value;
    if (!reset && entries.length === 0 && !(first < update.firstId)) return;
    const follow = this.scroll.scrollHeight - this.scroll.clientHeight - this.scroll.scrollTop <= 24;
    const previousTop = this.scroll.scrollTop;
    const anchor = !follow && (reset || first < update.firstId) ? scrollAnchor(this.body, this.scroll) : null;
    if (reset) {
      const wanted = new Set(entries.map(entry => entry.id));
      for (const [id, row] of this.rows) if (!wanted.has(id)) { row.remove(); this.rows.delete(id); this.entries.delete(id); }
    } else {
      // The Map is insertion-ordered; expired rows form a prefix.
      for (const [id, row] of this.rows) {
        if (id >= update.firstId) break;
        row.remove(); this.rows.delete(id); this.entries.delete(id);
      }
    }
    const added = entries.filter(entry => !this.rows.has(entry.id));
    if (added.length) {
      const template = this.root.ownerDocument.createElement("template");
      template.innerHTML = `<table><tbody>${added.map(renderDiagnosticEntry).join("")}</tbody></table>`;
      const fragment = this.root.ownerDocument.createDocumentFragment();
      for (const row of [...template.content.querySelector("tbody").children]) {
        this.rows.set(Number(row.dataset.consoleEntry), row); fragment.append(row);
      }
      this.body.append(fragment);
    }
    for (const entry of added) this.entries.set(entry.id, entry);
    // Only a changed filter can reveal older entries between retained rows.
    // Ordinary appends do not visit or move existing DOM nodes.
    if (reset) {
      const ordered = new Map();
      for (const entry of entries) ordered.set(entry.id, this.rows.get(entry.id));
      this.rows = ordered;
      let next = this.body.firstElementChild;
      for (const row of this.rows.values()) {
        if (row !== next) this.body.insertBefore(row, next);
        next = row.nextElementSibling;
      }
    }
    this.root.querySelector("[data-console-empty]").hidden = this.rows.size > 0;
    this.clearButton.disabled = this.rows.size === 0;
    if (follow) this.scroll.scrollTop = this.scroll.scrollHeight;
    else if (anchor?.row.isConnected) this.scroll.scrollTop = previousTop + anchor.row.getBoundingClientRect().top - this.scroll.getBoundingClientRect().top - anchor.offset;
    else if (anchor) this.scroll.scrollTop = previousTop;
  }

  fillDetails(details) {
    const pre = details.querySelector("[data-console-details]");
    if (!pre || pre.dataset.loaded) return;
    const entry = this.entries.get(Number(details.closest("[data-console-entry]")?.dataset.consoleEntry));
    if (!entry) return;
    pre.textContent = diagnosticDetails(entry); pre.dataset.loaded = "true";
  }

  dispose() {
    this.unsubscribe?.(); this.unsubscribe = null;
    if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined;
    this.clearButton?.removeEventListener("click", this.onClear);
    this.body?.removeEventListener("toggle", this.onToggle, true);
    this.root = null; this.scroll = null; this.body = null; this.clearButton = null;
    this.rows.clear(); this.entries.clear(); this.cursor = 0; this.reset = true; this.includeDebug = undefined;
  }
}
