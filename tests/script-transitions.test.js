import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript, scriptStepTemplate } from "../dmicher-master-screen/scripts/script-model.js";
import { normalizeScriptTransition, scriptTransitionCandidates, scriptTransitionMacroTemplate, chooseScriptSuccessor } from "../dmicher-master-screen/scripts/script-transitions.js";
import { analyzeScriptWarnings } from "../dmicher-master-screen/scripts/script-warnings.js";
import { interruptScriptProgress, resumeScriptProgress } from "../dmicher-master-screen/scripts/script-interruptions.js";
import { initialScriptProgress } from "../dmicher-master-screen/scripts/script-runtime.js";

const wait = (id, next = []) => ({ id, kind: "wait", parameters: { seconds: 1 }, next });
test("transition defaults preserve existing graphs and new steps use row succession", () => {
  assert.equal(normalizeScript({ steps: [wait(1)] }).steps[0].transition.mode, "any");
  assert.equal(scriptStepTemplate("wait").transition.mode, "next");
  assert.throws(() => normalizeScriptTransition({ mode: "macro", macro: "return [;" }));
  assert.throws(() => normalizeScriptTransition({ mode: "random" }));
});
test("macro transition results reject coercion and only select existing integer IDs", () => {
  const script = { steps: [{ ...wait(1), transition: { mode: "macro" } }, wait(4)] };
  assert.deepEqual(scriptTransitionCandidates(script, script.steps[0], { macroResult: [4, 99, 4] }), [4]);
  for (const macroResult of [null, ["4"], [1.5], [0], {}]) assert.throws(() => scriptTransitionCandidates(script, script.steps[0], { macroResult }));
  assert.equal(chooseScriptSuccessor(script, script.steps[0], () => 0, { macroResult: [] }), null);
  assert.match(scriptTransitionMacroTemplate(script), /return \[1,4\]/);
});
test("graph warnings follow next-row edges and conservatively disclose inline macro cycles", () => {
  const script = { steps: [{ id: 1, kind: "emotion", parameters: { duration: 0 }, next: [], transition: { mode: "next" } },
    { id: 3, kind: "emotion", parameters: { duration: 0 }, next: [], transition: { mode: "macro", macro: "return [1];" } }] };
  assert.ok(analyzeScriptWarnings(script).zeroDelayCycle.includes(3));
});
test("next-step interruption defers branch evaluation until resumed without replaying the action", () => {
  const script = normalizeScript({ interruptions: { manual: "next-step" }, steps: [{ ...wait(1), transition: { mode: "macro", macro: "return [4];" } }, wait(4)] });
  const progress = initialScriptProgress(script);
  interruptScriptProgress(progress, script, "manual", { next: step => step.id });
  assert.equal(progress.interruption.resumeTransition, true);
  resumeScriptProgress(progress);
  assert.deepEqual(progress.action, { stepId: 1, phase: "branch", remainingMs: 0 });
});
