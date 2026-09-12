import { text as t } from "../localization.js";
import { message as localizedMessage } from "../localization.js";
import { generics } from "../generics.js";
import { normalizeConditions } from "../model.js";

const escape = (value) => generics.utilities.escapeHTML(String(value ?? ""));

const defaults = () => normalizeConditions();
const prefixOf = (prefix) => {
  if (!/^[a-z][a-z0-9-]*$/.test(prefix)) throw new Error(t("Некорректное пространство полей условий.", "Invalid condition field namespace."));
  return prefix;
};
export const splitTags = (value) => [...new Set(String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];

/** The only raw HTML used by these forms: every variable is escaped here, never supplied as markup. */
export function buildConditionFields(policy, states = [], { prefix = "conditions", groupId = "main", groupName = localizedMessage("Основная группа") } = {}) {
  prefixOf(prefix);
  const conditions = { ...defaults(), ...policy };
  const check = (name, label, active, val = "") => `<label class="ms-check"><input type="checkbox" name="${prefix}-${name}" value="${escape(val)}"${active ? " checked" : ""}> ${escape(label)}</label>`;
  return `<details class="ms-details ms-conditions-fields" data-conditions-fields="${prefix}"><summary>${t("Условия запуска", "Launch conditions")}</summary>
    ${check("enabled", t("Разрешать запуск", "Allow launch"), conditions.enabled !== false)}
    <p class="ms-note">${t("Допуск действует вместе с настройками объекта. Пустой список групп, состояний или разрешающих тегов не ограничивает запуск.", "Conditions apply together with object settings. Empty group, state or allow-tag lists do not restrict launch.")}</p>
    <div class="ms-conditions-scope"><strong>${t("Группа", "Group")}</strong>${check("group", groupName, conditions.groupIds.includes(groupId), groupId)}</div>
    <div class="ms-conditions-scope"><strong>${t("Состояния", "States")}</strong>${states.map((state) => check("state", state.name, conditions.stateIds.includes(state.id), state.id)).join("")}</div>
    <label class="ms-field">${t("Разрешающие теги, через запятую", "Allowed tags, comma-separated")}<input name="${prefix}-allow" value="${escape(conditions.allowTags.join(", "))}" placeholder="hero, trusted"></label>
    <label class="ms-field">${t("Запрещающие теги, через запятую", "Denied tags, comma-separated")}<input name="${prefix}-deny" value="${escape(conditions.denyTags.join(", "))}" placeholder="hostile"></label>
    <p class="ms-note">${t("Проверяются теги действующего персонажа. Достаточно одного разрешающего тега; любой запрещающий отменяет допуск. Регистр не учитывается.", "The acting character's tags are checked. Any allow-tag is sufficient; any deny-tag blocks access. Matching is case-insensitive.")}</p>
    <div class="ms-grid-two"><label class="ms-field">${t("Повторение", "Repetition")}<select name="${prefix}-repeat"><option value="limited"${conditions.repeat !== "always" ? " selected" : ""}>${t("Ограниченное число запусков", "Limited launches")}</option><option value="always"${conditions.repeat === "always" ? " selected" : ""}>${t("Каждый раз", "Every time")}</option></select></label>
    <label class="ms-field">${t("Лимит запусков", "Launch limit")}<input type="number" name="${prefix}-limit" min="1" step="1" value="${escape(conditions.limit)}" required></label></div>
    ${check("reset", t("Сбрасывать счётчик при новом входе в состояние", "Reset the counter on state entry"), conditions.resetOnEntry !== false)}
    <p class="ms-note">${t("Переподключение не сбрасывает счётчик. Ручной сброс доступен в режиссёре.", "Reconnecting does not reset the counter. The Director can reset it manually.")}</p>
  </details>`;
}

export function readConditionFields(root, prefix = "conditions") {
  prefixOf(prefix);
  const field = (name) => root.querySelector(`[name="${prefix}-${name}"]`);
  // A form which has not rendered yet retains the ordinary launch defaults.
  if (!field("enabled")) return defaults();
  const get = (name) => field(name)?.value ?? "";
  const on = (name) => field(name)?.checked === true;
  const list = (name) => [...root.querySelectorAll(`[name="${prefix}-${name}"]:checked`)].map((input) => input.value);
  const limit = Number(get("limit"));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(t("Лимит запусков должен быть целым числом от 1.", "The launch limit must be an integer of at least 1."));
  return { enabled: on("enabled"), groupIds: list("group"), stateIds: list("state"),
    allowTags: splitTags(get("allow")), denyTags: splitTags(get("deny")),
    repeat: get("repeat") === "always" ? "always" : "limited", limit, resetOnEntry: on("reset") };
}
