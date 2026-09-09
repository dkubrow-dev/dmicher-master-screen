import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIDEPreferences, clampRatio } from "../dmicher-master-screen/scripts/apps/screen-layout.js";
import { renderSceneTree, renderEventTree, renderParameters, eventSources, renderMenu } from "../dmicher-master-screen/scripts/apps/ide-view.js";
import { MAIN_MENU, menuRows, menuPath, menuParent, toggleMenuNode } from "../dmicher-master-screen/scripts/apps/navigation-tree.js";
import { schemeBadges } from "../dmicher-master-screen/scripts/apps/scheme-badges.js";
import { matchingActorTokens, readAssetForm, renderAssetBindings, renderDialogueGraph } from "../dmicher-master-screen/scripts/apps/asset-forms.js";

test("menu categories aggregate descendants and remain navigation-only across three levels", () => {
  const nodes = [{ id: "root", children: [{ id: "nested", children: [{ id: "a" }, { id: "b" }] }, { id: "c" }] }, { id: "other" }];
  assert.deepEqual(menuPath(nodes, "a").map((node) => node.id), ["root", "nested", "a"]);
  assert.equal(menuParent("a", nodes), "nested");
  const hidden = toggleMenuNode(nodes, [], "nested", false);
  assert.deepEqual(hidden, ["a", "b"]);
  assert.equal(menuRows(nodes, hidden)[0].partial, true);
  assert.equal(menuRows(nodes, hidden)[1].visible, false);
  assert.equal(menuRows(nodes, hidden)[2].depth, 2);
  assert.deepEqual(toggleMenuNode(nodes, hidden, "root", true), []);
  assert.equal(toggleMenuNode([{ id: "only" }], [], "only", false), null);
  assert.deepEqual(MAIN_MENU.map((node) => node.id), ["scene", "tools", "automation", "other"]);
});

test("both menus keep one first-level carousel and place child navigation in closed overlays", () => {
  for (const zone of ["main", "detail"]) {
    const html = renderMenu(zone, [], zone === "main" ? "shops" : "parameters", "tools");
    assert.equal((html.match(/class="ms-menu-level"/g) ?? []).length, 1);
    assert.equal((html.match(/role="menubar"/g) ?? []).length, 1);
    assert.equal((html.match(/data-screen-action="scrollMenu"/g) ?? []).length, 2);
    assert.ok(!html.includes('aria-expanded="true"'));
    if (zone === "main") { assert.ok(html.includes('popover="manual"')); assert.ok(html.includes('data-menu-popup="tools"')); }
  }
});

test("scheme badges report the actual run colours and distinguish an unstarted or stopped scheme", () => {
  const definition = { schemeId: "a", symbol: "A", schemeName: "Scheme", episodes: [{ id: "one", name: "One", background: "#123456", textColor: "#ABCDEF" }] };
  assert.equal(schemeBadges([definition], [])[0].status, "unstarted");
  const badge = schemeBadges([definition], [{ schemeId: "a", episodeId: "one", halted: true }])[0];
  assert.equal(badge.background, "#123456"); assert.equal(badge.textColor, "#ABCDEF");
  assert.equal(badge.status, "halted"); assert.match(badge.title, /Scheme.*One/);
  assert.deepEqual(schemeBadges([], []), []);
});

test("source inventory names built-in and configured events without creating definitions", () => {
  const definitions = [{ schemeId: "s", schemeName: "S", episodes: [{ id: "e", name: "E", zones: [{ id: "z", eventName: "door.opened" }], tokens: { guard: { interaction: { eventName: "guard.asked" }, patrol: { points: [{ eventName: "guard.arrived" }] } } } }] }];
  const before = structuredClone(definitions), sources = eventSources(definitions, { tokens: new Map() });
  assert.equal(sources.find((row) => row.type === "zone").detail, "zone.entered, door.opened");
  assert.equal(sources.find((row) => row.type === "npc").detail, "npc.interacted, guard.asked");
  assert.equal(sources.find((row) => row.type === "patrol").detail, "patrol.arrived, guard.arrived");
  assert.deepEqual(definitions, before);
});

