import test from "node:test";
import assert from "node:assert/strict";
import { updateSceneNavigationBadges } from "../dmicher-master-screen/scripts/apps/group-badges.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

test("clock updates preserve navigation DOM; visible state changes update it once", () => {
  const definition = sampleGroupDefinition();
  let runtime = null, container = null, creations = 0, writes = 0;
  const scene = { id: "scene", getFlag(_scope, key) {
    if (key === "groupDefinitions") return { main: definition };
    if (key === "groupRuntimes") return { main: runtime };
  } };
  const row = { dataset: { sceneId: "scene" }, querySelector: () => container,
    append(value) { container = value; }, ownerDocument: { createElement() {
      creations++;
      return { set innerHTML(value) { this.markup = value; writes++; }, remove() { container = null; } };
    } } };
  const root = { querySelectorAll: selector => selector === ".ms-navigation-badges" ? (container ? [container] : []) : [row] };
  globalThis.game = { user: { isGM: true }, i18n: { lang: "en" }, scenes: new Map([[scene.id, scene]]) };
  const controller = { editor: { rendered: true }, mode: "director" };
  updateSceneNavigationBadges(controller, root);
  const original = container;
  for (let i = 0; i < 100; i++) updateSceneNavigationBadges(controller, root);
  assert.equal(container, original); assert.equal(creations, 1); assert.equal(writes, 1);
  runtime = { ...emptyRuntime("main"), stateId: definition.states[0].id, state: definition.states[0], halted: true };
  updateSceneNavigationBadges(controller, root);
  assert.equal(container, original); assert.equal(writes, 2);
  assert.ok(container.markup.includes('data-status="halted"'));
  controller.mode = null; updateSceneNavigationBadges(controller, root);
  assert.equal(container, null);
});
