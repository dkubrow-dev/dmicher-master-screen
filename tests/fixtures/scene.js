import { MODULE_ID } from "../../dmicher-master-screen/scripts/model.js";
import { GroupEditor } from "../../dmicher-master-screen/scripts/group-editor.js";
import { SceneAssets } from "../../dmicher-master-screen/scripts/scene-assets.js";
import { SceneObjects } from "../../dmicher-master-screen/scripts/scene-objects.js";
import { SignalCatalog } from "../../dmicher-master-screen/scripts/signal-catalog.js";
export const clone = structuredClone;
export function merge(target, value) {
  for (const [key, next] of Object.entries(value)) {
    if (key.startsWith("-=")) { delete target[key.slice(2)]; continue; }
    if (next && typeof next === "object" && !Array.isArray(next)) { if (!target[key] || typeof target[key] !== "object") target[key] = {}; merge(target[key], next); }
    else target[key] = clone(next);
  }
}
export function sceneFixture() {
  let serial = 0, writes = 0;
  const gm = { id: "gm", isGM: true, role: 4, active: true }, macros = new Map();
  globalThis.game = { user: gm, users: new Map([[gm.id, gm]]), system: { id: "test" }, scenes: new Map(), modules: new Map(), combats: new Map(), paused: false };
  globalThis.foundry = { utils: { randomID: () => `id${++serial}` } }; globalThis.CONFIG = {};
  globalThis.fromUuid = async (uuid) => macros.get(uuid) ?? null;
  const create = (id) => {
    const scene = { id, uuid: `Scene.${id}`, name: id, flags: { [MODULE_ID]: {} }, grid: { size: 100, distance: 5 },
      getFlag(scope, key) { return clone(this.flags[scope]?.[key]); },
      async setFlag(scope, key, value) { writes++; let target = this.flags[scope] ??= {}; const parts = key.split("."); for (const part of parts.slice(0, -1)) target = target[part] ??= {}; merge(target, { [parts.at(-1)]: value }); },
      async update(changes) { for (const [path, value] of Object.entries(changes)) { const [, scope, ...parts] = path.split("."); if (!parts.length) { writes++; merge(this.flags[scope] ??= {}, value); } else await this.setFlag(scope, parts.join("."), value); } },
      toObject() { return { _id: id, name: id, flags: clone(this.flags), ...Object.fromEntries(["tokens", "tiles", "notes"].map((key) => [key, [...this[key].values()].map(({ id, x, y }) => ({ _id: id, x, y }))])) }; }
    };
    for (const key of ["tokens", "tiles", "notes", "lights", "sounds", "drawings", "templates", "walls", "regions"]) scene[key] = new Map();
    for (const tokenId of ["npc", "pc"]) scene.tokens.set(tokenId, { id: tokenId, documentName: "Token", uuid: `Scene.${id}.Token.${tokenId}`, parent: scene, name: tokenId, x: 0, y: 0, hidden: false });
    scene.tiles.set("counter", { id: "counter", documentName: "Tile", uuid: `Scene.${id}.Tile.counter`, parent: scene, name: "Counter", x: 0, y: 0, hidden: false });
    game.scenes.set(id, scene); return scene;
  };
  const scene = create("map"); globalThis.canvas = { scene };
  return { scene, create, macros, assets: new SceneAssets(scene), objects: new SceneObjects(scene), editor: new GroupEditor(scene), catalog: new SignalCatalog(scene), writes: () => writes };
}
export const descriptor = { type: "Token", id: "npc" };
export const shopData = (name = "Market") => ({ name, items: [{ id: "lot", data: { name: "Sword", type: "gear", system: { quantity: 7 } }, stock: 4 }] });
export const dialogueData = (name = "Conversation") => ({ name, pages: [{ id: "first", name: "Hello", text: "Welcome", responses: [{ id: "finish", label: "Bye" }] }] });
