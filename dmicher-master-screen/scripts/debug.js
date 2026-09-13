import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";
import { appendDiagnostic, diagnosticSnapshot, diagnosticError } from "./diagnostics.js";

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

function write(method, category, event, context, error) {
  const verbose = debugEnabled(), record = globalThis.game?.user?.isGM === true && (verbose || method !== "debug");
  if (!verbose && !record) return;
  try {
    let details;
    try { details = diagnosticSnapshot(typeof context === "function" ? context() : context); }
    catch { details = { diagnosticContext: "[Unavailable]" }; }
    const at = new Date().toISOString();
    const failure = method === "error" || error !== undefined ? diagnosticError(error) : undefined;
    if (record) appendDiagnostic({ at, level: failure || method === "error" ? "error" : method, category, event, context: details, ...(failure ? { error: failure } : {}) });
    if (verbose) globalThis.console?.[["signal", "command"].includes(method) ? "debug" : method]?.(`${MODULE_ID} | [${category}] ${event}`, { at, ...details, ...(failure ? { error: failure } : {}) });
  } catch { /* Diagnostics cannot alter an action's result. */ }
}

/** Pass a factory for expensive context; it is never evaluated while Debug is off. */
export function debugTrace(category, event, context = {}) { write("debug", category, event, context); }
export function debugError(category, event, error, context = {}) { write("error", category, event, context, error); }
/** Operational signal delivery is visible to the GM even with Debug disabled. */
export function signalTrace(event, context = {}, error) { write("signal", "signal", event, context, error); }
/** Director commands are journal entries, never subscribable gameplay signals. */
export function commandTrace(event, context = {}, error) { write(event === "failed" ? "error" : "command", "control", event, context, error); }
