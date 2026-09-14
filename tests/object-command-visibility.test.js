import test from "node:test";
import assert from "node:assert/strict";
import { commandPointsVisible, commandPointVisible } from "../dmicher-master-screen/scripts/object-command-visibility.js";

function fixture(generation = 13) {
  const calls = [], sources = new Map(), scene = { tokenVision: true }, level = { id: "floor" };
  const actor = { sight: { enabled: true }, detectionModes: generation === 13
    ? [{ id: "basicSight", enabled: true, range: 5 }, { id: "lightPerception", enabled: true, range: Infinity }]
    : { basicSight: { enabled: true, range: 5 }, lightPerception: { enabled: true, range: Infinity } } };
  const token = actor.object = { document: actor, hasSight: true, controlled: false,
    _getVisionSourceData: () => ({ x: 0, y: 0, elevation: 2, level: "floor" }),
    _getVisionBlindedStates: () => ({ blind: false }),
    control() { throw new Error("Must not select the commanding character"); } };
  class Source {
    constructor({ object, sourceId }) { this.object = object; this.sourceId = sourceId; this.blinded = {}; calls.push(["create", this]); }
    initialize(data) { this.data = data; this.los = {}; calls.push(["initialize"]); }
    add() { throw new Error("Must not attach a validation source"); }
    destroy() { calls.push(["destroy", this]); sources.delete(this.sourceId); }
    get isBlinded() { return Object.values(this.blinded).some(Boolean); }
  }
  const visible = (source, mode, config) => mode.enabled && !source.blinded.blind && config.tests.some(test => test.point.x < 100);
  globalThis.CONFIG = { Canvas: { visionSourceClass: Source, detectionModes: {
    basicSight: { testVisibility: (source, mode, config) => { calls.push(["basic", config]); return mode.range > 0 && visible(source, mode, config); } },
    lightPerception: { testVisibility: (source, mode, config) => { calls.push(["light", config]); return visible(source, mode, config); } }
  } } };
  globalThis.canvas = { level, visibility: { _createVisibilityTestConfig(input, { object, tolerance }) {
    assert.equal(tolerance, 0); assert.equal(Array.isArray(input), generation >= 14);
    return { object, level, tests: (generation >= 14 ? input : [input]).map(point => ({ point: { ...point, elevation: point.elevation ?? 0 }, level, los: new Map() })) };
  } } };
  globalThis.game = { user: { isGM: true }, release: { generation } };
  return { calls, sources, scene, actor, token, Source, level };
}

test("unselected character uses one disposable native source for all door faces without control or registration", () => {
  const f = fixture(), real = { sourceId: "Token.pc" }; f.sources.set(real.sourceId, real);
  const before = Object.keys(f.token);
  assert.equal(commandPointsVisible(f.scene, f.actor, [{ x: 120, y: 0 }, { x: 80, y: 0 }]), true);
  assert.equal(f.calls.filter(([call]) => call === "create").length, 1);
  assert.equal(f.calls.filter(([call]) => call === "destroy").length, 1);
  assert.equal(f.token.vision, undefined); assert.equal(f.token.controlled, false);
  assert.equal(f.sources.get(real.sourceId), real);
  assert.notEqual(f.calls[0][1].sourceId, real.sourceId);
  assert.deepEqual(Object.keys(f.token), before);
});

test("Foundry 14 dictionary and native test levels support light perception beyond basic sight", () => {
  const f = fixture(14); f.actor.detectionModes.basicSight.range = 0;
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 70, y: 2 }), true);
  const config = f.calls.find(([call]) => call === "light")[1];
  assert.equal(config.level, f.level); assert.equal(config.tests[0].level, f.level);
  assert.equal(config.tests[0].point.elevation, 0);
});

test("existing character source is reused and never destroyed", () => {
  const f = fixture(); f.token.vision = new f.Source({ object: f.token, sourceId: "actual" });
  f.token.vision.initialize(f.token._getVisionSourceData()); f.calls.length = 0;
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), true);
  assert.equal(f.calls.some(([call]) => call === "create" || call === "destroy"), false);
});

test("Foundry 14 target tests use the character's level rather than the authority GM's viewed level", () => {
  const f = fixture(14), actorLevel = { id: "upstairs", elevation: { base: 25 } };
  f.scene.levels = new Map([[actorLevel.id, actorLevel]]); f.actor.level = actorLevel.id;
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), true);
  const config = f.calls.find(([call]) => call === "basic")[1];
  assert.equal(config.level, actorLevel); assert.equal(config.tests[0].level, actorLevel);
  assert.equal(config.tests[0].point.elevation, 25);
});

test("wall/darkness denial, no sight and blindness stay denied instead of falling back to GM visibility", () => {
  const f = fixture();
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 200, y: 0 }), false);
  f.token._getVisionBlindedStates = () => ({ darkness: true });
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), false);
  f.token._getVisionBlindedStates = () => ({ blind: true });
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), false);
  f.token.hasSight = false;
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), false);
  f.scene.tokenVision = false;
  assert.equal(commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), true);
  assert.equal(f.calls.filter(([call]) => call === "create").length, 3);
  assert.equal(f.calls.filter(([call]) => call === "destroy").length, 3);
});

test("a failed native test still releases its detached source", () => {
  const f = fixture(); CONFIG.Canvas.detectionModes.basicSight.testVisibility = () => { throw new Error("native failure"); };
  assert.throws(() => commandPointVisible(f.scene, f.actor, { x: 20, y: 0 }), /native failure/);
  assert.equal(f.calls.filter(([call]) => call === "destroy").length, 1);
});
