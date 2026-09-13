import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScriptStep } from "../dmicher-master-screen/scripts/script-model.js";
import { advanceScriptMovement } from "../dmicher-master-screen/scripts/script-movement.js";
import { planScriptApproach, planScriptFollow, advanceScriptFollow, appendFollowWaypoint, boundsGap, MAX_FOLLOW_WAYPOINTS, clipMovementByWalls } from "../dmicher-master-screen/scripts/script-target-movement.js";
import { sceneObjectBounds } from "../dmicher-master-screen/scripts/scene-object-geometry.js";

function fixture() {
  const scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, tokens: new Map(), tiles: new Map(), walls: new Map() };
  const create = (id, x, y, type = "Token") => ({ id, x, y, documentName: type, parent: scene, uuid: `Scene.scene.${type}.${id}`,
    width: type === "Token" ? 1 : 100, height: type === "Token" ? 1 : 100, rotation: 0,
    object: { checkCollision: () => false }, async update(changes) { Object.assign(this, changes); } });
  const npc = create("npc", 0, 0), target = create("target", 500, 0); scene.tokens.set(npc.id, npc); scene.tokens.set(target.id, target);
  return { scene, npc, target, gap: () => boundsGap(sceneObjectBounds(npc), sceneObjectBounds(target)) };
}
const parameters = (kind, supplied = {}) => normalizeScriptStep({ id: 1, kind, parameters: { targetUuid: "Scene.scene.Token.target", ...supplied } }).parameters;

