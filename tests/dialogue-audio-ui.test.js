import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDialogueAsset } from "../dmicher-master-screen/scripts/interaction-model.js";
import { dialogueObjectMessage, dialoguePlayerMessage, dialogueSessionView } from "../dmicher-master-screen/scripts/dialogue-history.js";
import { manualDialogueData } from "../dmicher-master-screen/scripts/manual-dialogues.js";
import { dialogueMessages, renderDialogueAudio, disposeDialogueAudio } from "../dmicher-master-screen/scripts/apps/dialogue-presentation.js";
import { renderAssetForm, readAssetForm } from "../dmicher-master-screen/scripts/apps/asset-forms.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { sceneFixture, dialogueData } from "./fixtures/scene.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";

test("page audio is optional, validated, exported and snapshotted separately from editable pages", async () => {
  const source = dialogueData();
  assert.equal(normalizeDialogueAsset(source).pages[0].audio, "");
  assert.equal(source.pages[0].audio, undefined);
  source.pages[0].audio = "worlds/example/voice.ogg";
  const f = sceneFixture(), saved = await f.assets.saveDialogue(source);
  assert.equal(f.assets.exportDialogue(saved.id).data.pages[0].audio, source.pages[0].audio);
  const session = { sessionId: "conversation", step: 0, nodeId: saved.startPageId };
  const message = dialogueObjectMessage(session, saved.pages[0], saved, { name: "NPC" });
  session.history = [message];
  saved.pages[0].audio = "changed.ogg";
  assert.equal(dialogueSessionView(session, saved, {}).history[0].audio, "worlds/example/voice.ogg");
  assert.equal(dialoguePlayerMessage(session, { label: "Yes" }, {}, {}).audio, undefined);
  assert.equal(manualDialogueData(saved).pages[0].audio, "changed.ogg");
  for (const audio of [5, true, {}, "x".repeat(1025)]) {
    assert.throws(() => normalizeDialogueAsset({ ...source, pages: [{ ...source.pages[0], audio }] }));
  }
});

test("unlicensed authoring hides audio controls and preserves configured paths while editing other fields", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const source = dialogueData(); source.pages[0].audio = "worlds/example/voice.ogg";
  const draft = normalizeDialogueAsset(source);
  const html = renderAssetForm({ kind: "dialogue", draft, pageId: draft.pages[0].id, mode: "constructor", catalog: { signals: [] }, bindings: [], objects: [], definitions: [] });
  assert.doesNotMatch(html, /name="dialoguePageAudio"/);
  const values = { assetName: "Updated name", assetDescription: "", dialogueStartPage: draft.startPageId,
    dialoguePageName: "Updated page", dialoguePageText: "Updated text", dialoguePageArt: "", dialoguePageImageAlignment: "right" };
  const root = {
    querySelector: (selector) => selector === "[data-asset-page]" ? { dataset: { assetPage: draft.pages[0].id } }
      : selector === '[name="dialoguePageAudio"]' ? null : { value: values[selector.match(/name="([^"]+)"/)?.[1]] ?? "" },
    querySelectorAll: () => []
  };
  const result = readAssetForm(root, draft, "dialogue");
  assert.equal(result.pages[0].audio, draft.pages[0].audio); assert.equal(result.name, "Updated name");
});

test("licensed authoring uses the Foundry audio picker field in both languages and stops accepting it on revocation", () => {
  let licensed = true;
  const registration = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => licensed, extensions: [{
    moduleId: "dmicher-master-screen", apiVersion: 1, methods: {
      resolveDialogueAudioPickerOptions: (_base, current) => ({ type: "audio", current }),
      resolveDialogueAudio: (_base, src, volume) => ({ src, volume, loop: false })
    }
  }] });
  try {
    const source = dialogueData(); source.pages[0].audio = "old.ogg";
    const draft = normalizeDialogueAsset(source);
    for (const [lang, label] of [["ru", "Звук блока"], ["en", "Page audio"]]) {
      globalThis.game = { i18n: { lang } };
      const html = renderAssetForm({ kind: "dialogue", draft, pageId: draft.pages[0].id, mode: "constructor", catalog: { signals: [] }, bindings: [], objects: [], definitions: [] });
      assert.ok(html.includes(label)); assert.match(html, /data-field="dialoguePageAudio"/);
    }
    const values = { assetName: draft.name, assetDescription: "", dialogueStartPage: draft.startPageId,
      dialoguePageName: "Page", dialoguePageText: "Text", dialoguePageArt: "", dialoguePageImageAlignment: "left", dialoguePageAudio: "new.ogg" };
    const root = { querySelector: (selector) => selector === "[data-asset-page]" ? { dataset: { assetPage: draft.pages[0].id } }
      : { value: values[selector.match(/name="([^"]+)"/)?.[1]] ?? "" }, querySelectorAll: () => [] };
    assert.equal(readAssetForm(root, draft, "dialogue").pages[0].audio, "new.ogg");
    licensed = false; registration.notifyChanged();
    assert.equal(readAssetForm(root, draft, "dialogue").pages[0].audio, "old.ogg");
  } finally { registration.dispose(); }
});

test("shared replay control follows playback state without rerendering a dialogue window", () => {
  const history = [{ id: "speech", role: "object", audio: "voice.ogg" }, { id: "reply", role: "player", audio: "forged.ogg" }];
  assert.deepEqual(dialogueMessages({ history }).map(({ hasAudio }) => hasAudio), [true, false]);
  let playing = true, replayed, disposed = false;
  const button = { dataset: { messageId: "speech" } };
  const application = { element: { querySelectorAll: () => [button] }, dialogueAudio: {
    sync: (value) => assert.equal(value, history), messageState: () => ({ available: true, playing, canReplay: !playing }),
    replay: (id) => { replayed = id; }, dispose: () => { disposed = true; }
  } };
  renderDialogueAudio(application, history); assert.equal(button.hidden, true);
  playing = false;
  renderDialogueAudio(application, history); assert.equal(button.hidden, false); assert.equal(button.disabled, false);
  let prevented = false, stopped = false;
  button.onclick({ preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  assert.equal(replayed, "speech"); assert.equal(prevented && stopped, true);
  disposeDialogueAudio(application); assert.equal(disposed, true); assert.equal(application.dialogueAudio, null);
});

test("live dialogue audio stops immediately on execution cancellation and remote invalidation without disabling manual reading", () => {
  const hooks = new Map(), scene = { id: "scene" }; let stopped = 0, current = true;
  globalThis.Hooks = { on(name, callback) { hooks.set(name, callback); return callback; }, off(name) { hooks.delete(name); } };
  const application = { element: { querySelectorAll: () => [] }, dialogueAudio: {
    sync() {}, stop() { stopped++; }, dispose() {}, replay() {}
  } };
  const lifecycle = { scene, isCurrent: () => current };
  renderDialogueAudio(application, [], lifecycle);
  notifyExecutionChange(scene, "halt-all"); assert.equal(stopped, 1);
  current = false; hooks.get("updateScene")(scene); assert.equal(stopped, 2);
  renderDialogueAudio(application, [], lifecycle); assert.equal(stopped, 3);
  renderDialogueAudio(application, []); // Manual reading supplies no scene lifetime.
  notifyExecutionChange(scene, "halt-all"); assert.equal(stopped, 3); assert.equal(hooks.size, 0);
  disposeDialogueAudio(application); assert.equal(hooks.size, 0);
});
