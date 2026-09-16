/** Progress rules only: no timers, Foundry documents, effects or rendering.
 * Generations never rewind, even when the author chooses step 1 again. */
export const scriptHasActivity = progress => Boolean(progress && (!["done", "stopped", "failed", "uncertain"].includes(progress.status)
  || progress.emojiEffect || progress.speechEffect));

export function clearScriptPresentation(progress, now = Date.now()) {
  const at = Math.max(now, Number(progress.emojiAt ?? 0) + 1, Number(progress.bubbleAt ?? 0) + 1);
  Object.assign(progress, { emoji: "", emojiAt: at, emojiEffect: null, bubble: null, bubbleAt: at, speechEffect: null });
}

export function interruptScriptProgress(progress, script, source, { now = Date.now(), next } = {}) {
  if (!scriptHasActivity(progress) || progress.interruption?.source === source) return false;
  const settings = script.interruptions ?? {};
  const error = settings.error ?? { mode: "stop", retries: 3, delaySeconds: 1 };
  let mode = source === "error" ? error.mode : settings[source] ?? "stop";
  // Ignoring an ordinary player command does not weaken the emergency stop.
  // The command executor waits for this foreground block instead of moving in parallel.
  if (source === "command" && mode === "ignore") return false;
  if (source === "error" && mode !== "stop") {
    if ((progress.errorRetries ?? 0) >= error.retries) mode = "stop";
    else progress.errorRetries = (progress.errorRetries ?? 0) + 1;
  }
  const current = script.steps.find(step => step.id === progress.stepId);
  const resumeStepId = mode === "restart-script" ? (script.steps.length ? 1 : null)
    : mode === "next-step" ? (current ? next(current) : null) : progress.stepId;
  clearScriptPresentation(progress, now);
  Object.assign(progress, {
    status: mode === "stop" ? (source === "error" ? "failed" : "stopped") : "interrupted",
    sequence: Number(progress.sequence ?? 0) + 1, generation: Number(progress.generation ?? 0) + 1,
    action: null, nextStepId: null,
    interruption: { source, mode, resumeStepId,
      ...(mode === "next-step" && current?.transition?.mode === "macro" ? { resumeTransition: true } : {}),
      retryAt: source === "error" && mode !== "stop" ? now + error.delaySeconds * 1000 : null }
  });
  return true;
}

export function resumeScriptProgress(progress, now = Date.now()) {
  const interruption = progress?.interruption;
  if (progress?.status !== "interrupted" || !interruption || interruption.retryAt > now) return false;
  progress.stepId = interruption.resumeStepId;
  progress.status = progress.stepId === null ? "done" : "ready";
  progress.action = interruption.resumeTransition ? { stepId: progress.stepId, phase: "branch", remainingMs: 0 } : null;
  progress.nextStepId = null; progress.interruption = null;
  if (progress.combat) progress.combat.confirmedStepId = null;
  return true;
}
