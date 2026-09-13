/** A bounded, client-local GM journal. No scene flags, sockets or live documents.
 * Filtering never changes stored entries: turning Debug off only hides traces. */
export const DIAGNOSTIC_LIMIT = 500;
const entries = [], listeners = new Set();
let sequence = 0;
const isGM = () => globalThis.game?.user?.isGM === true;
const relevant = (entry, sceneId) => !sceneId || !entry.context?.sceneId || entry.context.sceneId === sceneId;

/** A macro may throw any value, including an object with failing accessors. */
export function diagnosticError(error) {
  const read = (key, fallback, limit = 8000) => {
    try { return String(error?.[key] ?? fallback).slice(0, limit); }
    catch { return "[Unavailable]"; }
  };
  return { name: read("name", "Error", 200), message: read("message", error), stack: read("stack", "") };
}

/** Bound depth, item count and text together, including very large macro data. */
export function diagnosticSnapshot(value, seen = new WeakSet(), depth = 0, budget = { nodes: 512, characters: 16384 }) {
  if (--budget.nodes < 0 || budget.characters <= 0) return "[Truncated]";
  if (typeof value === "string") {
    const length = Math.min(value.length, 4000, budget.characters); budget.characters -= length;
    return value.slice(0, length) + (length < value.length ? "…" : "");
  }
  if (value === null || ["boolean", "number", "undefined"].includes(typeof value)) return value;
  if (typeof value !== "object") return diagnosticSnapshot(String(value), seen, depth, budget);
  if (depth > 12) return "[Depth limit]";
  if (seen.has(value)) return "[Circular]";
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return "[Non-plain object]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = [];
    // Sparse indexes must never set an enormous array length in the snapshot.
    for (let index = 0; index < Math.min(value.length, 100) && budget.nodes > 0 && budget.characters > 0; index++) {
      result.push(diagnosticSnapshot(value[index], seen, depth + 1, budget));
    }
    if (result.length < value.length) result.push("[Truncated]");
    seen.delete(value); return result;
  }
  const result = {};
  for (const key of Object.keys(value).slice(0, 100)) {
    if (budget.nodes <= 0 || key.length >= budget.characters) break;
    budget.characters -= key.length;
    // Define a data property so names such as __proto__ remain inert values.
    Object.defineProperty(result, key, { value: diagnosticSnapshot(value[key], seen, depth + 1, budget), enumerable: true, writable: true, configurable: true });
  }
  seen.delete(value); return result;
}

function notify(change) {
  for (const listener of listeners) {
    try { listener(change); } catch { /* Observers cannot affect the recorded operation. */ }
  }
}

export function appendDiagnostic(entry) {
  if (!isGM()) return;
  const copy = structuredClone(entry);
  copy.id = ++sequence;
  entries.push(copy);
  if (entries.length > DIAGNOSTIC_LIMIT) entries.splice(0, entries.length - DIAGNOSTIC_LIMIT);
  notify({ type: "append", id: copy.id, sceneId: copy.context?.sceneId });
}

export function getDiagnosticEntries({ sceneId, includeDebug = false } = {}) {
  if (!isGM()) return [];
  return structuredClone(entries.filter(entry => relevant(entry, sceneId) && (includeDebug || entry.level !== "debug")));
}

/** The Console consumes only new snapshots. A global cursor advances even for
 * hidden/other-scene entries; firstId lets the view discard expired rows without
 * cloning or scanning the retained history on every update. Reset after clear or
 * a filter change by omitting afterId. Returned snapshots remain detached. */
export function getDiagnosticUpdate({ sceneId, includeDebug = false, afterId = 0 } = {}) {
  // Losing GM access must also expire rows already displayed by this client.
  if (!isGM()) return { entries: [], cursor: 0, firstId: Infinity };
  const added = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.id <= afterId) break;
    if (relevant(entry, sceneId) && (includeDebug || entry.level !== "debug")) added.push(entry);
  }
  return { entries: structuredClone(added.reverse()), cursor: sequence, firstId: entries[0]?.id ?? sequence + 1 };
}

export function clearDiagnostics(sceneId) {
  if (!isGM()) return;
  for (let index = entries.length - 1; index >= 0; index--) if (relevant(entries[index], sceneId)) entries.splice(index, 1);
  notify({ type: "clear", sceneId });
}

export function subscribeDiagnostics(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
