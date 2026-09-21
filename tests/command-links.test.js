import test from "node:test";
import assert from "node:assert/strict";
import { createCommandLinks } from "../dmicher-master-screen/scripts/apps/command-links.js";
test("prepared command links require three visible participants and an allowed observer without per-frame reads", () => {
  const callbacks = new Map(), dom = new Map(), graphics = []; let reads = 0;
  const scene = { id:"scene", uuid:"Scene.scene", tokens:new Map(), walls:new Map(), getFlag() { reads++; return runs; } };
  const actor = { id:"pc", documentName:"Token" }, executor = { id:"npc", documentName:"Token" }, endpoint = { id:"door", documentName:"Wall" };
  scene.tokens.set(actor.id,actor); scene.tokens.set(executor.id,executor); scene.walls.set(endpoint.id,endpoint);
  const runs = { npc:{ config:{ id:"delegate" }, request:{ userId:"player", actorTokenUuid:"Scene.scene.Token.pc", targetUuid:"Scene.scene.Token.npc", parameters:{ targetUuid:"Scene.scene.Wall.door" } } } };
  globalThis.canvas = { scene }; globalThis.game = { user:{ id:"player" }, users:new Map(), settings:{ get:()=>({}) }, modules:new Map() };
  globalThis.Hooks = { on(name, fn) { callbacks.set(name,fn); return fn; }, off(name) { callbacks.delete(name); } };
  globalThis.window = { addEventListener(name,fn) { dom.set(name,fn); }, removeEventListener(name) { dom.delete(name); } };
  const links = createCommandLinks({ readWorld:()=>({}), readPlayer:()=>({}), hasAccess:()=>true, visible:doc=>!doc.hidden,
    graphic:()=> { const instance = { draw(documents,cursor,visible) { this.visible = !!visible; this.documents = documents; }, destroy() { this.destroyed = true; } }; graphics.push(instance); return instance; } });
  links.install(); assert.equal(graphics.length,1); assert.equal(graphics[0].visible,false);
  dom.get("keydown")({ code:"AltLeft" }); assert.equal(graphics[0].visible,true);
  const before = reads; for (let i=0;i<1000;i++) links.refresh(actor); assert.equal(reads,before);
  endpoint.hidden=true; links.refreshVisibility(); assert.equal(graphics[0].visible,false);
  endpoint.hidden=false; links.refreshVisibility(); assert.equal(graphics[0].visible,true);
  dom.get("keyup")({ code:"AltLeft" }); assert.equal(graphics[0].visible,false);
  game.user.id="other"; links.sync(); assert.equal(graphics.length,1); assert.equal(graphics[0].destroyed,true);
  game.user.isGM=true; links.sync(); assert.equal(graphics.length,2);
  callbacks.get("deleteToken")(actor); assert.equal(graphics[1].destroyed,true);
  links.dispose(); assert.equal(callbacks.size,0); assert.equal(dom.size,0); delete globalThis.window;
});
