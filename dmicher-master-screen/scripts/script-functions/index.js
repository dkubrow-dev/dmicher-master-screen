import wait from "./wait.js";
import move from "./move.js";
import approach from "./approach.js";
import follow from "./follow.js";
import speech from "./speech.js";
import emotion from "./emotion.js";
import dialogue from "./dialogue.js";
import shop from "./shop.js";
import command from "./command.js";
import visibility from "./visibility.js";
import automation from "./automation.js";
import focus from "./focus.js";
import sound from "./sound.js";
import playlist from "./playlist.js";
import state from "./state.js";
import windows from "./windows.js";
import notes from "./notes.js";
import signal from "./signal.js";
import macro from "./macro.js";
import pause from "./pause.js";
import { text } from "../localization.js";

export const builtinScriptFunctions = Object.freeze([wait, pause, move, approach, follow, speech, emotion, dialogue, shop, command, visibility, automation, focus, sound, playlist, state, windows, notes, signal, macro]);
const functions = new Map(builtinScriptFunctions.map(fn => [fn.id, fn]));

/** Optional integrations register functions without extending the interpreter. */
export function registerScriptFunctions(definitions) {
  const ids = new Set();
  for (const fn of definitions) {
    if (!fn?.id || ids.has(fn.id) || functions.has(fn.id) || typeof fn.normalize !== "function") throw new Error("Invalid or duplicate script function");
    ids.add(fn.id);
  }
  for (const fn of definitions) functions.set(fn.id, fn);
  return () => { for (const fn of definitions) if (functions.get(fn.id) === fn) functions.delete(fn.id); };
}
export const getScriptFunction = id => functions.get(id);
export function listScriptFunctions({ scope = "object", language, premium = true, owner } = {}) {
  const localized = value => text(value.ru, value.en, language);
  return [...functions.values()].map(fn => {
    const compatible = fn.scopes.includes(scope)
      && (!owner?.documentName || !fn.objectTypes || fn.objectTypes.includes(owner.documentName))
      && (!fn.acceptsOwner || fn.acceptsOwner(owner));
    const disabled = !compatible || fn.premium && !premium;
    return { id: fn.id, label: localized(fn.label), path: `${localized(fn.category)}.${localized(fn.label)}`,
      description: localized(fn.description ?? fn.label), premium: fn.premium, disabled,
      reason: !compatible ? text("Недоступно для этого источника", "Unavailable for this source", language)
        : disabled ? text("Требуется Premium", "Requires Premium", language) : "" };
  });
}
export async function executeScriptFunction(id, context) {
  const fn = getScriptFunction(id);
  if (typeof fn?.execute !== "function") throw new Error(text("Неизвестное действие скрипта.", "Unknown script action."));
  const scope = context.engine?.runtime?.scriptScope?.(context.scene, context.runId) ?? "object";
  const objectType = context.object?.documentName;
  if (!fn.scopes.includes(scope) || objectType && fn.objectTypes && !fn.objectTypes.includes(objectType)) {
    throw new Error(text("Действие скрипта недоступно для этого источника.", "Script action is unavailable for this source."));
  }
  return fn.execute(context);
}
