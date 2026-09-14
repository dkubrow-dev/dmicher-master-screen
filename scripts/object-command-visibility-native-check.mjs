import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

// Run the installed Foundry implementations unchanged in an isolated browser.
// Geometry/light inputs are a synthetic room; no world or Foundry server is used.
function nativeClass(source, name) {
  const start = source.indexOf(`class ${name} `), end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, `Missing native ${name}`);
  return source.slice(start, end + 2);
}
function nativeMethod(source, signature) {
  const start = source.indexOf(`  ${signature}`), end = source.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start, `Missing native ${signature}`);
  return source.slice(start, end + 4);
}
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
try {
  for (const version of ["13.351", "14.366"]) {
    const source = (await fs.readFile(`E:/Foundry Portable/Foundry VTT ${version}/App/resources/app/public/scripts/foundry.mjs`, "utf8")).replaceAll("\r\n", "\n");
    const context = await browser.newContext(), page = await context.newPage();
    await page.goto(`${fixture.origin}/?version=${version}`); await page.waitForFunction(() => globalThis.ready);
    const result = await page.evaluate(async (native) => {
      const { commandPointVisible, commandPointsVisible } = await import("/modules/dmicher-master-screen/scripts/object-command-visibility.js");
      const level = { id: "floor", elevation: { base: 0, bottom: -10, top: 10 } };
      let light = true, blind = false, creates = 0, destroys = 0;
      const wallX = 300;
      class Polygon {
        config = { angle: 360, rotation: 0, externalRadius: 0, type: "sight" };
        contains(x) { return x < wallX; }
      }
      class Token {}
      class DataModel { constructor(data) { Object.assign(this, data); } }
      const { Basic, Light } = new Function("DataModel", "Token$1", "PointSourcePolygon",
        `${native.base}\n${native.light}\nreturn {Basic:DetectionMode,Light:DetectionModeLightPerception};`)(DataModel, Token, Polygon);
      const prepare = new Function("Token$1", `return ({${native.prepare}})._createVisibilityTestConfig;`)(Token);
      const isVisionSource = new Function(`return ({${native.sourceEligibility}})._isVisionSource;`)();
      Math.mix ??= (a, b, t) => a + (b - a) * t;
      const generation = Number(native.version.split(".")[0]);
      const actor = { documentName: "Token", sight: { enabled: true }, level: "floor", hidden: false,
        hasStatusEffect: id => id === "blind" && blind,
        detectionModes: generation === 13
          ? [{ id: "basicSight", enabled: true, range: 5 }, { id: "lightPerception", enabled: true, range: Infinity }]
          : { basicSight: { enabled: true, range: 5 }, lightPerception: { enabled: true, range: Infinity } } };
      const token = actor.object = new Token();
      Object.assign(token, { document: actor, actor: { testUserPermission: () => true }, controlled: false,
        hasSight: true, layer: { controlled: [] }, getLightRadius: range => range * 20,
        _getVisionSourceData: () => ({ x: 100, y: 100, elevation: 0, level: "floor", angle: 360, rotation: 0, externalRadius: 0 }),
        _getVisionBlindedStates: () => ({ blind }) });
      class Source {
        static sourceType = "sight";
        blinded = {};
        constructor(options) { Object.assign(this, options); creates++; }
        initialize(data) { this.data = data; this.origin = data; this.level = level; this.los = new Polygon(); }
        get isBlinded() { return this.blinded.blind; }
        destroy() { destroys++; }
        add() { throw new Error("Detached vision was attached"); }
      }
      globalThis.CONFIG = { specialStatusEffects: { BLIND: "blind", BURROW: "burrow", INVISIBLE: "invisible" }, Canvas: {
        visionSourceClass: Source, detectionModes: { basicSight: new Basic({ type: 0, walls: true, angle: true }),
          lightPerception: new Light({ type: 0, walls: true, angle: true }) },
        polygonBackends: { sight: { testCollision: () => false } }
      } };
      globalThis.canvas = { level: generation >= 14 ? { id: "gm-viewed", elevation: { base: 50, bottom: 40, top: 60 } } : level,
        visibility: { tokenVision: true, _createVisibilityTestConfig: prepare },
        scene: { levels: new Map([["floor", level]]), testSurfaceCollision: () => false },
        effects: { testInsideLight: () => light } };
      game.release.generation = generation;
      game.user.isGM = true;
      const scene = { tokenVision: true };
      const absentAtAuthority = isVisionSource.call(token) === false;
      // Ten feet from origin: outside five-foot basic vision, but in lit LOS.
      const visibleLitDoor = commandPointsVisible(scene, actor, [{ x: 297, y: 100 }, { x: 303, y: 100 }]);
      const behindWall = commandPointVisible(scene, actor, { x: 350, y: 100 });
      light = false;
      const outsideRangeInDarkness = commandPointVisible(scene, actor, { x: 297, y: 100 });
      const insideBasicRange = commandPointVisible(scene, actor, { x: 150, y: 100 });
      blind = true;
      const blinded = commandPointVisible(scene, actor, { x: 150, y: 100 });
      return { absentAtAuthority, visibleLitDoor, behindWall, outsideRangeInDarkness, insideBasicRange, blinded,
        noSelection: !token.controlled, noAttachedSource: token.vision === undefined, creates, destroys };
    }, { version, base: nativeClass(source, "DetectionMode"), light: nativeClass(source, "DetectionModeLightPerception"),
      prepare: nativeMethod(source, "_createVisibilityTestConfig("), sourceEligibility: nativeMethod(source, "_isVisionSource()") });
    assert.deepEqual(result, { absentAtAuthority: true, visibleLitDoor: true, behindWall: false, outsideRangeInDarkness: false,
      insideBasicRange: true, blinded: false, noSelection: true, noAttachedSource: true, creates: 5, destroys: 5 });
    console.log(`${version}: native source eligibility, LOS/range/light perception and test levels passed`);
    await context.close();
  }
} finally { await browser.close(); await fixture.close(); }
