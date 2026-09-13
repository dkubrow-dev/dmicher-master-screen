import test from "node:test";
import assert from "node:assert/strict";
import { analyzeScriptWarnings, changedScriptWarnings } from "../dmicher-master-screen/scripts/script-warnings.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";

const step = (id, kind, parameters = {}, next = []) => ({ id, kind, parameters, next });

test("zero declared duration is an advisory for nonempty reachable scripts", () => {
  assert.deepEqual(analyzeScriptWarnings({ steps: [] }), { durationUnset: false, cycle: null, zeroDelayCycle: null });
  for (const action of [step(1, "emotion"), step(1, "speech"), step(1, "visibility"), step(1, "move", { duration: 0 }),
    step(1, "approach", { duration: 0 }), step(1, "dialogue", { waitMode: "none", tokenUuids: ["Scene.one.Token.two"] }), step(1, "dialogue")]) {
    assert.equal(analyzeScriptWarnings({ steps: [action] }).durationUnset, true);
  }
  for (const action of [step(1, "wait", { seconds: 0.01 }), step(1, "emotion", { executionMode: "parallel", duration: 0.25 }),
    step(1, "speech", { executionMode: "parallel", duration: 1 }), step(1, "move", { duration: 1 }), step(1, "approach", { duration: 1 }),
    step(1, "macro", { macroUuid: "Macro.one", before: 1 }), step(1, "signal", { signalId: "signal", after: 1 })]) {
    assert.equal(analyzeScriptWarnings({ steps: [action] }).durationUnset, false);
  }
});

test("unknown movement or dialogue time is never diagnosed as zero", () => {
  for (const action of [step(1, "move", { timeMode: "speed" }), step(1, "approach", { timeMode: "speed" }), step(1, "follow"), step(1, "dialogue", { tokenUuids: ["Scene.one.Token.two"] })]) {
    assert.equal(analyzeScriptWarnings({ steps: [action] }).durationUnset, false);
  }
});

test("only reachable graph cycles are reported, including random branches and Repeat", () => {
  const unreachable = { steps: [step(1, "emotion"), step(2, "wait", { seconds: 5 }, [3]), step(3, "emotion", {}, [2])] };
  assert.deepEqual(analyzeScriptWarnings(unreachable), { durationUnset: true, cycle: null, zeroDelayCycle: null });
  const branch = { steps: [step(1, "emotion", {}, [2, 4]), step(2, "wait", { seconds: 1 }, [3]), step(3, "emotion", {}, [2]), step(4, "emotion")] };
  assert.deepEqual(analyzeScriptWarnings(branch), { durationUnset: false, cycle: [2, 3, 2], zeroDelayCycle: null });
  assert.deepEqual(analyzeScriptWarnings({ repeat: true, steps: [step(1, "emotion", {}, [2]), step(2, "emotion")] }), { durationUnset: true, cycle: [1, 2, 1], zeroDelayCycle: [1, 2, 1] });
  assert.deepEqual(analyzeScriptWarnings({ steps: [step(1, "emotion", {}, [1])] }), { durationUnset: true, cycle: [1, 1], zeroDelayCycle: [1, 1] });
  const diamond = { steps: [step(1, "emotion", {}, [2, 3]), step(2, "emotion", {}, [4]), step(3, "emotion", {}, [4]), step(4, "emotion")] };
  assert.equal(analyzeScriptWarnings(diamond).cycle, null);
});

test("a zero-delay loop on another reachable branch is found after a positive-duration loop", () => {
  const script = { steps: [step(1, "wait", { seconds: 1 }, [2, 4]), step(2, "wait", { seconds: 2 }, [3]), step(3, "emotion", {}, [2]),
    step(4, "emotion", { executionMode: "parallel", duration: 5 }, [5]), step(5, "speech", { executionMode: "parallel", duration: 10 }, [4, 6]), step(6, "wait", { seconds: 3 })] };
  const warnings = analyzeScriptWarnings(script);
  assert.equal(warnings.durationUnset, false);
  assert.deepEqual(warnings.cycle, [2, 3, 2]);
  assert.deepEqual(warnings.zeroDelayCycle, [4, 5, 4]);
});

test("only a complete cycle with no configured blocking delay receives the zero-delay warning", () => {
  const zero = [step(1, "emotion", { executionMode: "parallel", duration: 7 }), step(1, "speech", { executionMode: "parallel", duration: 7 }),
    step(1, "emotion", { executionMode: "wait", duration: 0 }), step(1, "speech", { executionMode: "wait", duration: 0 }),
    step(1, "move", { duration: 0 }), step(1, "approach", { duration: 0 }), step(1, "state"),
    step(1, "macro", { macroUuid: "Macro.one" }), step(1, "signal", { signalId: "signal" }),
    step(1, "dialogue", { waitMode: "none", tokenUuids: ["Scene.one.Token.two"] }), step(1, "dialogue")];
  for (const action of zero) assert.deepEqual(analyzeScriptWarnings({ repeat: true, steps: [action] }).zeroDelayCycle, [1, 1], action.kind);
  const delayedOrUnknown = [step(1, "wait", { seconds: 0.01 }), step(1, "emotion", { executionMode: "wait", duration: 1 }),
    step(1, "speech", { executionMode: "wait", duration: 1 }), step(1, "move", { duration: 1 }), step(1, "approach", { duration: 1 }),
    step(1, "move", { timeMode: "speed" }), step(1, "approach", { timeMode: "speed" }), step(1, "follow"),
    step(1, "macro", { macroUuid: "Macro.one", after: 1 }), step(1, "signal", { signalId: "signal", before: 1 }),
    step(1, "dialogue", { tokenUuids: ["Scene.one.Token.two"] })];
  for (const action of delayedOrUnknown) assert.equal(analyzeScriptWarnings({ repeat: true, steps: [action] }).zeroDelayCycle, null, action.kind);
});

test("only changed script blocks need confirmation; canonical defaults and container ordering do not", () => {
  const script = { name: "Instant", steps: [step(1, "emotion")], repeat: true };
  const original = { initialScript: script, transitionScripts: { calm: script }, scripts: [{ ...script, stateId: "calm" }] };
  const canonical = { initialScript: normalizeScript(script), transitionScripts: { calm: normalizeScript(script) }, scripts: [normalizeScript({ ...script, stateId: "calm" })] };
  assert.deepEqual(changedScriptWarnings(original, canonical), []);
  const draft = structuredClone(canonical);
  draft.initialScript.name = "Reset";
  draft.transitionScripts.calm.steps[0].parameters.duration = 0.5;
  draft.scripts[0].steps[0].parameters.emoji = "!";
  assert.deepEqual(changedScriptWarnings(original, draft).map(({ kind, durationUnset, cycle }) => ({ kind, durationUnset, cycle })), [
    { kind: "initial", durationUnset: true, cycle: [1, 1] }, { kind: "transition", durationUnset: false, cycle: [1, 1] }, { kind: "routine", durationUnset: true, cycle: [1, 1] }
  ]);
  assert.deepEqual(changedScriptWarnings(original, { ...original, initialScript: null }), []);
});
