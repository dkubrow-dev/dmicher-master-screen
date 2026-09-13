import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";

export const DEBUG_SETTING = "debug";

/** Read the shared switch at the point of use: changing it never requires a reload. */
export function debugEnabled() {
  try { return globalThis.game?.settings?.get(MODULE_ID, DEBUG_SETTING) === true; }
  catch { return false; }
}

export function registerDebugSetting({ onChange = () => {} } = {}) {
  game.settings.register(MODULE_ID, DEBUG_SETTING, {
    name: text("Отладка", "Debug"), scope: "world", config: false, restricted: true,
    type: Boolean, default: false, onChange
  });
}

export async function setDebugEnabled(enabled) {
  if (!globalThis.game?.user?.isGM) throw new Error(text("Отладку включает мастер.", "Only a GM can enable debugging."));
  return game.settings.set(MODULE_ID, DEBUG_SETTING, enabled === true);
}

// Console entries must not retain live documents or change when runtime objects mutate.
// Only plain data is accepted. Bad diagnostic context must never stop gameplay.
function snapshot(value, seen = new WeakSet(), depth = 0) {
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) return value;
  if (value === undefined) return undefined;
  if (typeof value !== "object") return String(value);
  if (depth > 12) return "[Depth limit]";
  if (seen.has(value)) return "[Circular]";
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return "[Non-plain object]";
  seen.add(value);
  const result = Array.isArray(value) ? value.map((item) => snapshot(item, seen, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, seen, depth + 1)]));
  seen.delete(value);
  return result;
}

function write(method, category, event, context, error) {
  if (!debugEnabled()) return;
  try {
    const details = snapshot(typeof context === "function" ? context() : context);
    const record = { at: new Date().toISOString(), ...details };
    if (error !== undefined) record.error = { name: String(error?.name ?? "Error"), message: String(error?.message ?? error), stack: String(error?.stack ?? "") };
    globalThis.console?.[method]?.(`${MODULE_ID} | [${category}] ${event}`, record);
  } catch { /* Diagnostics cannot alter an action's result. */ }
}

/** Pass a factory for expensive context; it is never evaluated while Debug is off. */
export function debugTrace(category, event, context = {}) { write("debug", category, event, context); }
export function debugError(category, event, error, context = {}) { write("error", category, event, context, error); }
