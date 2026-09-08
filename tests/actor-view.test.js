import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } } };
const { isTokenVisibleFrom } = await import("../dmicher-master-screen/scripts/apps/actor-view.js");

function fixture() {
  const source = { active: true, isBlinded: false };
  const observer = { id: "pc", object: { vision: source }, sight: { enabled: true }, detectionModes: [{ id: "basicSight", enabled: true }] };
  const target = { id: "npc", x: 100, y: 0, object: {}, hasStatusEffect: () => false };
  let called = 0;
  const canvas = { scene: { tokenVision: true, grid: { size: 100 } }, visibility: { testVisibility: () => { throw new Error("GM-wide test must never be called"); } } };
  const config = { specialStatusEffects: { INVISIBLE: "invisible" }, Canvas: { detectionModes: {
    basicSight: { testVisibility: (testedSource, _mode, options) => {
      called++;
      assert.equal(testedSource, source);
      assert.equal(options.object, target.object);
      return true;
    } }
  } } };
  return { source, observer, target, canvas, config, options: { canvas, config }, called: () => called };
}

test("preview tests one native observer instead of the GM's combined visibility", () => {
  const f = fixture();
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), true);
  assert.equal(f.called(), 1);
});

test("hidden tokens and tokens on another v14 level are excluded before detection", () => {
  const f = fixture(); f.target.hidden = true;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
  f.target.hidden = false; f.observer.level = "ground"; f.target.level = "cellar";
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
  assert.equal(f.called(), 0);
});

test("missing or blinded vision never falls back to an unrestricted GM map", () => {
  const f = fixture(); f.source.active = false;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
  f.source.active = true; f.source.isBlinded = true;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
  f.source.isBlinded = false; f.observer.sight.enabled = false;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
});

test("v14 named detection modes and elevated native test points are supported", () => {
  const f = fixture(); f.observer.detectionModes = { basicSight: { enabled: true } };
  f.target.getVisibilityTestPoints = () => [{ x: 10, y: 20, elevation: 5 }];
  f.config.Canvas.detectionModes.basicSight.testVisibility = (_source, _mode, options) => {
    assert.equal(options.tests[0].point.elevation, 5);
    assert.ok(options.tests[0].los instanceof Map);
    return true;
  };
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), true);
});

test("detection failure and special senses do not reveal NPC artwork", () => {
  const f = fixture();
  f.config.Canvas.detectionModes.basicSight.testVisibility = () => { throw new Error("source is being removed"); };
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
  f.observer.detectionModes = [{ id: "tremor", enabled: true }];
  f.config.Canvas.detectionModes.tremor = { testVisibility: () => true };
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
});

test("unrestricted scene still hides hidden and invisible NPCs", () => {
  const f = fixture(); f.canvas.scene.tokenVision = false;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), true);
  f.target.hasStatusEffect = () => true;
  assert.equal(isTokenVisibleFrom(f.observer, f.target, f.options), false);
});
