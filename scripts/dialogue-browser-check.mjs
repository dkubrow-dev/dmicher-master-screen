import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/dialogue-review");
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
      const { ManualDialogueApplication } = await import("/modules/dmicher-master-screen/scripts/apps/manual-dialogue.js");
      const { DialogueApplication } = await import("/modules/dmicher-master-screen/scripts/apps/dialogue-window.js");
      // Synthetic Application forwards the same actions as native ApplicationV2.
      Hooks.on("renderApplicationV2", (app, element) => {
        if (!(app instanceof ManualDialogueApplication || app instanceof DialogueApplication) || element.dataset.dialogueActions) return;
        element.dataset.dialogueActions = "true";
        element.addEventListener("click", (event) => {
          const button = event.target.closest("[data-action]");
          if (button && !button.disabled) void app.constructor.DEFAULT_OPTIONS.actions[button.dataset.action]?.call(app, event, button);
        });
      });
      globalThis.confirmAnswer = false; globalThis.confirmationCount = 0;
      foundry.applications.api.DialogV2.confirm = async () => { globalThis.confirmationCount++; return globalThis.confirmAnswer; };
      game.user.character = { name: "Traveller", img: "icons/svg/mystery-man.svg" };
      const paragraph = "The old keeper tells a story of the town, its busy market and the people who lived here. ".repeat(3);
      const dialogue = { id: "qa", name: "Conversation at the gate", startPageId: "first", pages: [
        { id: "first", text: paragraph, art: "icons/svg/door-closed.svg", imageAlignment: "left", responses: [{ id: "continue", label: "Tell me more <script>literal</script>", nextPageId: "second" }] },
        { id: "second", text: paragraph, art: "icons/svg/book.svg", imageAlignment: "right", responses: [{ id: "loop", label: "Another story", nextPageId: "second" }, { id: "end", label: "Thank you" }] }
      ] };
      globalThis.dialogueQA = new ManualDialogueApplication({ dialogue, sourceName: "Keeper", invitationId: "qa", gmPreview: true });
      await dialogueQA.render({ force: true });
    });
    let window = page.locator('.ms-manual-dialogue');
    const finishLabel = language === "ru" ? "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433" : "Finish dialogue";
    const closeLabel = language === "ru" ? "\u0417\u0430\u043a\u0440\u044b\u0442\u044c" : "Close";
    assert.equal(await window.locator('[data-action="finish"]').textContent(), finishLabel);
    assert.equal(await page.evaluate(() => dialogueQA.title), `${language === "ru" ? "\u0414\u0438\u0430\u043b\u043e\u0433" : "Dialogue"}. Conversation at the gate`);
    assert.equal(await window.locator('.ms-dialogue-content > header').count(), 0);
    assert.equal(await window.locator('.ms-dialogue-content').evaluate(el => el.firstElementChild.className), "ms-dialogue-history");
    assert.equal(await window.locator('[data-dialogue-answer]').isDisabled(), true);
    assert.equal(await window.locator('.ms-dialogue-avatar').evaluate((el) => getComputedStyle(el).float), "left");
    const wrapping = await window.locator('.ms-dialogue-bubble').evaluate((bubble) => {
      const img = bubble.querySelector("img").getBoundingClientRect(), text = bubble.querySelector("p").firstChild;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 18);
      return { imageRight: img.right, textLeft: range.getBoundingClientRect().left };
    });
    assert.ok(wrapping.textLeft > wrapping.imageRight, "the first line wraps alongside the left image");
    await window.locator('input[data-response-id="continue"]').check();
    assert.equal(await page.evaluate(() => dialogueQA.history.length), 1, "choosing a radio never sends the response");
    assert.equal(await window.locator('[data-dialogue-answer]').isEnabled(), true);
    await page.screenshot({ path: path.join(output, `${version}-${language}-radio.png`) });
    await window.locator('[data-dialogue-answer]').click();
    await page.waitForFunction(() => dialogueQA.history.length === 3);
    await page.waitForFunction(() => [...dialogueQA.element.querySelectorAll(".ms-dialogue-avatar")].every((image) => image.complete && image.naturalWidth > 0));
    assert.deepEqual(await window.locator('.ms-dialogue-message').evaluateAll((items) => items.map((item) => item.dataset.imageAlignment)), ["left", "right", "right"]);
    assert.equal(await window.locator('.is-player .ms-dialogue-text').textContent(), "Tell me more <script>literal</script>");
    assert.equal(await window.locator('script').count(), 0);
    assert.equal(await window.locator('.ms-dialogue-responses').count(), 1);
    assert.equal(await window.locator('.ms-dialogue-history > .ms-dialogue-responses').count(), 1);
    assert.equal(await window.locator('input[type="radio"]').count(), 0, "all short responses use direct buttons");
    await page.evaluate(async () => { await dialogueQA.close(); });
    assert.equal(await window.count(), 1); assert.equal(await page.evaluate(() => confirmationCount), 1);
    await page.screenshot({ path: path.join(output, `${version}-${language}-conversation.png`) });
    for (let i = 0; i < 4; i++) await window.locator('[data-response-id="loop"]').click();
    await page.waitForFunction(() => dialogueQA.history.length === 11);
    const scrolling = await window.locator('.ms-dialogue-history').evaluate((el) => ({ height: el.clientHeight, total: el.scrollHeight, top: el.scrollTop }));
    assert.ok(scrolling.total > scrolling.height * 2); assert.ok(scrolling.top > 0);
    await page.evaluate(async () => {
      dialogueQA.element.querySelector('.ms-dialogue-history').scrollTop = 30;
      dialogueQA.constructor.answer.call(dialogueQA, null, { dataset: { responseId: "loop", pageId: "second" } });
      await dialogueQA.renderPromise;
    });
    assert.equal(await window.locator('.ms-dialogue-history').evaluate((el) => el.scrollTop), 30);
    await window.locator('[data-action="finish"]').click();
    await window.locator('[data-action="leave"]').waitFor();
    assert.equal(await window.locator('[data-action="leave"]').textContent(), closeLabel);
    assert.equal(await window.locator('.ms-dialogue-message').count(), 13);
    assert.equal(await window.locator('[data-action="answer"]').count(), 0);
    await window.locator('[data-action="leave"]').click();
    await window.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => confirmationCount), 1, "completed conversation closes without confirmation");
    // Listener rendering uses the same history but has no speaker controls.
    await page.evaluate(async () => {
      const { DialogueApplication } = await import("/modules/dmicher-master-screen/scripts/apps/dialogue-window.js");
      const view = { sessionId: "listen", role: "listener", status: "active", targetName: "Keeper", title: "Listening",
        history: dialogueQA.history, responses: [{ id: "forged-answer", label: "Must not appear" }] };
      globalThis.listenerLeft = 0;
      const service = { getContext: () => ({ runtime: { runId: "run" } }), refreshSession: () => structuredClone(view),
        renewSession: async () => {}, leaveSession: async () => { globalThis.listenerLeft++; } };
      globalThis.listenerQA = new DialogueApplication(service, { sceneId: scene.id, groupId: "main", runId: "run", dialogueId: "qa", target: { type: "Token", id: "guard" },
        actorTokenId: "speaker", listenerTokenId: "listener", initialView: view });
      await listenerQA.render({ force: true });
    });
    window = page.locator('.ms-dialogue');
    assert.equal(await window.locator('.ms-dialogue-message').count(), 13);
    assert.equal(await window.locator('[data-action="answer"], [data-action="finish"]').count(), 0);
    await page.screenshot({ path: path.join(output, `${version}-${language}-listener.png`) });
    await window.locator('[data-action="leave"]').click(); await window.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => listenerLeft), 1);
    assert.equal(await page.evaluate(() => confirmationCount), 1);
    await page.evaluate(async () => {
      const { InteractionPreviewApplication } = await import("/modules/dmicher-master-screen/scripts/apps/interaction-preview.js");
      globalThis.previewOriginalFlags = JSON.stringify(scene.flags);
      globalThis.previewQA = new InteractionPreviewApplication(controller, { kind: "dialogue", assetId: "qa", draft: dialogueQA.dialogue });
      previewQA.conditions = { groupId: "main", stateId: "calm", target: "Token:guard", actorTokenId: "guard", tags: "", distance: 0,
        visible: true, enabled: true, used: 0, halted: false, showBlocked: true };
      await previewQA.render({ force: true });
    });
    window = page.locator('.ms-interaction-preview');
    await window.locator('input[data-response-id="continue"]').check();
    assert.equal(await page.evaluate(() => previewQA.dialogueHistory.length), 1);
    await window.locator('[data-screen-action="previewAnswer"]').click();
    await page.waitForFunction(() => previewQA.dialogueHistory.length === 3);
    assert.equal(await window.locator('.ms-dialogue-message').count(), 3);
    assert.deepEqual(await window.locator('.ms-dialogue-message').evaluateAll((items) => items.map((item) => item.dataset.imageAlignment)), ["left", "right", "right"]);
    await window.locator('[data-screen-action="previewFinish"]').click();
    await window.locator('[data-screen-action="previewClose"]').waitFor();
    assert.equal(await window.locator('.ms-dialogue-message').count(), 3);
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags) === previewOriginalFlags), true);
    await page.screenshot({ path: path.join(output, `${version}-${language}-preview.png`) });
    await window.locator('[data-screen-action="previewClose"]').click(); await window.waitFor({ state: "detached" });
    errors.push(...await page.evaluate(() => globalThis.errors)); assert.deepEqual(errors, []);
    reports.push({ version, language, checks: "one window, history, image alignment and wrapping, escaped answers, latest response choices, scroll preservation, finish and close, confirmation cancellation, read-only listener, local preview with simulated conditions and no world writes", errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
