import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDialogueAsset } from "../dmicher-master-screen/scripts/interaction-model.js";
import { renderAssetForm, readAssetForm } from "../dmicher-master-screen/scripts/apps/asset-forms.js";
import { sceneFixture, dialogueData } from "./fixtures/scene.js";

test("dialogue page alignment defaults left, validates an explicit side and survives JSON transfer", async () => {
  const source = dialogueData();
  assert.equal(normalizeDialogueAsset(source).pages[0].imageAlignment, "left");
  assert.equal(source.pages[0].imageAlignment, undefined);
  source.pages[0].imageAlignment = "right";
  const f = sceneFixture(), saved = await f.assets.saveDialogue(source), envelope = f.assets.exportDialogue(saved.id);
  assert.equal(envelope.data.pages[0].imageAlignment, "right");
  for (const bad of [null, "center", 0, true]) {
    assert.throws(() => normalizeDialogueAsset({ ...source, pages: [{ ...source.pages[0], imageAlignment: bad }] }));
  }
});

test("dialogue authoring displays a localized side selector and retains the native image picker", () => {
  const draft = normalizeDialogueAsset(dialogueData()), context = { kind: "dialogue", draft, pageId: draft.pages[0].id,
    mode: "constructor", catalog: { signals: [] }, bindings: [], objects: [], definitions: [] };
  for (const [lang, label] of [["ru", "Выравнивание изображения"], ["en", "Image alignment"]]) {
    globalThis.game = { i18n: { lang } };
    const html = renderAssetForm(context);
    assert.ok(html.includes(label)); assert.match(html, /name="dialoguePageImageAlignment"/);
    assert.match(html, /data-field="dialoguePageArt"/); assert.match(html, /value="left" selected/);
  }
});

test("editing alignment preserves other pages and the entered image URL", () => {
  const draft = normalizeDialogueAsset(dialogueData());
  const values = { assetName: draft.name, assetDescription: "", dialogueStartPage: draft.startPageId,
    dialoguePageName: "Changed", dialoguePageText: "Text", dialoguePageArt: "worlds/demo/art.webp", dialoguePageImageAlignment: "right" };
  const root = {
    querySelector: (selector) => selector === "[data-asset-page]" ? { dataset: { assetPage: draft.pages[0].id } }
      : { value: values[selector.match(/name="([^"]+)"/)?.[1]] ?? "" },
    querySelectorAll: () => []
  };
  const edited = readAssetForm(root, draft, "dialogue");
  assert.equal(edited.pages[0].imageAlignment, "right"); assert.equal(edited.pages[0].art, "worlds/demo/art.webp");
  assert.equal(draft.pages[0].imageAlignment, "left");
});