test("catalog dialogue and object patrol sources link to their owning editor without duplicating IDs", () => {
  const definitions = [{ schemeId: "s", schemeName: "S", episodes: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }];
  const assets = { dialogues: [{ id: "talk", name: "Talk", pages: [{ responses: [{ eventName: "bell" }] }] }] };
  const bindings = [{ type: "Tile", id: "menu", schemeId: "s", dialogue: { dialogueId: "talk", episodeIds: ["a"] } },
    { type: "Token", id: "guard", schemeId: "s", features: [{ id: "walk", kind: "patrol", episodeIds: [], patrol: { points: [{ eventName: "arrived" }] } }] }];
  const sources = eventSources(definitions, { tokens: new Map(), tiles: new Map() }, { assets, bindings });
  assert.equal(sources.filter((row) => row.assetId === "talk").length, 1);
  assert.equal(sources.find((row) => row.assetId === "talk").detail, "dialogue.finished, bell");
  assert.equal(sources.filter((row) => row.objectTarget?.id === "guard").length, 2);
  assert.equal(new Set(sources.map((row) => row.id)).size, sources.length);
});

test("asset reverse references show only Actor tokens passing allow and deny lists", () => {
  const scene = { tokens: new Map([...["hero", "enemy", "object"].map((id) => [id, { id, name: id, actor: id === "object" ? null : { id, name: id } }])]) };
  const bindings = [{ type: "Token", id: "hero", tags: ["hero"] }, { type: "Token", id: "enemy", tags: ["hero", "hostile"] }, { type: "Token", id: "object", tags: ["hero"] }];
  assert.deepEqual(matchingActorTokens(scene, bindings, { allowTags: ["hero"], denyTags: ["hostile"] }).map((entry) => entry.id), ["hero"]);
  const refs = [...bindings, { type: "Tile", id: "menu", schemeId: "s", dialogue: { dialogueId: "talk", episodeIds: ["a"], trigger: { allowTags: ["hero"], denyTags: ["hostile"] } } }];
  const html = renderAssetBindings("dialogue", "talk", refs, [{ type: "Tile", id: "menu", name: "<bad>" }], [{ schemeId: "s", schemeName: "S", episodes: [{ id: "a", name: "A" }] }], scene);
  assert.ok(html.includes("&lt;bad&gt;")); assert.ok(!html.includes("<bad>"));
  assert.equal((html.match(/data-screen-action="objectInfo"/g) ?? []).length, 1);
});

test("editing shop stock preserves opaque Item data and rejects incomplete or fractional quantities", () => {
  const draft = { id: "shop", name: "Shop", description: { ru: "", en: "" }, display: "tiles", items: [{ id: "item", stock: 2, data: { name: "A", system: { quantity: 9, custom: [1, 2] } } }] };
  const fields = { assetName: { value: "Shop" }, assetDescription: { value: "" }, shopImg: { value: "" }, shopDisplay: { value: "tiles" }, shopApproval: { checked: true } };
  const stock = { value: "3", dataset: { entryId: "item" }, checkValidity() { return Number.isInteger(Number(this.value)); } };
  const root = { querySelector: (selector) => fields[/name="([^"]+)"/.exec(selector)?.[1]], querySelectorAll: () => [stock] };
  const next = readAssetForm(root, draft, "shop"); assert.equal(next.items[0].stock, 3); assert.deepEqual(next.items[0].data, draft.items[0].data); assert.deepEqual(next.description, draft.description); assert.equal(draft.items[0].stock, 2);
  stock.value = "1.5"; assert.throws(() => readAssetForm(root, draft, "shop")); stock.value = ""; assert.throws(() => readAssetForm(root, draft, "shop"));
  assert.ok(!renderDialogueGraph([{ id: "p", name: "<page>", responses: [{ label: "<reply>", eventName: "<event>" }] }], "p").includes("<event>"));
});

