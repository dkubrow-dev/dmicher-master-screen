import { generics } from "../generics.js";
import { normalizeTrigger } from "../model.js";

const escape = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const defaults = () => normalizeTrigger();
const prefixOf = (prefix) => {
  if (!/^[a-z][a-z0-9-]*$/.test(prefix)) throw new Error("Некорректное пространство полей триггера.");
  return prefix;
};
export const splitTags = (value) => [...new Set(String(value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];

/** The only raw HTML used by these forms: every variable is escaped here, never supplied as markup. */
export function buildTriggerFields(policy, episodes = [], { prefix = "trigger", schemeId = "main", schemeName = "Основная схема" } = {}) {
  prefixOf(prefix);
  const trigger = { ...defaults(), ...policy };
  const check = (name, label, active, val = "") => `<label class="ms-check"><input type="checkbox" name="${prefix}-${name}" value="${escape(val)}"${active ? " checked" : ""}> ${escape(label)}</label>`;
  return `<details class="ms-details ms-trigger-fields" data-trigger-fields="${prefix}"><summary>Условия запуска</summary>
    ${check("enabled", "Разрешать запуск", trigger.enabled !== false)}
    <p class="ms-note">Допуск действует вместе с настройками объекта. Пустой список схем, эпизодов или разрешающих тегов не ограничивает запуск.</p>
    <div class="ms-trigger-scope"><strong>Схема</strong>${check("scheme", schemeName, trigger.schemeIds.includes(schemeId), schemeId)}</div>
    <div class="ms-trigger-scope"><strong>Эпизоды</strong>${episodes.map((episode) => check("episode", episode.name, trigger.episodeIds.includes(episode.id), episode.id)).join("")}</div>
    <label class="ms-field">Разрешающие теги, через запятую<input name="${prefix}-allow" value="${escape(trigger.allowTags.join(", "))}" placeholder="hero, trusted"></label>
    <label class="ms-field">Запрещающие теги, через запятую<input name="${prefix}-deny" value="${escape(trigger.denyTags.join(", "))}" placeholder="hostile"></label>
    <p class="ms-note">Проверяются теги действующего персонажа. Достаточно одного разрешающего тега; любой запрещающий отменяет допуск. Регистр не учитывается.</p>
    <div class="ms-grid-two"><label class="ms-field">Повторение<select name="${prefix}-repeat"><option value="limited"${trigger.repeat !== "always" ? " selected" : ""}>Ограниченное число запусков</option><option value="always"${trigger.repeat === "always" ? " selected" : ""}>Каждый раз</option></select></label>
    <label class="ms-field">Лимит запусков<input type="number" name="${prefix}-limit" min="1" step="1" value="${escape(trigger.limit)}" required></label></div>
    ${check("reset", "Сбрасывать счётчик при новом входе в эпизод", trigger.resetOnEntry !== false)}
    <p class="ms-note">Переподключение не сбрасывает счётчик. Ручной сброс доступен в режиссёре.</p>
  </details>`;
}

export function readTriggerFields(root, prefix = "trigger") {
  prefixOf(prefix);
  const field = (name) => root.querySelector(`[name="${prefix}-${name}"]`);
  // Backward-compatible helper use before a form's first render does not silently deny everything.
  if (!field("enabled")) return defaults();
  const get = (name) => field(name)?.value ?? "";
  const on = (name) => field(name)?.checked === true;
  const list = (name) => [...root.querySelectorAll(`[name="${prefix}-${name}"]:checked`)].map((input) => input.value);
  const limit = Number(get("limit"));
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Лимит триггера должен быть целым числом от 1.");
  return { enabled: on("enabled"), schemeIds: list("scheme"), episodeIds: list("episode"),
    allowTags: splitTags(get("allow")), denyTags: splitTags(get("deny")),
    repeat: get("repeat") === "always" ? "always" : "limited", limit, resetOnEntry: on("reset") };
}
