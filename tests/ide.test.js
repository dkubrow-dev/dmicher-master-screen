import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIDEPreferences, clampRatio } from "../dmicher-master-screen/scripts/apps/screen-layout.js";
import { renderSceneTree, renderSignalTree, renderParameters, renderMenu } from "../dmicher-master-screen/scripts/apps/ide-view.js";
import { MAIN_MENU, menuRows, menuPath, menuParent, toggleMenuNode } from "../dmicher-master-screen/scripts/apps/navigation-tree.js";
import { groupBadges } from "../dmicher-master-screen/scripts/apps/group-badges.js";
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

test("group badges report the actual run colours and distinguish an unstarted or stopped group", () => {
  const definition = { groupId: "a", symbol: "A", groupName: "Group", states: [{ id: "one", name: "One", background: "#123456", textColor: "#ABCDEF" }] };
  assert.equal(groupBadges([definition], [])[0].status, "unstarted");
  const badge = groupBadges([definition], [{ groupId: "a", stateId: "one", halted: true }])[0];
  assert.equal(badge.background, "#123456"); assert.equal(badge.textColor, "#ABCDEF");
  assert.equal(badge.status, "halted"); assert.match(badge.title, /Group.*One/);
  assert.deepEqual(groupBadges([], []), []);
});

test("asset reverse references show only Actor tokens passing allow and deny lists", () => {
  const scene = { tokens: new Map([...["hero", "enemy", "object"].map((id) => [id, { id, name: id, actor: id === "object" ? null : { id, name: id } }])]) };
  const bindings = [{ type: "Token", id: "hero", tags: ["hero"] }, { type: "Token", id: "enemy", tags: ["hero", "hostile"] }, { type: "Token", id: "object", tags: ["hero"] }];
  assert.deepEqual(matchingActorTokens(scene, bindings, { allowTags: ["hero"], denyTags: ["hostile"] }).map((entry) => entry.id), ["hero"]);
  const refs = [...bindings, { type: "Tile", id: "menu", groupId: "s", dialogues: [{ dialogueId: "talk", stateIds: ["a"], conditions: { allowTags: ["hero"], denyTags: ["hostile"] } }] }];
  const html = renderAssetBindings("dialogue", "talk", refs, [{ type: "Tile", id: "menu", name: "<bad>" }], [{ groupId: "s", groupName: "S", states: [{ id: "a", name: "A" }] }], scene);
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
  const value = normalizeIDEPreferences({ vertical: -100, horizontal: 100, hiddenMain: ["scene", "signals", "macros", "other", "foreign"], hiddenDetail: ["parameters", "reference"], mainTab: "foreign", detailTab: "parameters" });
  assert.equal(value.vertical, 0.2); assert.equal(value.horizontal, 0.8);
  assert.equal(value.hiddenMain.length, 4); assert.equal(value.hiddenDetail.length, 1);
  assert.ok(!value.hiddenMain.includes(value.mainTab)); assert.ok(!value.hiddenDetail.includes(value.detailTab));
  assert.equal(clampRatio(NaN), 0.43);
});

test("scene tree disambiguates identical state IDs in different groups and leaves manual entry unrestricted", () => {
  const definitions = ["main", "alley"].map((groupId) => ({ groupId, groupName: groupId, states: [{ id: "calm", name: "Quiet", events: [], allowFromAll: false }] }));
  const html = renderSceneTree(definitions, [{ groupId: "alley", stateId: "calm" }], { kind: "state", id: "calm", groupId: "alley" }, "director");
  assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
  assert.equal((html.match(/data-screen-action="enterNode"/g) ?? []).length, 2);
  assert.ok(!html.includes("disabled"));
  assert.match(html, /data-group-id="alley"/);
});

test("tree markup treats names, IDs and colour values as data", () => {
  const html = renderSceneTree([{ groupId: 's" onmouseover="bad', groupName: "<script>bad</script>", background: 'red; background:url(bad)', textColor: "#123456", states: [{ id: "state", name: "<img onerror=bad>" }] }], [], {}, "constructor");
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("url(bad)"));
  assert.ok(!html.includes('id="s" onmouseover='));
});

test("incomplete colour drafts can be drawn without storing their preview fallback", () => {
  const draft = { groupName: "Draft", background: "#12", textColor: "#FFFFFF" };
  const html = renderParameters({ selection: { kind: "group", id: "main" }, draft, catalog: { events: [], triggers: [], macros: [] }, definitions: [], mode: "constructor" });
  assert.ok(html.includes('data-dmicher-color-text')); assert.equal(draft.background, "#12");
});
