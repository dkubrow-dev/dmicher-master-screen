import { text as t } from "../localization.js";
import { readDirectorActivity } from "../director-activity.js";
import { escapeHTML as esc } from "./form-fields.js";

const cell = name => `<span data-activity-cell="${name}"></span>`;
const action = (id, label) => `<button type="button" data-activity-action="${id}">${esc(label)}</button>`;

export function renderDirectorActivity() {
  return `<section class="ms-director-activity" data-director-activity>
    <h3>${t("Взаимодействия сцены", "Scene interactions")}</h3>
    <table class="ms-activity-table"><thead><tr><th>${t("Персонаж", "Character")}</th><th>${t("Взаимодействие", "Interaction")}</th><th>${t("Состояние", "Status")}</th></tr></thead><tbody data-activity-interactions></tbody></table>
    <p class="ms-note" data-activity-empty-interactions>${t("Нет активных диалогов и обменов.", "No active conversations or trades.")}</p>
    <h3>${t("Объекты группы", "Group objects")} <span data-activity-group-name></span></h3>
    <table class="ms-activity-table"><thead><tr><th>${t("Объект", "Object")}</th><th>${t("Скрипт и шаг", "Script and step")}</th><th>${t("Состояние", "Status")}</th></tr></thead><tbody data-activity-executions></tbody></table>
    <p class="ms-note" data-activity-empty-executions>${t("Выберите группу на вкладке «Сцена». Здесь появятся её объекты и выполняемые шаги.", "Select a group on Scene to see its objects and executing steps here.")}</p>
  </section>`;
}

function rowHTML(type, key) {
  if (type === "interactions") return `<tr data-activity-key="${esc(key)}"><td>${cell("actor")}<small>${cell("user")}</small><small>${cell("listeners")}</small></td>
    <td>${cell("kind")}<strong>${cell("name")}</strong><small>${cell("object")}</small><small>${cell("group")}</small></td>
    <td>${cell("status")}<div class="ms-activity-actions">${action("join", t("Подключиться", "Join"))}${action("finish", t("Завершить", "Finish"))}</div></td></tr>`;
  return `<tr data-activity-key="${esc(key)}"><td><button type="button" class="ms-activity-object" data-activity-action="focus">${cell("object")}</button></td>
    <td>${cell("command")}<strong>${cell("script")}</strong><small>${cell("phase")}</small>${cell("step")}</td><td>${cell("status")}</td></tr>`;
}

/** Updated by the existing Scene change path only while attached. Stable row and
 * button nodes preserve focus; changing clocks cannot replace any DOM. One lease
 * deadline (not polling) removes expired interactions even on an otherwise idle scene. */
export class DirectorActivity {
  constructor({ read = readDirectorActivity, onAction = () => {}, onError = () => {}, now = Date.now,
    schedule = (callback, delay) => setTimeout(callback, delay), cancel = timer => clearTimeout(timer) } = {}) {
    Object.assign(this, { read, onAction, onError, now, schedule, cancel });
    this.rows = { interactions: new Map(), executions: new Map() };
    this.entries = new Map();
  }

  attach(root, scene, options) {
    this.dispose();
    if (!root || !scene) return;
    this.root = root; this.scene = scene; this.options = options;
    this.onClick = event => {
      const button = event.target.closest("[data-activity-action]");
      if (!button || button.disabled || !this.root.contains(button)) return;
      event.preventDefault();
      const key = button.closest("[data-activity-key]")?.dataset.activityKey;
      this.refresh();
      const entry = this.entries.get(key);
      if (!entry) return;
      button.disabled = true;
      Promise.resolve().then(() => this.onAction(button.dataset.activityAction, entry))
        .catch(this.onError).finally(() => { if (button.isConnected) button.disabled = false; });
    };
    root.addEventListener("click", this.onClick);
    this.refresh();
  }

  refresh(scene = this.scene) {
    if (!this.root || !this.root.isConnected || scene?.id !== this.scene?.id) return;
    const view = this.read(scene, { ...this.options?.(), now: this.now() });
    this.updateRows("interactions", view.interactions);
    this.updateRows("executions", view.executions);
    const title = this.root.querySelector("[data-activity-group-name]");
    const groupName = view.groupName ? `: ${view.groupName}` : "";
    if (title.textContent !== groupName) title.textContent = groupName;
    if (view.expiresAt !== this.deadline) {
      if (this.timer !== undefined) this.cancel(this.timer);
      this.timer = undefined; this.deadline = view.expiresAt;
      if (view.expiresAt !== null) this.timer = this.schedule(() => { this.timer = undefined; this.deadline = null; this.refresh(); }, Math.max(1, view.expiresAt - this.now() + 1));
    }
  }

  updateRows(type, entries) {
    const rows = this.rows[type], body = this.root.querySelector(`[data-activity-${type}]`), wanted = new Set(entries.map(entry => entry.key));
    for (const [key, row] of rows) if (!wanted.has(key)) { row.remove(); rows.delete(key); this.entries.delete(key); }
    let next = body.firstElementChild;
    for (const entry of entries) {
      let row = rows.get(entry.key);
      if (!row) {
        const template = this.root.ownerDocument.createElement("template");
        template.innerHTML = `<table><tbody>${rowHTML(type, entry.key)}</tbody></table>`;
        row = template.content.querySelector("tr"); rows.set(entry.key, row);
      }
      this.entries.set(entry.key, entry);
      const snapshot = JSON.stringify(entry);
      if (row.activitySnapshot !== snapshot) {
        const display = { ...entry, kind: entry.kind === "shop" ? t("Магазин", "Shop") : t("Диалог", "Dialogue"),
          listeners: entry.listeners ? `${t("Слушают", "Listening")}: ${entry.listeners}` : "" };
        for (const field of row.querySelectorAll("[data-activity-cell]")) {
          const value = String(display[field.dataset.activityCell] ?? "");
          if (field.textContent !== value) field.textContent = value;
        }
        row.activitySnapshot = snapshot;
      }
      if (row !== next) body.insertBefore(row, next);
      next = row.nextElementSibling;
    }
    this.root.querySelector(`[data-activity-empty-${type}]`).hidden = entries.length > 0;
    body.closest("table").hidden = !entries.length;
  }

  dispose() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.root?.removeEventListener("click", this.onClick);
    this.root = null; this.scene = null; this.options = null; this.timer = undefined; this.deadline = null;
    this.rows.interactions.clear(); this.rows.executions.clear(); this.entries.clear();
  }
}
