import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { ObjectVariableService, normalizeObjectVariables, objectVariableMacroSnippet } from "../dmicher-master-screen/scripts/object-variables.js";
import { signalMacroSnippet } from "../dmicher-master-screen/scripts/signal-macros.js";

function prepare() {
  const f = fixture();
  f.data.objectBindings.bindings["Token:npc"] = { variables: normalizeObjectVariables([
    { name: "count", type: "integer", value: 3 }, { name: "label", type: "text", value: "hello" },
    { name: "__proto__", type: "number", value: 0.5 }
  ]) };
  let active = true;
  const service = new ObjectVariableService(), scope = service.scope(f.scene, { object: "Scene.scene.Token.npc", current: () => active });
  return { ...f, service, scope, cancel: () => { active = false; } };
}

test("object variable reads use typed defaults without writes or prototype properties", async () => {
  const f = prepare();
  assert.equal(await f.scope.GetValue(f.scope.objectUuid, "count"), 3);
  assert.deepEqual(await f.scope.getVariables(), Object.fromEntries([["count", 3], ["label", "hello"], ["__proto__", 0.5]]));
  assert.equal(f.writes(), 0); assert.equal(f.data.objectVariableValues, undefined);
});

test("writes persist separate values and never rewrite defaults; identical writes are skipped", async () => {
  const f = prepare();
  await f.scope.SetValue(f.scope.objectUuid, "count", 7);
  await f.scope.SetValue(f.scope.objectUuid, "count", 7);
  assert.equal(await f.scope.GetValue(f.scope.objectUuid, "count"), 7);
  assert.equal(f.data.objectBindings.bindings["Token:npc"].variables[0].value, 3);
  assert.equal(f.writes(), 1);
  assert.equal(await f.service.scope(f.scene, { object: f.scope.objectUuid, current: () => true }).GetValue(f.scope.objectUuid, "count"), 7);
});

test("external access and internal write are independent and checked against current configuration", async () => {
  const f = prepare(), external = f.service.scope(f.scene, { object: "Scene.scene.Token.other", current: () => true });
  await assert.rejects(external.GetValue(f.scope.objectUuid, "count"));
  await assert.rejects(external.SetValue(f.scope.objectUuid, "count", 8));
  const settings = f.data.objectBindings.bindings["Token:npc"].variables[0].access;
  settings.externalRead = true;
  assert.equal(await external.GetValue(f.scope.objectUuid, "count"), 3);
  await assert.rejects(external.SetValue(f.scope.objectUuid, "count", 8));
  settings.externalWrite = true; settings.internal = false;
  await external.SetValue(f.scope.objectUuid, "count", 8);
  await assert.rejects(f.scope.SetValue(f.scope.objectUuid, "count", 9));
  assert.equal(await f.scope.GetValue(f.scope.objectUuid, "count"), 8);
});

test("invalid values, missing objects and stale capabilities cannot update variables", async () => {
  const f = prepare();
  for (const value of ["5", 0.5, Infinity, null]) await assert.rejects(f.scope.SetValue(f.scope.objectUuid, "count", value));
  await assert.rejects(f.scope.GetValue("Scene.other.Token.npc", "count"));
  f.cancel();
  await assert.rejects(f.scope.GetValue(f.scope.objectUuid, "count"));
  await assert.rejects(f.scope.SetValue(f.scope.objectUuid, "count", 2));
  assert.equal(f.writes(), 0);
});

test("player callers cannot establish a fake internal origin even with current=true", () => {
  const f = prepare(); globalThis.game.user.isGM = false;
  assert.throws(() => f.service.scope(f.scene, { object: f.scope.objectUuid, current: () => true }));
});

test("GetValue and SetValue special signal requests require UUID and variable name", async () => {
  const f = prepare();
  await f.scope.request("SetValue", { objectUuid: f.scope.objectUuid, name: "label", value: "changed" });
  assert.equal(await f.scope.request("GetValue", { objectUuid: f.scope.objectUuid, name: "label" }), "changed");
  assert.throws(() => f.scope.request("other", {}));
  await assert.rejects(f.scope.request("GetValue", { objectUuid: f.scope.objectUuid }));
});

test("variable definitions reject duplicate names, coercions and unsupported types", () => {
  for (const definitions of [[{ name: "x" }, { name: " x " }], [{ name: "x", type: "integer", value: "1" }], [{ name: "x", type: "boolean" }]])
    assert.throws(() => normalizeObjectVariables(definitions));
});

test("generated variable and signal macro templates safely read authored names", async () => {
  const f = prepare(), definitions = f.data.objectBindings.bindings["Token:npc"].variables;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction("context", `${objectVariableMacroSnippet(definitions)}\nreturn values;`);
  assert.equal((await execute(f.scope)).__proto__, 0.5);
  const snippet = signalMacroSnippet({ parameters: [], returns: [] }, { variables: definitions });
  const instance = await new AsyncFunction(snippet)();
  await instance.execute(f.scope);
});
