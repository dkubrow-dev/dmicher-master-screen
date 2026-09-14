import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/dialogue-audio-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const language of ["ru", "en"]) for (const version of ["13.351", "14.366"]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 920 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      await controller.editor.close();
      const { generics } = await import("/modules/dmicher-master-screen/scripts/generics.js");
      const { renderAssetForm, bindAssetPremiumControls } = await import("/modules/dmicher-master-screen/scripts/apps/asset-forms.js");
      const { normalizeDialogueAsset } = await import("/modules/dmicher-master-screen/scripts/interaction-model.js");
      const { DialogueVolumeController } = await import("/modules/dmicher-master-screen/scripts/dialogue-volume.js");
      globalThis.audioLicensed = true; globalThis.audioCalls = []; globalThis.audioSounds = [];
      globalThis.audioProvider = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => audioLicensed, extensions: [{
        moduleId: "dmicher-master-screen", apiVersion: 1, methods: {
          resolveDialogueAudioPickerOptions: (_base, current) => ({ type: "audio", current }),
          resolveDialogueAudio: (_base, src, volume) => ({ src, volume, loop: false })
        }
      }] });
      game.audio = { interface: {}, create: ({ src }) => {
        const sound = { src, volume: 1, async load() {}, async play(options) { this.volume = options.volume; this.ended = options.onended; audioCalls.push(src); },
          async stop() { this.stopped = true; }, end() { this.ended?.(); } };
        audioSounds.push(sound); return sound;
      } };
      globalThis.audioDraft = normalizeDialogueAsset({ id: "audio-qa", name: "Keeper's greeting", startPageId: "first", pages: [
        { id: "first", name: "Greeting", text: "Welcome to the town. How may I help you?", art: "icons/svg/book.svg", audio: "worlds/qa/welcome.ogg", responses: [{ id: "next", label: "Tell me more", nextPageId: "next" }] },
        { id: "next", name: "Directions", text: "The market is open. Follow this street to the square.", audio: "worlds/qa/directions.ogg", responses: [] }
      ] });
      globalThis.audioFormContext = { kind: "dialogue", draft: audioDraft, pageId: "first", mode: "constructor", catalog: { signals: [] }, bindings: [], objects: [], definitions: [] };
      const panel = document.createElement("section"); panel.id = "audio-authoring"; panel.className = "application dmicher-window dmicher-master-screen"; panel.dataset.dmicherTheme = "dark";
      Object.assign(panel.style, { position: "fixed", top: "50px", left: "65px", width: "710px", height: "790px", overflow: "auto", padding: "16px", background: "#20252d" });
      panel.innerHTML = renderAssetForm(audioFormContext); document.body.append(panel);
      globalThis.unbindAudioForm = bindAssetPremiumControls(panel);
      const volume = document.createElement("aside"); volume.id = "audio-volume"; volume.className = "application sidebar-tab";
      Object.assign(volume.style, { position: "fixed", top: "50px", right: "20px", width: "325px", padding: "12px", background: "#20252d", color: "#eee" });
      volume.innerHTML = '<section id="global-volume"><ol class="playlist-sounds"></ol></section>'; document.body.append(volume);
      globalThis.audioVolume = new DialogueVolumeController(); audioVolume.install(); audioVolume.render(null, volume);
    });
    const field = page.locator('#audio-authoring [name="dialoguePageAudio"]');
    assert.equal(await field.inputValue(), "worlds/qa/welcome.ogg");
    assert.equal(await field.isEnabled(), true);
    assert.equal(await page.locator('#audio-authoring [data-dialogue-audio-controls] .dmicher-premium-badge').textContent(), "Premium");
    assert.ok((await field.locator('..').textContent()).includes(language === "en" ? "Page audio" : "\u0417\u0432\u0443\u043a \u0431\u043b\u043e\u043a\u0430"));
    assert.equal(await page.locator('[data-dmicher-dialogue-volume] label').evaluate(label => label.firstChild.textContent), language === "en" ? "Dialogues" : "\u0414\u0438\u0430\u043b\u043e\u0433\u0438");
    assert.equal(await page.locator('[data-dmicher-dialogue-volume] .dmicher-premium-badge').textContent(), "Premium");
    const picker = await page.evaluate(async () => {
      const { MasterScreenApplication } = await import("/modules/dmicher-master-screen/scripts/apps/ide.js");
      const element = document.querySelector("#audio-authoring");
      const application = { selectionSceneId: "qa", selection: { id: audioDraft.id }, parameterRevision: 1, rendered: true, mode: "constructor", element };
      foundry.applications.apps ??= {}; const previous = foundry.applications.apps.FilePicker;
      let options;
      foundry.applications.apps.FilePicker = { implementation: class { constructor(value) { options = value; } render() {} } };
      try {
        const button = element.querySelector('[data-field="dialoguePageAudio"]');
        await MasterScreenApplication.prototype.handleAction.call(application, "assetFilePicker", button);
        const type = options.type, current = options.current;
        options.callback("worlds/qa/uploaded.ogg"); const selected = element.querySelector('[name="dialoguePageAudio"]').value;
        audioLicensed = false; audioProvider.notifyChanged(); options.callback("worlds/qa/forbidden.ogg");
        const revoked = element.querySelector('[name="dialoguePageAudio"]').value;
        audioLicensed = true; audioProvider.notifyChanged(); application.parameterRevision++;
        options.callback("worlds/qa/stale.ogg");
        return { type, current, selected, revoked, stale: element.querySelector('[name="dialoguePageAudio"]').value };
      } finally { foundry.applications.apps.FilePicker = previous; }
    });
    assert.deepEqual(picker, { type: "audio", current: "worlds/qa/welcome.ogg", selected: "worlds/qa/uploaded.ogg", revoked: "worlds/qa/uploaded.ogg", stale: "worlds/qa/uploaded.ogg" });
    await page.evaluate(() => {
      const outer = document.querySelector('#audio-authoring [data-ide-parameters] > fieldset'); outer.disabled = true;
      audioLicensed = false; audioProvider.notifyChanged(); audioLicensed = true; audioProvider.notifyChanged();
    });
    assert.equal(await field.isDisabled(), true, "Premium does not override the enclosing save/read-only fieldset");
    await page.evaluate(() => { document.querySelector('#audio-authoring [data-ide-parameters] > fieldset').disabled = false; });
    assert.equal(await field.isEnabled(), true);
    await page.evaluate(() => { audioLicensed = false; audioProvider.notifyChanged(); });
    assert.equal(await field.isVisible(), true); assert.equal(await field.isDisabled(), true);
    assert.equal(await page.locator('#audio-authoring [data-field="dialoguePageAudio"]').isDisabled(), true);
    assert.equal(await page.locator('[data-dmicher-dialogue-volume] input').isDisabled(), true);
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${version}-${language}-free-controls.png`) });
    await page.evaluate(() => { audioLicensed = true; audioProvider.notifyChanged(); });
    await page.screenshot({ path: path.join(output, `${version}-${language}-authoring.png`) });
    await page.evaluate(async () => {
      unbindAudioForm(); document.querySelector("#audio-authoring").remove();
      const { ManualDialogueApplication } = await import("/modules/dmicher-master-screen/scripts/apps/manual-dialogue.js");
      globalThis.audioDialogue = new ManualDialogueApplication({ dialogue: audioDraft, sourceName: "Keeper", invitationId: "audio-qa", gmPreview: true });
      await audioDialogue.render({ force: true });
    });
    await page.waitForFunction(() => audioCalls.length === 1);
    assert.equal(await page.locator('.ms-dialogue-audio-replay:visible').count(), 0);
    await page.evaluate(async () => { await audioDialogue.render({ force: true }); audioSounds.at(-1).end(); });
    assert.equal(await page.evaluate(() => audioCalls.length), 1);
    const replay = page.locator('.ms-dialogue-audio-replay:visible');
    assert.equal(await replay.count(), 1);
    const size = await replay.boundingBox(); assert.ok(size.width <= 28 && size.height <= 28);
    await page.screenshot({ path: path.join(output, `${version}-${language}-replay.png`) });
    await replay.click(); await page.waitForFunction(() => audioCalls.length === 2);
    await page.evaluate(async () => { audioDialogue.constructor.answer.call(audioDialogue, null, { dataset: { responseId: "next", pageId: "first" } }); await audioDialogue.renderPromise; });
    await page.waitForFunction(() => audioCalls.length === 3);
    assert.deepEqual(await page.evaluate(() => audioCalls), ["worlds/qa/welcome.ogg", "worlds/qa/welcome.ogg", "worlds/qa/directions.ogg"]);
    assert.equal(await page.evaluate(() => audioSounds[1].stopped), true);
    await page.evaluate(async () => {
      audioLicensed = false; audioProvider.notifyChanged();
      await audioDialogue.render({ force: true });
    });
    assert.equal(await page.locator('[data-dmicher-dialogue-volume]').count(), 1);
    assert.equal(await page.locator('[data-dmicher-dialogue-volume] input').isDisabled(), true);
    assert.equal(await page.locator('.ms-dialogue-audio-replay:visible').count(), 0);
    assert.equal(await page.evaluate(() => audioSounds.at(-1).stopped && audioSounds.at(-1).volume === 0), true);
    assert.equal(await page.evaluate(() => audioCalls.length), 3);
    const unlicensed = await page.evaluate(async () => {
      const { renderAssetForm, readAssetForm } = await import("/modules/dmicher-master-screen/scripts/apps/asset-forms.js");
      const html = renderAssetForm(audioFormContext);
      const form = document.createElement("section"); form.innerHTML = html;
      form.querySelector('[name="dialoguePageAudio"]').value = 'forged.ogg';
      const saved = readAssetForm(form, audioDraft, 'dialogue').pages[0].audio;
      await audioDialogue.close();
      const { ManualDialogueApplication } = await import("/modules/dmicher-master-screen/scripts/apps/manual-dialogue.js");
      globalThis.silentDialogue = new ManualDialogueApplication({ dialogue: audioDraft, sourceName: "Keeper", invitationId: "silent-qa" });
      await silentDialogue.render({ force: true });
      return { visible: html.includes('name="dialoguePageAudio"'), disabled: html.includes('data-dialogue-audio-controls disabled'), saved, calls: audioCalls.length };
    });
    assert.deepEqual(unlicensed, { visible: true, disabled: true, saved: "worlds/qa/welcome.ogg", calls: 3 });
    errors.push(...await page.evaluate(() => globalThis.errors)); assert.deepEqual(errors, []);
    reports.push({ version, language, checks: "localized always-visible Premium authoring and volume, disabled free fields, access changes preserve outer read-only and draft, native picker and stale/revoked callback, one autoplay per page, compact replay, silence without license, configured path preserved", errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
