import test from "node:test";
import assert from "node:assert/strict";
import { executeScriptFunction, listScriptFunctions, getScriptFunction, registerScriptFunctions } from "../dmicher-master-screen/scripts/script-functions/index.js";
import { normalizeScriptStep, scriptStepTemplate } from "../dmicher-master-screen/scripts/script-model.js";

test("a conflicting provider batch cannot partially replace the registry", () => {
  const fn={id:"test.duplicate",normalize:p=>p};
  assert.throws(()=>registerScriptFunctions([fn,{...fn}]));
  assert.equal(getScriptFunction(fn.id),undefined);
});

test("catalog constrains group scripts but keeps unavailable functions visible", () => {
  const entries = listScriptFunctions({ scope: "group", language: "en" });
  assert.equal(entries.find(row => row.id === "move").disabled, true);
  assert.equal(entries.find(row => row.id === "state").disabled, false);
  assert.equal(entries.find(row => row.id === "wait").path, "system.general.Wait");
  assert.equal(entries.find(row => row.id === "macro").premium, true);
});

test("catalog exposes useful descriptions and native object compatibility", () => {
  const tokenEntries = listScriptFunctions({ scope: "object", language: "en", owner: { documentName: "Token" } });
  assert.match(tokenEntries.find(row => row.id === "dialogue").description, /dialogue/i);
  assert.match(tokenEntries.find(row => row.id === "shop").description, /shop/i);
  assert.equal(tokenEntries.find(row => row.id === "dialogue").disabled, false);
  assert.equal(tokenEntries.find(row => row.id === "shop").disabled, false);

  const actorEntries = listScriptFunctions({ scope: "object", language: "en", owner: { documentName: "Actor" } });
  assert.equal(actorEntries.find(row => row.id === "dialogue").disabled, true);
  assert.equal(actorEntries.find(row => row.id === "shop").disabled, true);
  assert.match(actorEntries.find(row => row.id === "dialogue").reason, /source/i);

  const genericEntries = listScriptFunctions({ scope: "object", language: "en" });
  assert.equal(genericEntries.find(row => row.id === "dialogue").disabled, false);
  assert.equal(genericEntries.find(row => row.id === "shop").disabled, false);
  for (const descriptor of genericEntries) {
    assert.ok(descriptor.description);
    assert.notEqual(descriptor.description, descriptor.label);
  }
});

test("automation and pause steps validate preparation without executing it", () => {
  assert.deepEqual(normalizeScriptStep({ id: 1, ...scriptStepTemplate("automation") }).parameters, { objectUuid: "", enabled: true });
  assert.deepEqual(normalizeScriptStep({ id: 2, ...scriptStepTemplate("pause") }).parameters, {});
  assert.throws(() => normalizeScriptStep({ id: 1, kind: "automation", parameters: { objectUuid: "", enabled: "yes" } }));
});

test("pause function uses native world pause only while admitted", async () => {
  let calls = 0;
  globalThis.game = { togglePause(value, broadcast) { assert.equal(value, true); assert.equal(broadcast, true); calls++; } };
  await getScriptFunction("pause").execute({ admitted: () => false });
  await getScriptFunction("pause").execute({ admitted: () => true });
  assert.equal(calls, 1);
});

test("dispatcher rejects functions outside the current scope and native object type", async () => {
  const context = {
    engine: { runtime: { scriptScope: () => "group" } },
    scene: {},
    runId: "run",
    object: { documentName: "Token" }
  };
  await assert.rejects(() => executeScriptFunction("shop", context), /недоступно|unavailable/i);
  context.engine.runtime.scriptScope = () => "object";
  context.object.documentName = "Actor";
  await assert.rejects(() => executeScriptFunction("dialogue", context), /недоступно|unavailable/i);
});