test("IDE preferences retain usable areas and at least one recoverable tab per zone", () => {
  const value = normalizeIDEPreferences({ vertical: -100, horizontal: 100, hiddenMain: ["scene", "events", "macros", "other", "foreign"], hiddenDetail: ["parameters", "reference"], mainTab: "foreign", detailTab: "parameters" });
  assert.equal(value.vertical, 0.2); assert.equal(value.horizontal, 0.8);
  assert.equal(value.hiddenMain.length, 4); assert.equal(value.hiddenDetail.length, 1);
  assert.ok(!value.hiddenMain.includes(value.mainTab)); assert.ok(!value.hiddenDetail.includes(value.detailTab));
  assert.equal(clampRatio(NaN), 0.43);
});

test("scene tree disambiguates identical episode IDs in different schemes and leaves manual entry unrestricted", () => {
  const definitions = ["main", "alley"].map((schemeId) => ({ schemeId, schemeName: schemeId, episodes: [{ id: "calm", name: "Quiet", events: [], allowFromAll: false }] }));
  const html = renderSceneTree(definitions, [{ schemeId: "alley", episodeId: "calm" }], { kind: "episode", id: "calm", schemeId: "alley" }, "director");
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.equal((html.match(/data-screen-action="enterNode"/g) ?? []).length, 2);
  assert.ok(!html.includes("disabled"));
  assert.match(html, /data-scheme-id="alley"/);
});

test("tree markup treats names, IDs and colour values as data", () => {
  const html = renderSceneTree([{ schemeId: 's" onmouseover="bad', schemeName: "<script>bad</script>", background: 'red; background:url(bad)', textColor: "#123456", episodes: [{ id: "episode", name: "<img onerror=bad>" }] }], [], {}, "constructor");
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("url(bad)"));
  assert.ok(!html.includes('id="s" onmouseover='));
});

test("typed events expose the parent-child relationship and built-in definitions remain read-only", () => {
  const catalog = { events: [{ id: "event", name: "A < B", builtin: true, subscribers: [] }], triggers: [{ id: "trigger", name: "Data", eventId: "event", parameters: [] }], macros: [] };
  const tree = renderEventTree(catalog, { kind: "trigger", id: "trigger" }, "constructor");
  assert.equal((tree.match(/aria-level="2"/g) ?? []).length, 1); assert.ok(tree.includes("A &lt; B"));
  const html = renderParameters({ selection: { kind: "event", id: "event" }, draft: catalog.events[0], catalog, definitions: [], mode: "constructor" });
  assert.ok(html.includes("<fieldset disabled>")); assert.ok(!html.includes('type="submit"'));
});

test("incomplete colour drafts can be drawn without storing their preview fallback", () => {
  const draft = { schemeName: "Draft", background: "#12", textColor: "#FFFFFF" };
  const html = renderParameters({ selection: { kind: "scheme", id: "main" }, draft, catalog: { events: [], triggers: [], macros: [] }, definitions: [], mode: "constructor" });
  assert.ok(html.includes('data-dmicher-color-text')); assert.equal(draft.background, "#12");
});

test("only nested-trigger subscribers show a static JSON payload editor", () => {
  const catalog = { events: [], triggers: [{ id: "trigger", name: "Payload" }], macros: [] };
  const draft = { id: "event", name: "event", subscribers: [{ kind: "builtin", action: "pause" }, { kind: "trigger", triggerId: "trigger", parameters: { value: 1 } }] };
  const html = renderParameters({ selection: { kind: "event", id: "event" }, draft, catalog, definitions: [], mode: "constructor" });
  assert.equal((html.match(/name="subscriberParameters"/g) ?? []).length, 1);
});
