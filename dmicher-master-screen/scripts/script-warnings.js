import { normalizeScript } from "./script-model.js";

/** Preparation diagnostics only: unknown target-dependent time is not zero.
 * Presentation lifetimes count even when the next step starts in parallel. */
function declaredDuration(step) {
  const p = step.parameters;
  if (step.kind === "wait") return p.seconds;
  if (["emotion", "speech"].includes(step.kind)) return p.duration;
  if (["signal", "macro"].includes(step.kind)) return p.before + p.after;
  if (["move", "approach"].includes(step.kind)) return p.timeMode === "duration" ? p.duration : null;
  if (step.kind === "dialogue") return p.waitMode === "none" || !p.tokenUuids.length ? 0 : null;
  if (step.kind === "follow") return null;
  return 0;
}

/** Lifetime is distinct from the delay before the next step. An asynchronous
 * macro may wait internally; only its explicitly configured delays are known. */
function blockingDelay(step) {
  if (["emotion", "speech"].includes(step.kind) && step.parameters.executionMode === "parallel") return 0;
  return declaredDuration(step);
}

/** A second DFS checks the zero-delay subgraph of all reachable steps. A slower
 * cycle found first must not conceal an immediate loop on another branch. */
export function analyzeScriptWarnings(source) {
  const script = normalizeScript(source), steps = new Map(script.steps.map(step => [step.id, step]));
  const scan = (roots, accepts = () => true) => {
    const colors = new Map(), path = []; let cycle = null;
    const visit = (id) => {
      const step = steps.get(id);
      if (!step || !accepts(step)) return;
      if (colors.get(id) === 1) { cycle ??= [...path.slice(path.indexOf(id)), id]; return; }
      if (colors.get(id) === 2) return;
      colors.set(id, 1); path.push(id);
      for (const next of step.next.length ? step.next : script.repeat ? [1] : []) visit(next);
      path.pop(); colors.set(id, 2);
    };
    roots.forEach(visit);
    return { cycle, reachable: [...colors.keys()] };
  };
  const graph = scan([1]);
  let duration = 0, unknownDuration = false;
  for (const id of graph.reachable) {
    const seconds = declaredDuration(steps.get(id));
    if (seconds === null) unknownDuration = true; else duration += seconds;
  }
  return { durationUnset: steps.size > 0 && duration === 0 && !unknownDuration, cycle: graph.cycle,
    zeroDelayCycle: scan(graph.reachable, step => blockingDelay(step) === 0).cycle };
}

function blocks(binding = {}) {
  return [
    { key: "initial", kind: "initial", script: binding.initialScript },
    ...Object.entries(binding.transitionScripts ?? {}).map(([stateId, script]) => ({ key: `transition:${stateId}`, kind: "transition", stateId, script })),
    ...(binding.scripts ?? []).map(script => ({ key: `routine:${script.stateId}`, kind: "routine", stateId: script.stateId, script })),
    ...(binding.commands ?? []).flatMap(command => [
      { key: `command:${command.id}:before`, kind: "command-before", script: command.beforeScript },
      { key: `command:${command.id}:after`, kind: "command-after", script: command.afterScript }
    ])
  ].filter(entry => entry.script);
}

/** Compare semantic saved blocks, not their UI defaults or order in a container.
 * Confirmation is needed again only after that particular script changes. */
export function changedScriptWarnings(original, draft) {
  const previous = new Map(blocks(original).map(entry => [entry.key, JSON.stringify(normalizeScript(entry.script))]));
  return blocks(draft).flatMap(entry => {
    const script = normalizeScript(entry.script);
    if (previous.get(entry.key) === JSON.stringify(script)) return [];
    const warnings = analyzeScriptWarnings(script);
    return warnings.durationUnset || warnings.cycle ? [{ kind: entry.kind, stateId: entry.stateId, name: script.name, ...warnings }] : [];
  });
}
