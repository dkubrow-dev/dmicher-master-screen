import { MODULE_ID } from "./model.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { objectCapabilities } from "./object-capabilities.js";
import { objectSupportsCommand, commandPermitsDisabledBehavior } from "./object-command-model.js";
import { isExecutionHalted, isSceneAutomationHalted } from "./execution.js";
import { collectionEntryAllowed } from "./automation-limits.js";

const list = value => Array.isArray(value) ? value : [];
const includes = (values, value) => !list(values).length || values.includes(value);
const stateAllowed = (conditions, run) => conditions?.enabled !== false
  && includes(conditions?.groupIds,run?.groupId) && includes(conditions?.stateIds,run?.stateId);

/** Prepared potential interactions, not player admission. Distance, selected
 * character, visibility and author macros are deliberately absent: approaching
 * an object must not require rebuilding the highlight membership. The renderer
 * checks native visibility separately and the menu still validates admission. */
export function potentialInteractiveDocuments(scene, user = globalThis.game?.user) {
  if (!scene || !user || isSceneAutomationHalted(scene)) return [];
  const bindings = scene.getFlag(MODULE_ID,"objectBindings")?.bindings ?? {};
  const runs = scene.getFlag(MODULE_ID,"groupRuntimes") ?? {}, definitions = scene.getFlag(MODULE_ID,"groupDefinitions") ?? {};
  const behavior = scene.getFlag(MODULE_ID,"objectBehaviorState") ?? {}, catalog = scene.getFlag(MODULE_ID,"interactionCatalog") ?? {};
  const assets = {shops:new Set(list(catalog.shops).map(asset=>asset.id)),dialogues:new Set(list(catalog.dialogues).map(asset=>asset.id))};
  const result = [];
  for (const [key,binding] of Object.entries(bindings)) {
    const document = scene[SCENE_OBJECT_COLLECTIONS[binding.type]]?.get(binding.id);
    if (!document) continue;
    const run = binding.groupId && definitions[binding.groupId]?.schemaVersion === 1 ? runs[binding.groupId] : null;
    const running = Boolean(run?.runId && run.stateId && run.state && !isExecutionHalted(scene,run));
    const enabled = behavior[key] !== false && !run?.disabledObjects?.includes(key);
    const command = (!binding.groupId || running) && list(binding.commands).some(entry=>entry.enabled
      && objectSupportsCommand(binding.type,entry.id) && (enabled || commandPermitsDisabledBehavior(entry.id))
      && (user.isGM ? entry.permissions?.gm !== false : entry.permissions?.player !== false || entry.permissions?.delegated !== false)
      && (!list(entry.conditions?.groups).length || entry.conditions.groups.some(group=>group.groupId === binding.groupId && includes(group.stateIds,run?.stateId))));
    const action = running && enabled && list(binding.actions).some(entry=>entry.enabled
      && collectionEntryAllowed("actions",binding.actions,entry)
      && (user.isGM || entry.audience !== "gm") && stateAllowed(entry.conditions,run));
    const tool = running && enabled && objectCapabilities(binding.type,binding).tools && ["shops","dialogues"].some(kind=>list(binding[kind]).some(entry=>
      entry.playerAction !== false && assets[kind].has(entry[kind === "shops" ? "shopId" : "dialogueId"])
      && includes(entry.stateIds,run.stateId) && stateAllowed(entry.conditions,run)));
    const interaction = running && enabled && list(run.state.interactions).some(entry=>entry.enabled
      && entry.target?.type === binding.type && entry.target.id === binding.id && stateAllowed(entry.conditions,run));
    if (command || action || tool || interaction) result.push(document);
  }
  return result;
}