test("target action parameters are typed, nonnegative and have explicit completion modes", () => {
  assert.equal(parameters("approach").timeMode, "duration"); assert.equal(parameters("approach").duration, 0);
  assert.equal(parameters("follow").mode, "trajectory"); assert.equal(parameters("follow").finishOn, "arrival");
  assert.equal(parameters("follow", { speed: 0.25 }).speed, 0.25);
  for (const invalid of [{ minDistance: -1 }, { minDistance: 10, maxDistance: 5 }, { speed: 0 }, { speed: "5" }, { finishOn: "forever" }, { mode: "pathfinder" }]) {
    assert.throws(() => parameters("follow", invalid));
  }
  assert.throws(() => parameters("approach", { distance: -1 })); assert.throws(() => parameters("approach", { duration: "2" }));
});
test("approach fixes a boundary destination at start, supports fractional duration and intentionally ignores walls", async () => {
  const f = fixture(); f.npc.object.checkCollision = () => { throw new Error("approach must bypass walls"); };
  const instant = planScriptApproach(f.scene, f.npc, parameters("approach"));
  await advanceScriptMovement(f.scene, f.npc, instant, 0, { ignoreObstacles: true }); assert.equal(f.npc.x, 400); assert.equal(f.gap(), 0);
  f.npc.x = 0;
  const timed = planScriptApproach(f.scene, f.npc, parameters("approach", { duration: 2.5, distance: 2 }));
  f.target.x = 900;
  await advanceScriptMovement(f.scene, f.npc, timed, 1.25, { ignoreObstacles: true }); assert.equal(f.npc.x, 180);
  await advanceScriptMovement(f.scene, f.npc, timed, 1.25, { ignoreObstacles: true }); assert.equal(f.npc.x, 360);
});
test("approach speed uses scene distance and invalid or own targets perform no movement", () => {
  const f = fixture(), movement = planScriptApproach(f.scene, f.npc, parameters("approach", { timeMode: "speed", speed: 10 }));
  assert.ok(Math.abs(movement.durationMs - 2000) < 0.000001);
  for (const targetUuid of ["", "Actor.target", "Scene.other.Token.target", f.npc.uuid, "Scene.scene.Token.missing"]) {
    assert.throws(() => planScriptApproach(f.scene, f.npc, parameters("approach", { targetUuid })));
  }
  assert.equal(f.npc.x, 0);
});
test("follow catches up by speed to the minimum boundary gap and supports both arrival and continuous modes", async () => {
  const f = fixture(), p = parameters("follow", { mode: "direct", minDistance: 1, maxDistance: 5 });
  const progress = planScriptFollow(f.scene, f.npc, p);
  assert.equal((await advanceScriptFollow(f.scene, f.npc, progress, p, 1)).done, false); assert.equal(f.npc.x, 100);
  for (let i = 0; i < 2; i++) await advanceScriptFollow(f.scene, f.npc, progress, p, 1);
  assert.equal((await advanceScriptFollow(f.scene, f.npc, progress, p, 1)).done, true); assert.equal(f.gap(), 20);
  const continuous = { ...p, finishOn: "state-change" }, ongoing = planScriptFollow(f.scene, f.npc, continuous);
  assert.equal((await advanceScriptFollow(f.scene, f.npc, ongoing, continuous, 100)).done, false); assert.equal(f.npc.x, 380);
  f.target.x = 560; await advanceScriptFollow(f.scene, f.npc, ongoing, continuous, 1); assert.equal(f.npc.x, 380);
  f.target.x = 700; await advanceScriptFollow(f.scene, f.npc, ongoing, continuous, 1); assert.equal(f.npc.x, 480);
});
test("follow does not retreat when already close and does not catch up elapsed time from a zero-budget resume", async () => {
  const f = fixture(); f.target.x = 50;
  const p = parameters("follow", { finishOn: "state-change", mode: "direct", minDistance: 1 }), progress = planScriptFollow(f.scene, f.npc, p);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 1); assert.equal(f.npc.x, 0);
  f.target.x = 1000;
  await advanceScriptFollow(f.scene, f.npc, progress, p, 0); assert.equal(f.npc.x, 0);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 0.5); assert.equal(f.npc.x, 50);
});
test("follow reuses Foundry movement collisions, waits before a wall and resumes when it is passable", async () => {
  const f = fixture(); let blocked = true;
  f.npc.object.checkCollision = (point, options) => {
    assert.equal(options.type, "move"); assert.equal(options.mode, "any");
    return blocked && point.x >= 250;
  };
  const p = parameters("follow", { mode: "direct", speed: 20 }), progress = planScriptFollow(f.scene, f.npc, p);
  const first = await advanceScriptFollow(f.scene, f.npc, progress, p, 1);
  assert.equal(first.done, false); assert.ok(f.npc.x < 200); assert.equal(progress.blocked, true);
  const x = f.npc.x; await advanceScriptFollow(f.scene, f.npc, progress, p, 1); assert.equal(f.npc.x, x);
  blocked = false; assert.equal((await advanceScriptFollow(f.scene, f.npc, progress, p, 1)).done, true); assert.equal(f.gap(), 0);
});
test("trajectory retains recorded corners through serialization and never shortcuts to the latest target", async () => {
  const f = fixture(), p = parameters("follow", { maxDistance: 0, finishOn: "state-change" });
  let progress = planScriptFollow(f.scene, f.npc, p);
  appendFollowWaypoint(progress, { x: 550, y: 550 }); appendFollowWaypoint(progress, { x: 1050, y: 550 });
  f.target.x = 1000; f.target.y = 500; progress = structuredClone(progress);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 4); assert.deepEqual([f.npc.x, f.npc.y], [400, 0]);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 2); assert.deepEqual([f.npc.x, f.npc.y], [500, 100]);
  assert.equal(progress.points[0].x, 550); assert.equal(progress.points[0].y, 550);
});
test("trajectory overflow rejects rather than dropping corners; collinear samples need no extra waypoints", () => {
  const progress = { mode: "trajectory", points: [], lastTarget: null };
  for (let x = 0; x < 1000; x++) appendFollowWaypoint(progress, { x, y: 0 }); assert.equal(progress.points.length, 2);
  const cornered = { mode: "trajectory", points: [], lastTarget: null };
  for (let x = 0; x < MAX_FOLLOW_WAYPOINTS; x++) appendFollowWaypoint(cornered, { x, y: x % 2 });
  assert.throws(() => appendFollowWaypoint(cornered, { x: MAX_FOLLOW_WAYPOINTS, y: 0 })); assert.equal(cornered.points.length, MAX_FOLLOW_WAYPOINTS);
});
test("trajectory keeps turns observed while the target is inside the waiting range", async () => {
  const f = fixture(); f.target.x = 100;
  const p = parameters("follow", { maxDistance: 20, finishOn: "state-change" }), progress = planScriptFollow(f.scene, f.npc, p);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 1);
  f.target.y = 300; appendFollowWaypoint(progress, { x: 150, y: 350 });
  await advanceScriptFollow(f.scene, f.npc, progress, p, 1); assert.equal(f.npc.x, 0);
  f.target.x = 600; appendFollowWaypoint(progress, { x: 650, y: 350 });
  await advanceScriptFollow(f.scene, f.npc, progress, p, 1);
  assert.deepEqual([f.npc.x, f.npc.y], [100, 0]);
  await advanceScriptFollow(f.scene, f.npc, progress, p, 1); assert.deepEqual([f.npc.x, f.npc.y], [100, 100]);
});
test("non-token collision uses the native backend and absent collision support never assumes a clear path", () => {
  const f = fixture(), original = globalThis.CONFIG;
  try {
    let count = 0;
    globalThis.CONFIG = { Canvas: { polygonBackends: { move: { testCollision: (_a, _b, options) => { count++; assert.equal(options.type, "move"); return false; } } } } };
    assert.equal(clipMovementByWalls(f.scene, { documentName: "Tile" }, { x: 0, y: 0 }, { x: 100, y: 0 }).blocked, false); assert.equal(count, 1);
    globalThis.CONFIG = {}; f.scene.walls.set("wall", {});
    assert.throws(() => clipMovementByWalls(f.scene, { documentName: "Tile" }, { x: 0, y: 0 }, { x: 100, y: 0 }));
  } finally { globalThis.CONFIG = original; }
});
