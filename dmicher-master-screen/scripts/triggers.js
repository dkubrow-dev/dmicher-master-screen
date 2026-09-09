import { normalizeTags, normalizeTrigger } from "./model.js";
import { getObjectTags } from "./store.js";
import { isExecutionHalted } from "./execution.js";

const list = (value) => Array.isArray(value) ? value : [];
const tags = (value) => new Set(normalizeTags(value));
const uses = (state, key) => Math.max(0, Number(state.triggerCounts?.[key]) || 0);
const limit = (policy) => normalizeTrigger(policy).limit;
export const getTriggerKey = (state, type, id) => `${state.schemeId ?? "main"}:${state.episodeId}:${type}:${id}`;

/** This predicate does not write, log, consume a use or claim success. */
export function getTriggerGate(scene, state, policy = {}, actorToken, { triggerKey, ignoreQuota = false } = {}) {
  const deny = (reason) => ({ allowed: false, reason });
  if (isExecutionHalted(scene, state)) return deny("Автоматизация схемы аварийно остановлена мастером.");
  if (!state?.runId || !state.episodeId || !state.episode || state.episode.stop) return deny("Нет действующего эпизода с автоматизацией.");
  if ((state.triggerEnabledOverrides?.[triggerKey] ?? policy?.enabled) === false) return deny("Триггер выключен мастером.");
  const schemeId = state.schemeId ?? "main";
  if (!triggerKey || !triggerKey.startsWith(`${schemeId}:${state.episodeId}:`)) return deny("Триггер принадлежит другой схеме или эпизоду.");
  if (list(policy?.schemeIds).length && !policy.schemeIds.includes(schemeId)) return deny("Триггер недоступен в этой схеме.");
  if (list(policy?.episodeIds).length && !policy.episodeIds.includes(state.episodeId)) return deny("Триггер недоступен в этом эпизоде.");
  const token = actorToken?.document ?? actorToken;
  if (token && (scene.tokens?.get(token.id) !== token || (token.parent?.id && token.parent.id !== scene.id))) return deny("Персонаж находится в другой сцене.");
  const actorTags = tags(token ? getObjectTags(scene, { type: "Token", id: token.id }) : []);
  const allow = tags(policy?.allowTags), block = tags(policy?.denyTags);
  if (allow.size && ![...allow].some((tag) => actorTags.has(tag))) return deny("Теги персонажа не входят в разрешённый список.");
  if ([...block].some((tag) => actorTags.has(tag))) return deny("Тег персонажа входит в запрещённый список.");
  if (!ignoreQuota && policy?.repeat !== "always" && uses(state, triggerKey) >= limit(policy)) return deny("Разрешённое число срабатываний исчерпано.");
  return { allowed: true, reason: "" };
}

/** Caller must hold the owning Scene lock and have checked its current gate. */
export function consumeTrigger(state, key, policy = {}) {
  if ((state.triggerEnabledOverrides?.[key] ?? policy?.enabled) === false
    || (policy?.repeat !== "always" && uses(state, key) >= limit(policy))) throw new Error("Триггер уже недоступен.");
  state.triggerCounts ??= {};
  state.triggerCounts[key] = Math.min(Number.MAX_SAFE_INTEGER, uses(state, key) + 1);
  return state.triggerCounts[key];
}

/** Only the incoming episode's explicitly resettable trigger counters are cleared. */
export function resetEpisodeTriggerCounts(state, episode = state.episode) {
  state.triggerCounts ??= {};
  const reset = (type, id, policy) => {
    if (policy?.resetOnEntry !== false) delete state.triggerCounts[getTriggerKey(state, type, id)];
  };
  for (const zone of episode?.zones ?? []) reset("zone", zone.id, zone.trigger);
  for (const dialogue of episode?.dialogues ?? []) reset("dialogue", dialogue.triggerId ?? (dialogue.dialogueId ? `${dialogue.target.type}:${dialogue.target.id}` : dialogue.id), dialogue.trigger);
  for (const interaction of episode?.interactions ?? []) reset("interaction", interaction.id, interaction.trigger);
  for (const [id, behavior] of Object.entries(episode?.tokens ?? {})) {
    reset("shop", id, behavior.shop?.trigger);
    reset("npc-interaction", id, behavior.interaction?.trigger);
  }
}
