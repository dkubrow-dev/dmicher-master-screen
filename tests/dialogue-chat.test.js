import test from "node:test";
import assert from "node:assert/strict";
import { DialogueChat } from "../dmicher-master-screen/scripts/dialogue-chat.js";
import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { appendDialogueMessage, dialogueObjectMessage, dialoguePlayerMessage } from "../dmicher-master-screen/scripts/dialogue-history.js";

const clone = structuredClone;
const metadata = message => message.getFlag(MODULE_ID, "dialogueChat");
function fixture(presentation = { mode: "chat", visibility: "private" }) {
  const gm = { id: "gm", role: 4, isGM: true, active: true }, player = { id: "player", role: 1, isGM: false, active: true },
    observer = { id: "observer", role: 1, isGM: false, active: true }, informer = { id: "informer", role: 1, isGM: false,
      flags: { "dmicher-generics": { managedIdentity: { version: 1, ownerId: "dmicher-generics", key: "informer" } } } };
  const documents = new Map(); let serial = 0, elected = true;
  globalThis.game = { user: gm, users: new Map([gm, player, observer, informer].map(user => [user.id, user])), messages: documents,
    modules: new Map(), scenes: new Map(), i18n: { lang: "en" }, settings: { get: () => "gmroll" } };
  globalThis.foundry ??= {}; foundry.utils = { ...(foundry.utils ?? {}), randomID: () => `id-${++serial}` };
  const flags = { groupDefinitions: { main: sampleGroupDefinition() }, groupRuntimes: {} };
  const merge = (previous, next) => {
    if (!next || typeof next !== "object" || Array.isArray(next)) return clone(next);
    const result = previous && typeof previous === "object" ? clone(previous) : {};
    for (const [key, value] of Object.entries(next)) { if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = merge(result[key], value); }
    return result;
  };
  const scene = { id: "scene", uuid: "Scene.scene", tokens: new Map(), grid: { size: 100, distance: 5 },
    getFlag(scope, key) { return scope === MODULE_ID ? clone(flags[key]) : undefined; },
    async setFlag(scope, key, value) {
      assert.equal(scope, MODULE_ID); const path = key.split("."); let parent = flags;
      for (const part of path.slice(0, -1)) parent = parent[part] ??= {};
      parent[path.at(-1)] = merge(parent[path.at(-1)], value);
    } };
  const token = (id, user, name) => ({ id, uuid: `Scene.scene.Token.${id}`, documentName: "Token", parent: scene,
    name, x: 0, y: 0, width: 1, height: 1, texture: { src: `${id}.webp` },
    actor: { id: `actor-${id}`, img: `actor-${id}.webp`, testUserPermission: candidate => candidate.id === user?.id } });
  const npc = token("npc", null, "Innkeeper"), pc = token("pc", player, "Hero"), spectator = token("spectator", observer, "Listener");
  for (const current of [npc, pc, spectator]) scene.tokens.set(current.id, current);
  game.scenes.set(scene.id, scene); globalThis.canvas = { scene };
  const dialogue = { id: "talk", name: "Greeting", presentation, pages: [
    { id: "first", text: "Hello <script>bad()</script>", responses: [{ id: "ask", label: "SECRET_CHOICE" }] },
    { id: "second", text: "The next page", responses: [{ id: "end", label: "Goodbye" }] }
  ] };
  const session = { sessionId: "conversation", groupId: "main", runId: "run", dialogueId: "talk", userId: player.id,
    actorTokenId: pc.id, actorId: pc.actor.id, target: { type: "Token", id: npc.id }, status: "active", origin: "player",
    nodeId: "first", step: 0, expiresAt: Date.now() + 60_000, presentation: clone(presentation), history: [] };
  const append = (current, entry) => appendDialogueMessage(current, { ...entry,
    visibility: current.presentation.visibility === "public" ? "public" : "private" });
  append(session, dialogueObjectMessage(session, dialogue.pages[0], dialogue, npc));
  flags.groupRuntimes.main = { ...emptyRuntime("main"), runId: "run", stateId: "calm", state: { id: "calm" }, dialogueSessions: { player: session } };
  const calls = { create: [], update: [], request: [] };
  const makeMessage = (data, options) => {
    const message = { id: `chat-${++serial}`, author: informer.id, ...clone(data), whisper: clone(options.audience.userIds), visible: true, isContentVisible: true,
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      async update(changes) {
        for (const [path, value] of Object.entries(changes)) {
          const parts = path.split("."); let parent = this;
          for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
          parent[parts.at(-1)] = clone(value);
        }
        return this;
      } };
    message.flags["dmicher-generics"] = { chat: { apiVersion: 1, ownerId: MODULE_ID, channel: "dialogue-chat", key: options.key, kind: options.kind, technical: options.technical } };
    documents.set(message.id, message); return message;
  };
  const messages = {
    find(query = {}) { return [...documents.values()].filter(message => message.getFlag("dmicher-generics", "chat")?.channel === "dialogue-chat"
      && (query.key === undefined || message.getFlag("dmicher-generics", "chat").key === query.key)); },
    get(id) { return documents.get(id); },
    async create(data, options) { if (options.enabled && !options.enabled()) return []; calls.create.push({ data: clone(data), options: { ...options } }); return [makeMessage(data, options)]; },
    async update(id, changes) { calls.update.push({ id, changes: clone(changes) }); const message = documents.get(id);
      if (!message) throw new Error("Missing message");
      await message.update({ ...(changes.content !== undefined ? { content: changes.content } : {}), ...(changes.moduleFlags ? { [`flags.${MODULE_ID}`]: changes.moduleFlags } : {}) }); return message; }
  };
  const service = { getContext: () => ({ scene, runtime: getRuntime(scene), dialogue, target: npc }) };
  const chat = new DialogueChat(service, { messages, requests: { create: async (...args) => { calls.request.push(args); return []; } }, authority: () => elected });
  const packet = () => chat.packet(scene, flags.groupRuntimes.main.dialogueSessions.player);
  const advance = () => {
    const current = flags.groupRuntimes.main.dialogueSessions.player;
    append(current, dialoguePlayerMessage(current, dialogue.pages[0].responses[0], pc, player));
    current.step = 1; current.nodeId = "second";
    append(current, dialogueObjectMessage(current, dialogue.pages[1], dialogue, npc));
  };
  const publicationCommand = (messageId, approved, user = player, whisper = [gm.id, user.id]) => ({
    id: `command-${++serial}`, author: user.id, whisper, flags: { [MODULE_ID]: { dialoguePublication: { messageId, approved } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async update(changes) { this.result = clone(changes[`flags.${MODULE_ID}.dialoguePublicationResult`]); }
  });
  return { gm, player, observer, informer, scene, flags, npc, pc, dialogue, chat, messages, calls, documents, packet, advance, publicationCommand,
    session: () => flags.groupRuntimes.main.dialogueSessions.player, setAuthority: value => { elected = value; } };
}

test("private dialogue writes only the speaker/GM card with managed-author NPC attribution", async () => {
  const f = fixture(); await f.chat.publish(f.packet());
  assert.equal(f.calls.create.length, 1); const message = f.messages.find()[0], call = f.calls.create[0];
  assert.deepEqual(message.whisper, [f.gm.id, f.player.id]); assert.equal(message.author, f.informer.id);
  assert.equal(call.options.speakerMode, "provided"); assert.equal(call.options.technical, false);
  assert.deepEqual(call.data.speaker, { scene: f.scene.id, token: f.npc.id, actor: f.npc.actor.id, alias: f.npc.name });
  assert.match(message.content, /SECRET_CHOICE/); assert.equal(metadata(message).controls, true);
  assert.doesNotMatch(message.content, /<script>/); assert.match(message.content, /&lt;script&gt;/);
  assert.equal(f.messages.find().some(entry => entry.whisper.includes(f.observer.id)), false);
});

test("chat places full-width art after safe text and before response controls, under the participant heading", async () => {
  const f = fixture(); await f.chat.publish(f.packet());
  const message = f.messages.find()[0], content = message.content;
  assert.match(content, /Dialogue between Innkeeper and Hero/);
  assert.match(content, /class="ms-dialogue-chat-image"/);
  assert.doesNotMatch(content, /class="ms-dialogue-avatar/);
  assert.ok(content.indexOf("ms-dialogue-text") < content.indexOf("ms-dialogue-chat-image"));
  assert.ok(content.indexOf("ms-dialogue-chat-image") < content.indexOf("data-dialogue-responses"));
});

test("one GM-only start notice is independent of chat publication and remains actionable only until finish", async () => {
  for (const mode of ["chat", "window"]) {
    const f = fixture({ mode, visibility: "private", windowChat: "none" });
    await Promise.all([f.chat.notifyStarted(f.packet()), f.chat.notifyStarted(f.packet())]);
    await f.chat.notifyStarted(f.packet());
    const notices = f.messages.find().filter(message => metadata(message).management);
    assert.equal(notices.length, 1);
    const notice = notices[0];
    assert.deepEqual(notice.whisper, [f.gm.id]); assert.equal(notice.author, f.informer.id);
    assert.match(notice.content, /Dialogue between Innkeeper and Hero/);
    assert.match(notice.content, /data-dialogue-gm-action="join"/);
    assert.match(notice.content, /data-dialogue-gm-action="finish"/);
    assert.doesNotMatch(notice.content, /Hello|SECRET_CHOICE|data-dialogue-chat-action/);
    f.session().status = "finished";
    await f.chat.publish(f.packet());
    assert.doesNotMatch(notice.content, /data-dialogue-gm-action="finish"/);
    assert.match(notice.content, /data-dialogue-gm-action="join"/);
    if (mode === "window") assert.equal(f.messages.find().length, 1, "GM notice does not enable transcript publication");
  }
});

test("new publisher reuses the persisted GM start notice instead of duplicating it after reload", async () => {
  const f = fixture(); await f.chat.notifyStarted(f.packet());
  const recovered = new DialogueChat({ getContext: (...args) => f.chat.service.getContext(...args) }, { messages: f.messages, requests: {}, authority: () => true });
  await recovered.notifyStarted(f.packet());
  assert.equal(f.messages.find().filter(message => metadata(message).management).length, 1);
  recovered.dispose(); f.chat.dispose();
});

test("GM notice maintenance reads no transcript or catalogue and retires completed rows", () => {
  const f = fixture(), packet = f.packet();
  f.scene.getFlag = (_scope, key) => f.flags[key];
  f.chat.context = () => assert.fail("notice maintenance must not normalize a dialogue context");
  Object.defineProperty(f.session(), "history", { get: () => assert.fail("notice maintenance must not read transcript history") });
  const join = { dataset: { dialogueGmAction: "join" } }, finish = { dataset: { dialogueGmAction: "finish" } };
  const root = { isConnected: true, querySelectorAll: () => [join, finish] };
  f.chat.managementCards.set("notice", { root, packet });
  f.chat.syncCards(); assert.equal(join.disabled, false); assert.equal(finish.disabled, false);
  f.session().status = "finished";
  f.chat.syncCards(); assert.equal(join.disabled, false); assert.equal(finish.disabled, true);
  assert.equal(f.chat.managementCards.size, 0);
});

test("public observer copies never contain choices or controls in HTML or flags", async () => {
  const f = fixture({ mode: "chat", visibility: "public" }); await f.chat.publish(f.packet());
  const records = f.messages.find(); assert.equal(records.length, 2);
  const observer = records.find(message => message.whisper.includes(f.observer.id));
  assert.deepEqual(observer.whisper, [f.observer.id]); assert.equal(metadata(observer).controls, false);
  assert.deepEqual(metadata(observer).responses, []); assert.doesNotMatch(observer.content, /SECRET_CHOICE|data-dialogue-chat-action|data-dialogue-responses/);
  assert.doesNotMatch(JSON.stringify(metadata(observer)), /SECRET_CHOICE/);
});

test("subsequent snapshots use the correct player speaker and retire only the prior response card", async () => {
  const f = fixture(); await f.chat.publish(f.packet()); const first = f.messages.find()[0];
  f.advance(); await f.chat.publish(f.packet());
  assert.equal(f.calls.create.length, 3); assert.equal(metadata(first).controls, false); assert.deepEqual(metadata(first).responses, []);
  assert.doesNotMatch(first.content, /SECRET_CHOICE|data-dialogue-chat-action/);
  const reply = f.messages.find().find(message => metadata(message).entry.role === "player");
  assert.deepEqual(reply.speaker, { scene: f.scene.id, token: f.pc.id, actor: f.pc.actor.id, alias: f.pc.name });
  assert.equal(reply.author, f.informer.id); assert.equal(metadata(reply).controls, false);
  const latest = f.messages.find().find(message => metadata(message).entry.id === f.session().history.at(-1).id);
  assert.equal(metadata(latest).controls, true); assert.match(latest.content, /Goodbye/);
  const before = { create: f.calls.create.length, update: f.calls.update.length };
  await Promise.all([f.chat.publish(f.packet()), f.chat.publish(f.packet())]);
  assert.deepEqual({ create: f.calls.create.length, update: f.calls.update.length }, before);
});

test("already delivered private history is not broadcast when visibility changes later", async () => {
  const f = fixture(); await f.chat.publish(f.packet()); const original = f.session().history[0].id;
  assert.deepEqual(metadata(f.messages.find()[0]).observerUserIds, []);
  f.session().presentation.visibility = "public"; f.advance(); await f.chat.publish(f.packet());
  assert.equal(f.messages.find().some(message => message.whisper.includes(f.observer.id) && metadata(message).entry?.id === original), false);
  f.chat.messageIds.clear(); await f.chat.publish(f.packet());
  assert.equal(f.messages.find().some(message => message.whisper.includes(f.observer.id) && metadata(message).entry?.id === original), false,
    "the persisted audience snapshot protects old history without the local cache");
  assert.equal(f.messages.find().some(message => message.whisper.includes(f.observer.id) && metadata(message).entry?.id === f.session().history.at(-1).id), true);
});

test("a failed observer delivery retries only the audience captured with the primary line", async () => {
  const f = fixture({ mode: "chat", visibility: "public", publicAudience: { range: 5 } });
  const create = f.messages.create; let first = true;
  f.messages.create = async (data, options) => {
    if (options.key.endsWith(":observers") && first) { first = false; throw new Error("observer delivery failed"); }
    return create(data, options);
  };
  await assert.rejects(f.chat.publish(f.packet()), /observer delivery failed/);
  const newcomer = { id: "newcomer", role: 1, isGM: false }; game.users.set(newcomer.id, newcomer);
  f.scene.tokens.set("newcomer-token", { id: "newcomer-token", documentName: "Token", parent: f.scene, x: 0, y: 0, width: 1, height: 1,
    actor: { testUserPermission: user => user.id === newcomer.id } });
  await f.chat.publish(f.packet());
  const observer = f.messages.find().find(message => metadata(message).entry && !metadata(message).controls);
  assert.deepEqual(observer.whisper, [f.observer.id]); assert.equal(observer.whisper.includes(newcomer.id), false);
});

for (const mode of ["none", "replies", "complete", "confirm"]) {
  test(`window dialogue respects its ${mode} chat-publication policy`, async () => {
    const f = fixture({ mode: "window", visibility: "private", windowChat: mode });
    await f.chat.publish(f.packet());
    assert.equal(f.calls.create.length, mode === "replies" ? 1 : 0);
    f.session().status = "finished"; await f.chat.publish(f.packet());
    if (mode === "none") assert.equal(f.calls.create.length, 0);
    else if (mode === "confirm") {
      const prompt = f.messages.find()[0]; assert.deepEqual(prompt.whisper, [f.player.id]);
      assert.equal(metadata(prompt).prompt, true); assert.equal(metadata(prompt).entry, null);
      assert.doesNotMatch(prompt.content, /Hello|SECRET_CHOICE/);
    } else {
      assert.equal(f.calls.create.length, 1); assert.equal(metadata(f.messages.find()[0]).controls, false);
      assert.doesNotMatch(f.messages.find()[0].content, /data-dialogue-chat-action|SECRET_CHOICE/);
    }
  });
}

test("publication acceptance authenticates the human owner and removes the decision controls", async () => {
  const f = fixture({ mode: "window", visibility: "private", windowChat: "confirm" }); f.session().status = "finished";
  await f.chat.publish(f.packet()); const prompt = f.messages.find()[0];
  const forged = f.publicationCommand(prompt.id, true, f.observer); await f.chat.processPublication(forged, f.observer.id);
  assert.match(forged.result.failure, /another player/); assert.equal(f.session().publicationApproved, undefined);
  const mismatch = f.publicationCommand(prompt.id, true); await f.chat.processPublication(mismatch, f.observer.id); assert.equal(mismatch.result, undefined);
  const unaddressed = f.publicationCommand(prompt.id, true, f.player, [f.player.id]); await f.chat.processPublication(unaddressed, f.player.id); assert.equal(unaddressed.result, undefined);
  const managed = f.publicationCommand(prompt.id, true, f.informer); await f.chat.processPublication(managed, f.informer.id); assert.equal(managed.result, undefined);
  const approved = f.publicationCommand(prompt.id, true); await f.chat.processPublication(approved, f.player.id);
  assert.deepEqual(approved.result, { approved: true }); assert.equal(f.session().publicationApproved, true);
  assert.equal(metadata(prompt).prompt, false); assert.doesNotMatch(prompt.content, /data-dmicher-chat-action/);
  assert.equal(f.messages.find().filter(message => metadata(message).entry).length, 1);
});

for (const approved of [false, true]) {
  test(`concurrent publication decisions preserve the first committed ${approved} decision`, async () => {
    const f = fixture({ mode: "window", visibility: "private", windowChat: "confirm" }); f.session().status = "finished";
    await f.chat.publish(f.packet()); const prompt = f.messages.find()[0];
    const update = f.messages.update; let release, reached; const ready = new Promise(resolve => { reached = resolve; });
    const gate = new Promise(resolve => { release = resolve; }); let firstUpdate = true;
    f.messages.update = async (...args) => {
      if (args[0] === prompt.id && firstUpdate) { firstUpdate = false; reached(); await gate; }
      return update(...args);
    };
    const first = f.chat.decidePublication(prompt.id, approved, f.player); await ready;
    const second = await f.chat.decidePublication(prompt.id, !approved, f.player);
    release(); assert.deepEqual(await first, { approved }); assert.deepEqual(second, { approved });
    assert.equal(f.session().publicationApproved, approved);
    assert.equal(f.messages.find().filter(message => metadata(message).entry).length, approved ? 1 : 0);
    assert.match(prompt.content, approved ? /published/ : /declined/);
  });
}

test("declined publication and stale/deleted sessions cannot expose the transcript", async () => {
  const f = fixture({ mode: "window", visibility: "private", windowChat: "confirm" }); f.session().status = "finished";
  await f.chat.publish(f.packet()); const prompt = f.messages.find()[0];
  const declined = f.publicationCommand(prompt.id, false); await f.chat.processPublication(declined, f.player.id);
  assert.deepEqual(declined.result, { approved: false }); await f.chat.publish(f.packet()); assert.equal(f.messages.find().length, 1);
  const packet = f.packet(); f.session().runId = "previous-run";
  assert.equal(f.chat.context(packet), null); await f.chat.publish(packet); assert.equal(f.messages.find().length, 1);
  delete f.flags.groupRuntimes.main.dialogueSessions.player;
  assert.equal(f.chat.context(packet), null); await f.chat.publish(packet); assert.equal(f.messages.find().length, 1);
});

test("a finished publication prompt cannot be accepted after its scene or owner character disappears", async () => {
  const f = fixture({ mode: "window", visibility: "private", windowChat: "confirm" }); f.session().status = "finished";
  await f.chat.publish(f.packet()); const prompt = f.messages.find()[0];
  f.scene.tokens.delete(f.pc.id);
  const missingActor = f.publicationCommand(prompt.id, true); await f.chat.processPublication(missingActor, f.player.id);
  assert.match(missingActor.result.failure, /no longer have access/); assert.equal(f.session().publicationApproved, undefined);
  game.scenes.delete(f.scene.id);
  const missingScene = f.publicationCommand(prompt.id, true); await f.chat.processPublication(missingScene, f.player.id);
  assert.equal(typeof missingScene.result.failure, "string"); assert.equal(f.messages.find().filter(message => metadata(message).entry).length, 0);
});

test("publication prompts cannot authorize a different runtime or a no-longer-finished conversation", async () => {
  for (const change of [f => { f.session().runId = "old-run"; }, f => { f.session().status = "active"; }]) {
    const f = fixture({ mode: "window", visibility: "private", windowChat: "confirm" }); f.session().status = "finished";
    await f.chat.publish(f.packet()); const prompt = f.messages.find()[0]; change(f);
    const command = f.publicationCommand(prompt.id, true); await f.chat.processPublication(command, f.player.id);
    assert.match(command.result.failure, /completed dialogue is unavailable/);
    assert.equal(f.session().publicationApproved, undefined); assert.equal(f.messages.find().filter(message => metadata(message).entry).length, 0);
  }
});

test("a non-authority or disposed publisher never sends messages", async () => {
  const f = fixture(); f.setAuthority(false); await f.chat.publish(f.packet()); assert.equal(f.calls.create.length, 0);
  f.setAuthority(true); f.chat.dispose(); await f.chat.publish(f.packet()); assert.equal(f.calls.create.length, 0);
});

function admitListener(f, user = f.observer) {
  const token = f.scene.tokens.get("spectator"), session = f.session();
  session.participants ??= [];
  session.participants.push({ userId: user.id, actorTokenId: token.id, actorId: token.actor.id, role: "listener", expiresAt: Date.now() + 60_000 });
  return { command: { ...f.packet(), kind: "listen", userId: user.id, actorTokenId: token.id, listenerTokenId: token.id },
    view: { sessionId: session.sessionId, runId: session.runId, role: "listener", listenerTokenId: token.id } };
}

test("a late listener receives past public lines with original speakers but never private or unmarked history", async () => {
  const f = fixture(); await f.chat.publish(f.packet());
  const privateId = f.session().history[0].id;
  f.session().history.push({ ...clone(f.session().history[0]), id: "legacy-unmarked", visibility: undefined });
  f.session().presentation = { mode: "chat", visibility: "public", publicAudience: { range: 5 } };
  f.scene.tokens.get("spectator").x = 1000; f.advance(); await f.chat.publish(f.packet());
  assert.equal(f.messages.find().some(message => message.whisper.includes(f.observer.id)), false);
  f.scene.tokens.get("spectator").x = 0;
  const { command, view } = admitListener(f); view.history = [{ id: "untrusted-view", visibility: "public", text: "forged" }];
  await Promise.all([f.chat.presentListener(command, view), f.chat.presentListener(command, view)]);
  await f.chat.presentListener(command, view);
  const messages = f.messages.find().filter(message => message.whisper.includes(f.observer.id));
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(message => metadata(message).entry.id), f.session().history.filter(entry => entry.visibility === "public").map(entry => entry.id));
  assert.equal(messages.some(message => [privateId, "legacy-unmarked", "untrusted-view"].includes(metadata(message).entry.id)), false);
  for (const message of messages) {
    const data = metadata(message), expected = data.entry.role === "player" ? f.pc : f.npc;
    assert.deepEqual(message.whisper, [f.observer.id]); assert.equal(message.author, f.informer.id);
    assert.deepEqual(message.speaker, { scene: f.scene.id, token: expected.id, actor: expected.actor.id, alias: expected.name });
    assert.equal(data.controls, false); assert.deepEqual(data.responses, []);
    assert.doesNotMatch(message.content, /data-dialogue-chat-action|data-dialogue-responses/);
  }
});

test("joining does not duplicate a primary or public observer card already addressed to that user", async () => {
  const f = fixture({ mode: "chat", visibility: "public" }); await f.chat.publish(f.packet());
  const before = f.calls.create.length;
  for (const user of [f.observer, f.gm]) {
    const { command, view } = admitListener(f, user); await f.chat.presentListener(command, view);
  }
  assert.equal(f.calls.create.length, before);
});

test("late listener publication revalidates its live role, current visibility and selected presentation", async () => {
  for (const invalidate of [
    f => { f.session().participants = []; },
    f => { f.session().participants[0].expiresAt = 0; },
    f => { f.session().presentation.visibility = "private"; },
    f => { f.session().presentation.mode = "window"; },
    f => { f.session().status = "finished"; },
    f => { f.session().runId = "obsolete-run"; },
    f => { f.flags.groupRuntimes.main.halted = true; },
    f => { f.scene.tokens.delete("spectator"); },
    f => { delete f.flags.groupRuntimes.main.dialogueSessions.player; }
  ]) {
    const f = fixture({ mode: "chat", visibility: "public" }), { command, view } = admitListener(f);
    invalidate(f); await f.chat.presentListener(command, view);
    assert.equal(f.calls.create.length, 0);
  }
});

test("revoking a listener between asynchronous writes stops the remaining history delivery", async () => {
  const f = fixture({ mode: "chat", visibility: "public" }); f.advance();
  const { command, view } = admitListener(f), create = f.messages.create;
  f.messages.create = async (...args) => {
    const result = await create(...args); f.session().participants = []; return result;
  };
  await f.chat.presentListener(command, view);
  assert.equal(f.calls.create.length, 1);
  assert.equal(metadata(f.messages.find()[0]).entry.id, f.session().history[0].id);
});
