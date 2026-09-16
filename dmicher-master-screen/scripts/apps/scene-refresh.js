import { MODULE_ID } from "../model.js";
import { SCENE_OBJECT_COLLECTIONS } from "../scene-object-types.js";

/** Inputs used by preparation views. Execution clocks, native positions and
 * interaction transcripts deliberately do not invalidate authoring forms. */
export function scenePreparationKey(scene) {
  const read = (key) => scene?.getFlag(MODULE_ID, key);
  const documents = Object.entries(SCENE_OBJECT_COLLECTIONS).flatMap(([type, collection]) =>
    Array.from(scene?.[collection]?.values?.() ?? [], (document) =>
      [type, document.id, document.uuid, document.name, document.text, document.label,
        document.actor?.uuid, document.texture?.src]));
  return JSON.stringify([scene?.id, scene?.name, globalThis.game?.i18n?.lang,
    ...["objectBindings", "groupDefinitions", "interactionCatalog", "signalCatalog", "objectTags", "workspacePresets"].map(read),
    documents,
    Array.from(globalThis.game?.macros?.values?.() ?? [], (macro) =>
      [macro.id, macro.name, macro.command, macro.type, macro.canExecute])]);
}
