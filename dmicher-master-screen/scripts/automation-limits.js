import { generics } from "./generics.js";
import { text } from "./localization.js";

export const FREE_AUTOMATION_LIMITS = Object.freeze({ scriptSteps: 16, subscriptions: 8, actions: 4, chainHandlers: 8 });
const premium = generics.premium.forModule("dmicher-master-screen", { apiVersion: 1, methods: ["resolveAutomationLimits"] });
const validLimits = value => value && Object.entries(FREE_AUTOMATION_LIMITS).every(([key, limit]) => value[key] === limit || value[key] === null);
export function getAutomationLimits() {
  const resolved = premium.invoke("resolveAutomationLimits", [], () => ({ ...FREE_AUTOMATION_LIMITS }), validLimits);
  return Object.fromEntries(Object.keys(FREE_AUTOMATION_LIMITS).map(key => [key, resolved[key]]));
}
export const subscribeAutomationLimits = listener => premium.subscribe(listener);
export function getScriptLimitIssue(script, limits = getAutomationLimits()) {
  const limit = limits.scriptSteps;
  if (limit === null || (script?.steps?.length ?? 0) <= limit) return null;
  return text(`Скрипт содержит больше ${limit} шагов и не запускается без Premium. Все сохранённые шаги остаются на месте.`,
    `The script has more than ${limit} steps and will not run without Premium. All saved steps are retained.`);
}
export function getCollectionLimitIssue(kind, count, limits = getAutomationLimits()) {
  const limit = limits[kind];
  if (limit === null || count <= limit) return null;
  if (kind === "actions") return text(`Бесплатно доступны первые ${limit} действий объекта. Остальные требуют Premium.`,
    `The first ${limit} object actions are free. Additional actions require Premium.`);
  return text(`Бесплатно доступны первые ${limit} подписок владельца. Отключённые подписки также учитываются; остальные требуют Premium.`,
    `The first ${limit} owner subscriptions are free. Disabled subscriptions also count; additional subscriptions require Premium.`);
}
export function collectionEntryAllowed(kind, entries, entry, limits = getAutomationLimits()) {
  const index = entries.findIndex(candidate => candidate === entry || entry?.id != null && candidate.id === entry.id);
  return index >= 0 && (limits[kind] === null || index < limits[kind]);
}
/** Editing/reducing an existing oversized collection must never destroy its tail. */
export function assertCollectionGrowth(kind, previous, next, limits = getAutomationLimits()) {
  const count = value => Array.isArray(value) ? value.length : value;
  if (count(next) <= count(previous)) return;
  const issue = getCollectionLimitIssue(kind, count(next), limits);
  if (issue) throw new Error(issue);
}
