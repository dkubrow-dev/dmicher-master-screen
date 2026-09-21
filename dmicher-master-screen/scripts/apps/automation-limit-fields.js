import { getAutomationLimits, getCollectionLimitIssue, getScriptLimitIssue } from "../automation-limits.js";
import { text as t } from "../localization.js";
import { escapeHTML as e } from "./form-fields.js";

export const automationLimits = source => typeof source === "function" ? source() : source ?? getAutomationLimits();
export const limitReached = (kind, count, source) => {
  const limit = automationLimits(source)[kind];
  return Number.isFinite(limit) && count >= limit;
};
export function assertAutomationAddition(kind, count, source) {
  const limits = automationLimits(source);
  const issue = kind === "scriptSteps" ? getScriptLimitIssue({ steps: Array.from({ length: count + 1 }) }, limits)
    : getCollectionLimitIssue(kind, count + 1, limits);
  if (issue) throw new Error(issue);
}
export function renderAutomationCount(kind, count, source) {
  const limit = automationLimits(source)[kind], label = { scriptSteps: t("Шаги", "Steps"), subscriptions: t("Подписки", "Subscriptions"), actions: t("Действия", "Actions") }[kind];
  return `<span class="ms-automation-count" data-automation-count="${kind}">${e(label)}: ${count} / ${limit ?? "∞"} <span class="dmicher-premium-badge" title="${t("Premium снимает ограничения количества.", "Premium removes quantity limits.")}">Premium</span></span>`;
}
export function renderAutomationUnavailable(kind, index, source) {
  if (!limitReached(kind, index, source)) return "";
  const limit = automationLimits(source)[kind];
  return `<span class="ms-automation-unavailable"><span class="dmicher-premium-badge">Premium</span> ${e(t(`Недоступно без Premium: позиция ${index + 1}, лимит ${limit}.`, `Unavailable without Premium: position ${index + 1}, limit ${limit}.`))}</span>`;
}
export function renderScriptLimitIssue(script, source) {
  const issue = getScriptLimitIssue(script, automationLimits(source));
  return issue ? `<p class="ms-automation-limit-issue" data-automation-limit-issue="scriptSteps" role="status">${e(issue)}</p>` : "";
}
export function automationAddAttributes(kind, count, source) {
  if (!limitReached(kind, count, source)) return "";
  return ` disabled title="${t("Бесплатный лимит достигнут. Удалите лишние записи или включите Premium.", "The free limit has been reached. Remove entries or enable Premium.")}"`;
}
