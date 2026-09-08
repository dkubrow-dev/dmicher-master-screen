import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIDEPreferences, clampRatio } from "../dmicher-master-screen/scripts/apps/screen-layout.js";
import { renderSceneTree, renderEventTree, renderParameters } from "../dmicher-master-screen/scripts/apps/ide-view.js";

test("IDE preferences retain usable areas and at least one recoverable tab per zone", () => {
  const value = normalizeIDEPreferences({ vertical: -100, horizontal: 100, hiddenMain: ["scene", "events", "macros", "other", "foreign"], hiddenDetail: ["parameters", "reference"], mainTab: "foreign", detailTab: "parameters" });
  assert.equal(value.vertical, 0.2); assert.equal(value.horizontal, 0.8);
  assert.equal(value.hiddenMain.length, 3); assert.equal(value.hiddenDetail.length, 1);
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
