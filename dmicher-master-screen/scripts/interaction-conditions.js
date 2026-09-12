import { message as localizedMessage } from "./localization.js";
import { normalizeTags, normalizeConditions } from "./model.js";
import { getObjectTags } from "./store.js";
import { isExecutionHalted } from "./execution.js";

const list = (value) => Array.isArray(value) ? value : [];
const tags = (value) => new Set(normalizeTags(value));
const uses = (state, key) => Math.max(0, Number(state.conditionCounts?.[key]) || 0);
const limit = (policy) => normalizeConditions(policy).limit;
export const getConditionKey = (state, type, id) => `${state.groupId ?? "main"}:${state.stateId}:${type}:${id}`;

/** Pure policy shared by live admission and preparation previews. No Scene,
 * token document, logging or use consumption is needed to evaluate these facts. */
export function evaluateConditionPolicy({ active, groupId = "main", stateId, conditionKey, halted = false,
  enabledOverride, count = 0, actorInScene = true, ignoreQuota = false }, policy = {}, actorTagValues = []) {
  const deny = (reason) => ({ allowed: false, reason });
  if (halted) return deny(localizedMessage("Автоматизация группы аварийно остановлена мастером."));
  if (!active) return deny(localizedMessage("Нет действующего состояния с автоматизацией."));
  if ((enabledOverride ?? policy?.enabled) === false) return deny(localizedMessage("Условие срабатывания выключено мастером."));
  if (!conditionKey || !conditionKey.startsWith(`${groupId}:${stateId}:`)) return deny(localizedMessage("Условие срабатывания принадлежит другой группе или состоянию."));
  if (list(policy?.groupIds).length && !policy.groupIds.includes(groupId)) return deny(localizedMessage("Условие срабатывания недоступно в этой группе."));
  if (list(policy?.stateIds).length && !policy.stateIds.includes(stateId)) return deny(localizedMessage("Условие срабатывания недоступно в этом состоянии."));
  if (!actorInScene) return deny(localizedMessage("Персонаж находится в другой сцене."));
  const actorTags = tags(actorTagValues);
  const allow = tags(policy?.allowTags), block = tags(policy?.denyTags);
  if (allow.size && ![...allow].some((tag) => actorTags.has(tag))) return deny(localizedMessage("Теги персонажа не входят в разрешённый список."));
  if ([...block].some((tag) => actorTags.has(tag))) return deny(localizedMessage("Тег персонажа входит в запрещённый список."));
  if (!ignoreQuota && policy?.repeat !== "always" && count >= limit(policy)) return deny(localizedMessage("Разрешённое число срабатываний исчерпано."));
  return { allowed: true, reason: "" };
}

/** Gather native identity and current run facts without changing persisted state. */
export function getConditionGate(scene, state, policy = {}, actorToken, { conditionKey, ignoreQuota = false } = {}) {
  const token = actorToken?.document ?? actorToken;
  const actorInScene = !token || scene.tokens?.get(token.id) === token && (!token.parent?.id || token.parent.id === scene.id);
  return evaluateConditionPolicy({ active: Boolean(state?.runId && state.stateId && state.state),
    groupId: state?.groupId ?? "main", stateId: state?.stateId, conditionKey, ignoreQuota,
    halted: isExecutionHalted(scene, state), enabledOverride: state?.conditionEnabledOverrides?.[conditionKey],
    count: state ? uses(state, conditionKey) : 0, actorInScene }, policy,
  token && actorInScene ? getObjectTags(scene, { type: "Token", id: token.id }) : []);
}

/** Caller must hold the owning Scene lock and have checked its current gate. */
export function consumeCondition(state, key, policy = {}) {
  if ((state.conditionEnabledOverrides?.[key] ?? policy?.enabled) === false
    || (policy?.repeat !== "always" && uses(state, key) >= limit(policy))) throw new Error(localizedMessage("Условие срабатывания уже недоступно."));
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
