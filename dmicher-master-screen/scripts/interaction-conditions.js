import { normalizeTags, normalizeConditions } from "./model.js";
import { getObjectTags } from "./store.js";
import { isExecutionHalted } from "./execution.js";

const list = (value) => Array.isArray(value) ? value : [];
const tags = (value) => new Set(normalizeTags(value));
const uses = (state, key) => Math.max(0, Number(state.conditionCounts?.[key]) || 0);
const limit = (policy) => normalizeConditions(policy).limit;
export const getConditionKey = (state, type, id) => `${state.groupId ?? "main"}:${state.stateId}:${type}:${id}`;

/** This predicate does not write, log, consume a use or claim success. */
export function getConditionGate(scene, state, policy = {}, actorToken, { conditionKey, ignoreQuota = false } = {}) {
  const deny = (reason) => ({ allowed: false, reason });
  if (isExecutionHalted(scene, state)) return deny("Автоматизация группы аварийно остановлена мастером.");
  if (!state?.runId || !state.stateId || !state.state) return deny("Нет действующего состояния с автоматизацией.");
  if ((state.conditionEnabledOverrides?.[conditionKey] ?? policy?.enabled) === false) return deny("Триггер выключен мастером.");
  const groupId = state.groupId ?? "main";
  if (!conditionKey || !conditionKey.startsWith(`${groupId}:${state.stateId}:`)) return deny("Триггер принадлежит другой группе или состоянию.");
  if (list(policy?.groupIds).length && !policy.groupIds.includes(groupId)) return deny("Триггер недоступен в этой группе.");
  if (list(policy?.stateIds).length && !policy.stateIds.includes(state.stateId)) return deny("Триггер недоступен в этом состоянии.");
  const token = actorToken?.document ?? actorToken;
  if (token && (scene.tokens?.get(token.id) !== token || (token.parent?.id && token.parent.id !== scene.id))) return deny("Персонаж находится в другой сцене.");
  const actorTags = tags(token ? getObjectTags(scene, { type: "Token", id: token.id }) : []);
  const allow = tags(policy?.allowTags), block = tags(policy?.denyTags);
  if (allow.size && ![...allow].some((tag) => actorTags.has(tag))) return deny("Теги персонажа не входят в разрешённый список.");
  if ([...block].some((tag) => actorTags.has(tag))) return deny("Тег персонажа входит в запрещённый список.");
  if (!ignoreQuota && policy?.repeat !== "always" && uses(state, conditionKey) >= limit(policy)) return deny("Разрешённое число срабатываний исчерпано.");
  return { allowed: true, reason: "" };
}

/** Caller must hold the owning Scene lock and have checked its current gate. */
export function consumeCondition(state, key, policy = {}) {
  if ((state.conditionEnabledOverrides?.[key] ?? policy?.enabled) === false
    || (policy?.repeat !== "always" && uses(state, key) >= limit(policy))) throw new Error("Триггер уже недоступен.");
  state.conditionCounts ??= {};
  state.conditionCounts[key] = Math.min(Number.MAX_SAFE_INTEGER, uses(state, key) + 1);
  return state.conditionCounts[key];
}

/** Only the incoming state's explicitly resettable conditions counters are cleared. */
export function resetStateConditions(run, state = run.state) {
  run.conditionCounts ??= {};
  const reset = (type, id, policy) => {
    if (policy?.resetOnEntry !== false) delete run.conditionCounts[getConditionKey(run, type, id)];
  };
  for (const zone of state?.zones ?? []) reset("zone", zone.id, zone.conditions);
  for (const dialogue of state?.dialogues ?? []) reset("dialogue", `${dialogue.target.type}:${dialogue.target.id}:${dialogue.dialogueId}`, dialogue.conditions);
  for (const interaction of state?.interactions ?? []) reset("interaction", interaction.id, interaction.conditions);
  for (const shop of state?.shops ?? []) reset("shop", `${shop.target.type}:${shop.target.id}:${shop.shopId}`, shop.conditions);
}
