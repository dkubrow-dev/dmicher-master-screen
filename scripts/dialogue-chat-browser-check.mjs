import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/dialogue-chat-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const language of ["ru", "en"]) for (const version of ["13.351", "14.366"]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 920 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      await controller.editor.close();
      const { DialogueChat } = await import("/modules/dmicher-master-screen/scripts/dialogue-chat.js");
      const { renderDialogueMessages, renderDialogueResponses } = await import("/modules/dmicher-master-screen/scripts/dialogue-response-presentation.js");
      const MODULE = "dmicher-master-screen", GENERICS = "dmicher-generics";
      const speaker = { id: "speaker", name: "Traveller", role: 1, isGM: false, active: true };
      const observer = { id: "observer", name: "Listener", role: 1, isGM: false, active: true };
      const informer = { id: "informer", name: "Informer", role: 1, isGM: false, active: false,
        flags: { [GENERICS]: { managedIdentity: { version: 1, ownerId: GENERICS, key: "informer" } } } };
      for (const user of [speaker, observer, informer]) game.users.set(user.id, user);
      game.user = speaker;
      const runtime = scene.flags[MODULE].groupRuntimes.main;
      runtime.runId = "chat-run"; runtime.groupId = "main"; runtime.halted = false; runtime.dialogueSessions = {};
      const contexts = new Map();
      const calls = []; globalThis.chatCalls = calls;
      const service = { getContext: (_scene, _dialogue, _group, _target, options) => contexts.get(options.sessionId),
        requestAnswer: async command => { calls.push({ kind: "answer", ...command }); },
        requestFinish: async command => { calls.push({ kind: "finish", ...command }); runtime.dialogueSessions[command.sessionId].status = "finished"; },
        renewSession: async () => {} };
      globalThis.chatQA = new DialogueChat(service, { messages: {}, requests: {}, authority: () => false });
      chatQA.context = packet => contexts.get(packet.sessionId);
      const panel = document.createElement("section"); panel.id = "chat-qa"; panel.className = "application dmicher-window dmicher-master-screen"; panel.dataset.dmicherTheme = "dark";
      Object.assign(panel.style, { position: "fixed", top: "40px", left: "90px", width: "340px", maxHeight: "830px", overflow: "auto", padding: "16px", background: "#20252d" });
      document.body.append(panel);
      globalThis.chatCards = new Map();
      globalThis.addChatCard = (id, { long = false, controls = true, activeUser = "speaker", messageUser = "speaker", stale = false } = {}) => {
        game.user = game.users.get(activeUser);
        const entry = { id: `${id}-npc`, role: "object", name: "Keeper", text: `Welcome, traveller. ${id}`, img: "icons/svg/book.svg", imageAlignment: "left" };
        const session = { sessionId: id, userId: messageUser, groupId: "main", runId: runtime.runId, target: { type: "Token", id: "guard" },
          actorTokenId: "hero", dialogueId: "dialogue", status: "active", step: stale ? 1 : 0, nodeId: "page", expiresAt: Date.now() + 120000,
          history: [entry], presentation: { mode: "chat" } };
        runtime.dialogueSessions[id] = session;
        contexts.set(id, { scene, runtime, session });
        const packet = { version: 1, sceneId: scene.id, groupId: "main", sessionId: id, runId: runtime.runId,
          userId: messageUser, target: session.target, actorTokenId: "hero", nodeId: "page", step: 0, controls, status: "active", entry };
        const responses = [{ id: "yes", label: "Yes" }, { id: "more", label: long ? "Please tell me more <script>literal</script>" : "Tell me more" }];
        const message = { id, author: informer, visible: true, isContentVisible: true, whisper: [activeUser], _stats: { modifiedTime: 1 },
          flags: { [MODULE]: { dialogueChat: packet }, [GENERICS]: { chat: { apiVersion: 1, ownerId: MODULE, channel: "dialogue-chat" } } },
          getFlag(scope, key) { return this.flags[scope]?.[key]; } };
        game.messages.set(id, message);
        const root = document.createElement("article"); root.id = `card-${id}`; root.className = "dmicher-master-screen ms-dialogue-chat";
        root.innerHTML = `${renderDialogueMessages([entry])}${controls ? renderDialogueResponses(responses, {
          actionAttribute: "data-dialogue-chat-action", groupName: id, canFinish: true
        }) : ""}`;
        panel.append(root); chatQA.render(message, root);
        chatCards.set(id, { root, message, packet, session }); return id;
      };
      addChatCard("radio-a", { long: true }); addChatCard("radio-b", { long: true });
    });
    const radioA = page.locator("#card-radio-a"), radioB = page.locator("#card-radio-b");
    assert.equal(await radioA.locator('input[type="radio"]').count(), 2);
    assert.equal(await radioA.evaluate(root => root.scrollWidth <= root.clientWidth + 1), true, "long replies fit a narrow chat column");
    assert.equal(await radioA.locator('script').count(), 0);
    assert.equal(await radioA.locator('[data-dialogue-answer]').isDisabled(), true);
    await radioA.locator('input[value="more"]').check();
    assert.equal(await radioA.locator('[data-dialogue-answer]').isEnabled(), true);
    assert.equal(await radioB.locator('[data-dialogue-answer]').isDisabled(), true);
    assert.equal(await page.evaluate(() => chatCalls.length), 0);
    await radioA.locator('[data-dialogue-answer]').click();
    await page.waitForFunction(() => chatCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => [chatCalls[0].kind, chatCalls[0].sessionId, chatCalls[0].responseId]), ["answer", "radio-a", "more"]);
    await radioB.locator('input[value="yes"]').check();
    assert.equal(await radioA.locator('input[value="more"]').isChecked(), true);
    await radioB.locator('[data-dialogue-answer]').click();
    await page.waitForFunction(() => chatCalls.length === 2);
    assert.equal(await page.evaluate(() => chatCalls[1].responseId), "yes");
    await page.screenshot({ path: path.join(output, `${version}-${language}-radio.png`) });

    // Actual Generics bindings re-read user and visible message at click time.
    await page.evaluate(() => { game.user = game.users.get("observer"); });
    await radioA.locator('[data-dialogue-chat-action="finish"]').click();
    assert.equal(await page.evaluate(() => chatCalls.length), 2);
    await page.evaluate(() => { game.user = game.users.get("speaker"); chatCards.get("radio-a").message.isContentVisible = false; });
    await radioA.locator('[data-dialogue-answer]').click();
    assert.equal(await page.evaluate(() => chatCalls.length), 2);
    await page.evaluate(() => { chatCards.get("radio-a").message.isContentVisible = true; chatCards.get("radio-a").session.step++; });
    await radioA.locator('[data-dialogue-answer]').click();
    await page.waitForFunction(() => errors.length === 1);
    const staleError = await page.evaluate(() => errors.pop());
    assert.ok(staleError.includes(language === "ru" ? "\u0431\u043b\u043e\u043a" : "block"));
    assert.equal(await page.evaluate(() => chatCalls.length), 2);
    await page.evaluate(() => chatQA.syncCards(scene));
    assert.equal(await radioA.locator('[data-dialogue-responses]').count(), 0);
    await page.evaluate(() => { addChatCard("stale-render", { stale: true }); addChatCard("observer", { long: true, activeUser: "observer" }); });
    assert.equal(await page.locator('#card-stale-render [data-dialogue-responses]').count(), 0);
    assert.equal(await page.locator('#card-observer [data-dialogue-responses]').count(), 0);
    assert.equal(await page.locator('#card-observer .ms-dialogue-speaker').textContent(), "Keeper");
    await page.evaluate(() => { addChatCard("short"); });
    const short = page.locator("#card-short");
    assert.equal(await short.locator('input[type="radio"]').count(), 0);
    await short.locator('button[data-response-id="yes"]').click();
    await page.waitForFunction(() => chatCalls.length === 3);
    assert.equal(await page.evaluate(() => chatCalls.at(-1).responseId), "yes");
    await short.locator('[data-dialogue-chat-action="finish"]').click();
    await page.waitForFunction(() => chatCalls.length === 4);
    assert.equal(await page.evaluate(() => chatCalls.at(-1).kind), "finish");
    await page.evaluate(() => chatQA.syncCards(scene));
    assert.equal(await short.locator('[data-dialogue-responses]').count(), 0);
    assert.equal(await short.locator('.ms-dialogue-message').count(), 1, "finishing retains the transcript card");
    await page.evaluate(() => chatQA.dispose());
    errors.push(...await page.evaluate(() => globalThis.errors)); assert.deepEqual(errors, []);
    reports.push({ version, language, checks: "real Generics bindActions, private radio and short buttons, independent card selections, observer controls removed, fresh user/content authorization, stale block rejection and UI cleanup, finish preserves transcript", errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
