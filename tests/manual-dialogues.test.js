import test from "node:test";
import assert from "node:assert/strict";
import { createManualDialogueService, manualDialogueData } from "../dmicher-master-screen/scripts/manual-dialogues.js";

const MODULE_ID = "dmicher-master-screen";
function fixture() {
  let serial = 0;
  const gm = { id: "gm", role: 4, isGM: true };
  const player = { id: "player", role: 1, isGM: false };
  const other = { id: "other", role: 1, isGM: false };
  const dialogue = { id: "talk", name: "Manual discussion", enabled: false, range: 1, target: { type: "Token", id: "npc" },
    conditions: { enabled: false, allowTags: ["never"] }, startPageId: "start", pages: [
      { id: "start", text: "Opening", art: "", responses: [{ id: "next", label: "Continue", nextPageId: "last" }] },
      { id: "last", text: "Conclusion", art: "", responses: [{ id: "finish", label: "Accept", signalId: "alarm.start" }] }
    ] };
  const catalog = { schemaVersion: 1, revision: 0, shops: [], dialogues: [{ id: dialogue.id, name: dialogue.name, startPageId: dialogue.startPageId,
    pages: dialogue.pages.map((node) => ({ ...node, art: "npc.webp", responses: node.responses.map((response) => ({ ...response, nextPageId: response.nextPageId })) })) }] };
  const runtime = { halted: true, runId: "", conditionCounts: { "main:stopped:dialogue:talk": 50 }, dialogueSessions: {} };
  const scene = { id: "scene", getFlag: (_scope, key) => key === "interactionCatalog" ? catalog : undefined, tokens: new Map([["npc", { id: "npc", name: "Merchant", hidden: true, texture: { src: "npc.webp" } }]]), tiles: new Map() };
  const sent = [], opened = [];
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player], [other.id, other]]), scenes: new Map([[scene.id, scene]]) };
  globalThis.foundry ??= {}; foundry.utils = { ...(foundry.utils ?? {}), randomID: () => `id-${++serial}` };
  const service = createManualDialogueService({
    openWindow: async (data) => { opened.push(structuredClone(data)); return data; },
    messageService: { create: async (data, options) => {
      sent.push({ data, options }); return [{ id: `message-${++serial}` }];
    } } });
  const selection = { sceneId: "scene", stateId: "stopped", dialogueId: "talk" };
  const invitation = (overrides = {}) => ({ id: "message", author: gm, whisper: [player.id],
    getFlag: (_module, key) => key === "manualDialogue" ? { version: 1, manual: true, dialogue: { id: dialogue.id, name: dialogue.name, startNodeId: dialogue.startPageId, nodes: dialogue.pages.map(page => ({ ...page, responses: page.responses.map(response => ({ ...response, nextNodeId: response.nextPageId })) })) }, sourceName: "Merchant" } : undefined,
    ...overrides });
  return { gm, player, other, dialogue, runtime, sent, opened, service, selection, invitation };
}

test("GM manual reading ignores automation state without changing halted state, sessions or counters", async () => {
  const f = fixture(), before = structuredClone(f.runtime);
  const view = await f.service.openManualDialogue(f.selection);
  assert.equal(view.gmPreview, true);
  assert.equal(view.dialogue.pages[1].responses[0].signalId, "alarm.start");
  assert.equal(view.dialogue.pages[0].art, "npc.webp");
  assert.equal(f.sent.length, 0);
  assert.deepEqual(f.runtime, before);
});

test("manual invitation requires an explicit audience and strips event payloads from player presentation", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.invitePlayers({ ...f.selection, userIds: [] }), []);
  assert.equal(f.sent.length, 0);
  const ids = await f.service.invitePlayers({ ...f.selection, userIds: [f.player.id, f.player.id, "missing"] });
  assert.equal(ids.length, 1);
  assert.deepEqual(f.sent[0].options.audience, { type: "users", userIds: [f.player.id] });
  const data = f.sent[0].data.flags[MODULE_ID].manualDialogue;
  assert.equal(data.manual, true);
  assert.equal(data.dialogue.conditions, undefined);
  assert.equal(data.dialogue.target, undefined);
  assert.equal(data.dialogue.nodes[1].responses[0].signalId, "");
});

test("a selected recipient opens a live authenticated GM invitation only once", async () => {
  const f = fixture(); game.user = f.player;
  assert.equal(await f.service.processManualInvitation(f.invitation(), f.gm.id), true);
  assert.equal(await f.service.processManualInvitation(f.invitation(), f.gm.id), true);
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].gmPreview, false);
  assert.equal(f.opened[0].dialogue.pages[1].responses[0].signalId, "");
});

test("unselected users, forged GM author, player invitations and concealed content never open windows", async () => {
  const f = fixture(); game.user = f.other;
  assert.equal(await f.service.processManualInvitation(f.invitation(), f.gm.id), false);
  game.user = f.player;
  assert.equal(await f.service.processManualInvitation(f.invitation(), f.other.id), false);
  assert.equal(await f.service.processManualInvitation(f.invitation({ author: f.player }), f.player.id), false);
  assert.equal(await f.service.processManualInvitation(f.invitation({ isContentVisible: false }), f.gm.id), false);
  assert.equal(f.opened.length, 0);
  await assert.rejects(f.service.invitePlayers({ ...f.selection, userIds: [f.other.id] }));
});

test("manual projection preserves literal text but excludes arbitrary action and script data", () => {
  const f = fixture();
  f.dialogue.pages[0].text = "<script>not executed</script>";
  f.dialogue.pages[0].script = "game.pause()";
  f.dialogue.actions = [{ macroUuid: "Macro.secret" }];
  const view = manualDialogueData(f.dialogue);
  assert.equal(view.pages[0].text, "<script>not executed</script>");
  assert.equal(view.pages[0].script, undefined);
  assert.equal(view.actions, undefined);
});

test("manual window responses navigate locally and never invoke the event bus or automated dialogue service", async () => {
  const f = fixture();
  foundry.applications = { api: { ApplicationV2: class {
    constructor(options) { this.options = options; }
    async _prepareContext() { return {}; }
    render() { this.renders = (this.renders ?? 0) + 1; }
    close() { this.closed = true; }
  }, HandlebarsApplicationMixin: (base) => base } };
  const { ManualDialogueApplication } = await import("../dmicher-master-screen/scripts/apps/manual-dialogue.js");
  globalThis.Hooks = { callAll: () => { throw new Error("must not emit"); } };
  const app = new ManualDialogueApplication({ dialogue: manualDialogueData(f.dialogue, { includeSignalIds: true }), sourceName: "NPC", invitationId: "one", gmPreview: true });
  ManualDialogueApplication.answer.call(app, null, { dataset: { responseId: "next", pageId: "start" } });
  assert.equal(app.pageId, "last");
  ManualDialogueApplication.answer.call(app, null, { dataset: { responseId: "finish", pageId: "start" } });
  assert.equal(app.finished, false);
  ManualDialogueApplication.answer.call(app, null, { dataset: { responseId: "finish", pageId: "last" } });
  assert.equal(app.finished, true);
  assert.equal((await app._prepareContext({})).signalId, "alarm.start");
  ManualDialogueApplication.leave.call(app);
  assert.equal(app.closed, true);
  assert.equal(f.runtime.halted, true);
});
