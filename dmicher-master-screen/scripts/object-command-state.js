import { MODULE_ID } from "./model.js";
import { getRuntime, saveRuntime } from "./store.js";
import { objectKey } from "./scene-objects.js";
import { writeSceneFlags, replacementFlagData } from "./scene-flags.js";
import { isSceneAutomationHalted, isExecutionHalted, notifyExecutionChange } from "./execution.js";

/** Ungrouped native objects share the scene's cancellation stamp, without
 * creating a fake group or writing empty scene preparation on first use. */
export function commandParent(scene, runOrBinding) {
  if (runOrBinding?.groupId) return scene?.getFlag?.(MODULE_ID, "groupRuntimes")?.[runOrBinding.groupId] ?? null;
  return { groupId: null, runId: `scene-command:${scene?.id}:${scene?.getFlag?.(MODULE_ID, "automationHaltId") ?? "initial"}`,
    stateId: null, state: {}, halted: isSceneAutomationHalted(scene), disabledObjects: [], scriptStates: {}, interactionClocks: {} };
}
export function commandBehaviorEnabled(scene, target, parent = commandParent(scene)) {
  return scene?.getFlag?.(MODULE_ID, "objectBehaviorState")?.[objectKey(target)] !== false
    && !parent?.disabledObjects?.includes(objectKey(target));
}
export const isCommandParentHalted = (scene, parent) => parent?.groupId ? isExecutionHalted(scene, parent) : isSceneAutomationHalted(scene);
/** Initial restoration clears only the addressed manual behavior overrides.
 * Group runtimes reset their own disabledObjects in the existing restoration. */
export async function clearBehaviorOverrides(scene, targets) {
  const raw = scene.getFlag(MODULE_ID,"objectBehaviorState") ?? {}, next = {...raw};
  let changed = false;
  for (const target of targets) { const key = objectKey(target); if (Object.hasOwn(next,key)) { delete next[key]; changed = true; } }
  if (changed) { await writeSceneFlags(scene,{objectBehaviorState:replacementFlagData(raw,next)}); notifyExecutionChange(scene,"object-behavior-restored"); }
}
/** Called inside the existing scene command queue; do not reacquire that queue. */
export async function setCommandBehavior(scene, target, enabled, groupId) {
  const key = objectKey(target), raw = scene.getFlag(MODULE_ID, "objectBehaviorState") ?? {};
  if (Object.hasOwn(raw, key) || !groupId) {
    const next = { ...raw }; if (enabled) delete next[key]; else next[key] = false;
    await writeSceneFlags(scene, { objectBehaviorState: replacementFlagData(raw, next) });
  }
  if (groupId) {
    const parent = getRuntime(scene, { groupId });
    parent.disabledObjects = parent.disabledObjects.filter(item => item !== key);
    if (!enabled) parent.disabledObjects.push(key);
    await saveRuntime(scene, parent);
  }
  notifyExecutionChange(scene, "object-behavior-changed");
}
export async function setCommandSignals(scene, target, enabled) {
  const raw = scene.getFlag(MODULE_ID, "objectSignalState") ?? {}, next = { ...raw }, key = objectKey(target);
  if (enabled) delete next[key]; else next[key] = false;
  await writeSceneFlags(scene, { objectSignalState: replacementFlagData(raw, next) });
}
