import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDialogueAsset, normalizeDialoguePresentation } from "../dmicher-master-screen/scripts/interaction-model.js";
import { renderAssetForm, readAssetForm } from "../dmicher-master-screen/scripts/apps/asset-forms.js";
import { renderDialogueTree, readDialoguePresentation } from "../dmicher-master-screen/scripts/apps/dialogue-asset-view.js";
import { dialogueData, sceneFixture } from "./fixtures/scene.js";

const configured = () => ({ mode: "window", windowChat: "confirm", visibility: "player", publicAudience: { allowTags: ["hero"], denyTags: ["secret"], range: 12.5 } });
const form = (values, { pageId, presentation = false } = {}) => ({
  querySelector(selector) {
    if (selector === "[data-asset-page]") return pageId ? { dataset: { assetPage: pageId } } : null;
    if (selector === "[data-dialogue-presentation]") return presentation ? {} : null;
    const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
    return Object.hasOwn(values, name) ? { value: values[name], checkValidity: () => true } : null;
  }, querySelectorAll: () => []
});
const context = draft => ({ kind: "dialogue", draft, mode: "constructor", catalog: { signals: [] }, bindings: [], objects: [], definitions: [] });

test("dialogue presentation defaults privately to chat without mutating preparation", async () => {
  const source = dialogueData(), before = structuredClone(source);
  const draft = normalizeDialogueAsset(source);
  assert.deepEqual(draft.presentation, { mode: "chat", windowChat: "none", visibility: "private", publicAudience: { allowTags: [], denyTags: [], range: null } });
  assert.deepEqual(source, before);
  const f = sceneFixture(), writes = f.writes();
  f.assets.list(); assert.equal(f.writes(), writes);
  const saved = await f.assets.saveDialogue({ ...source, presentation: configured() });
  assert.deepEqual(f.assets.exportDialogue(saved.id).data.presentation, configured());
});

test("dialogue presentation validates every enum, range and tag list on import", () => {
  for (const mode of ["chat", "window"]) for (const windowChat of ["none", "replies", "complete", "confirm"]) for (const visibility of ["private", "public", "player"]) {
    assert.equal(normalizeDialoguePresentation({ mode, windowChat, visibility }).mode, mode);
  }
  for (const value of [null, [], "chat"]) assert.throws(() => normalizeDialoguePresentation(value));
  for (const key of ["mode", "windowChat", "visibility"]) for (const value of [null, "unknown", false, 1]) assert.throws(() => normalizeDialoguePresentation({ [key]: value }));
  for (const range of [-1, Infinity, NaN, "5", false]) assert.throws(() => normalizeDialoguePresentation({ publicAudience: { range } }));
  for (const allowTags of [null, "hero", [1], [""], [" "]]) assert.throws(() => normalizeDialoguePresentation({ publicAudience: { allowTags } }));
  assert.deepEqual(normalizeDialoguePresentation({ publicAudience: { allowTags: [" hero ", "hero"] } }).publicAudience.allowTags, ["hero"]);
  assert.equal(normalizeDialoguePresentation({ publicAudience: { range: 0 } }).publicAudience.range, 0);
});

test("general and page editors expose separate controls in both localizations", () => {
  const draft = normalizeDialogueAsset({ ...dialogueData(), presentation: configured() });
  for (const lang of ["ru", "en"]) {
    globalThis.game = { i18n: { lang } };
    const general = renderAssetForm(context(draft)), block = renderAssetForm({ ...context(draft), pageId: "first" });
    assert.match(general, /name="assetName"/); assert.match(general, /name="dialogueDisplayMode"/);
    assert.match(general, /name="dialogueWindowChat"/); assert.match(general, /name="dialogueVisibility"/);
    assert.match(general, /name="dialogueAudienceRange"/); assert.match(general, /ms-dialogue-graph/);
    assert.doesNotMatch(general, /name="dialoguePageText"/);
    assert.match(block, /name="dialoguePageText"/); assert.match(block, /data-field="dialoguePageArt"/);
    assert.doesNotMatch(block, /name="assetName"|name="dialogueDisplayMode"|name="dialogueStartPage"|ms-dialogue-page-tabs/);
    assert.match(block, /data-screen-action="previewAsset"/);
  }
  const chat = renderAssetForm(context(normalizeDialogueAsset(dialogueData())));
  assert.match(chat, /name="dialogueVisibility"/); assert.doesNotMatch(chat, /name="dialogueWindowChat"|name="dialogueAudienceRange"/);
});

test("switching presentation modes retains hidden values, including no-publication window privacy", () => {
  const source = configured();
  const privateChat = readDialoguePresentation(form({ dialogueDisplayMode: "chat", dialogueVisibility: "private" }), source);
  assert.deepEqual(privateChat.publicAudience, source.publicAudience); assert.equal(privateChat.windowChat, "confirm");
  const privateWindow = readDialoguePresentation(form({ dialogueDisplayMode: "window", dialogueWindowChat: "none", dialogueVisibility: "private" }), privateChat);
  assert.equal(privateWindow.windowChat, "none"); assert.equal(privateWindow.visibility, "private");
  const publicWindow = readDialoguePresentation(form({ dialogueVisibility: "public", dialogueAudienceRange: "", dialogueAudienceAllowTags: "hero, mage", dialogueAudienceDenyTags: "" }), privateWindow);
  assert.equal(publicWindow.publicAudience.range, null); assert.deepEqual(publicWindow.publicAudience.allowTags, ["hero", "mage"]);
});

test("page form preserves dialogue settings while general form preserves page contents", () => {
  const draft = normalizeDialogueAsset({ ...dialogueData(), description: { ru: "Ru", en: "En" }, presentation: configured() });
  const page = readAssetForm(form({ dialoguePageName: "Page renamed", dialoguePageText: "Edited", dialoguePageArt: "icons/test.webp", dialoguePageImageAlignment: "right" }, { pageId: "first" }), draft, "dialogue");
  assert.deepEqual(page.presentation, draft.presentation); assert.deepEqual(page.description, draft.description);
  assert.equal(page.startPageId, draft.startPageId); assert.equal(page.name, draft.name);
  const general = readAssetForm(form({ assetName: "Renamed dialogue", dialogueStartPage: "first", dialogueDisplayMode: "chat", dialogueVisibility: "private" }, { presentation: true }), page, "dialogue");
  assert.deepEqual(general.pages, page.pages); assert.equal(general.presentation.windowChat, "confirm");
});

test("dialogue tree separates general and page selections, folds and escapes author text", () => {
  const draft = normalizeDialogueAsset({ ...dialogueData("<Dialog>"), id: "dialogue" });
  draft.pages[0].name = "<Page>";
  const html = renderDialogueTree([draft], { kind: "dialogue", id: draft.id, pageId: "first" });
  assert.match(html, /aria-level="1"/); assert.match(html, /aria-level="2"/);
  assert.match(html, /data-page-id="first" class="is-selected"/);
  assert.match(html, /&lt;Dialog&gt;/); assert.match(html, /&lt;Page&gt;/);
  assert.doesNotMatch(html, /<Dialog>|<Page>/);
  assert.match(renderDialogueTree([draft], { kind: "dialogue", id: draft.id }, new Set([draft.id])), /data-page-id="first" class="" hidden/);
});
