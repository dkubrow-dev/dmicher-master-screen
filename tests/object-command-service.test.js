import test from "node:test";
import assert from "node:assert/strict";
import { ObjectCommandService } from "../dmicher-master-screen/scripts/object-command-service.js";
import { CommandRejection } from "../dmicher-master-screen/scripts/object-command-access.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { builtinSignals, SCENE_COLLECTIONS } from "../dmicher-master-screen/scripts/builtin-signals.js";
import { normalizeSignalFields, validateSignalValues } from "../dmicher-master-screen/scripts/signal-types.js";

function fixture({ accept = async () => ({ runId: "execution" }) } = {}) {
  const gm = { id: "gm", isGM: true, role: 4, active: true }, player = { id: "player", isGM: false, role: 1, active: true };
  const scene = { id: "scene", tokens: new Map() };
  const npc = { id: "npc", documentName: "Token", uuid: "Scene.scene.Token.npc" }, pc = { id: "pc", documentName: "Token", uuid: "Scene.scene.Token.pc" };
  scene.tokens.set(npc.id, npc); scene.tokens.set(pc.id, pc);
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]), scenes: new Map([[scene.id, scene]]), modules: new Map(), messages: new Map(), settings: { get: () => false } };
  let sequence = 0, authority = true;
  globalThis.foundry = { utils: { randomID: () => `request-${++sequence}` } };
  const notices = [], calls = [], warnings = [], originalConsole = globalThis.console;
  globalThis.ui = { notifications: { warn: message => notices.push(message) } };
  globalThis.console = { ...originalConsole, warn: (...args) => warnings.push(args) };
  const service = new ObjectCommandService({ executor: { accept: async (...args) => { calls.push(args); return accept(...args); } },
    chat: {}, authority: () => authority && game.user.isGM });
  const packet = { version: 1, requestId: "same", sceneId: scene.id, actorTokenUuid: pc.uuid, targetUuid: npc.uuid, commandId: "come", parameters: {} };
  const message = (input = packet, options = {}) => {
    const flags = { [MODULE_ID]: { objectCommandRequest: structuredClone(input) }, "dmicher-generics": { chat: {
      apiVersion: 1, ownerId: MODULE_ID, channel: "object-command", kind: "object-command", technical: true
    } } };
    const document = { id: `message-${++sequence}`, author: player.id, whisper: [gm.id, player.id], flags,
      getFlag: (scope, key) => flags[scope]?.[key], async update(changes) {
        for (const [key, value] of Object.entries(changes)) {
          if (key.startsWith(`flags.${MODULE_ID}.`)) flags[MODULE_ID][key.slice(`flags.${MODULE_ID}.`.length)] = structuredClone(value);
          else document[key] = value;
        }
      }, ...options };
    return document;
  };
  return { gm, player, scene, npc, pc, service, packet, message, notices, calls, warnings,
    setAuthority: value => { authority = value; }, restore: () => { globalThis.console = originalConsole; service.dispose(); } };
}

test("authenticated private command passes only player intent to the elected GM and stores a minimal receipt", async () => {
  const f = fixture();
  try {
    const message = f.message();
    assert.equal(await f.service.processMessage(message, f.player.id), true);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], f.scene); assert.equal(f.calls[0][2], f.player);
    assert.deepEqual(f.calls[0][1], f.packet);
    assert.deepEqual(message.getFlag(MODULE_ID, "objectCommandResult"), { ok: true, commandId: "come", runId: "execution" });
    assert.equal(message.content, "");
    await f.service.processMessage(message, f.player.id); assert.equal(f.calls.length, 1);
  } finally { f.restore(); }
});

test("untrusted authors, public messages, wrong provenance and another authority cannot execute commands", async () => {
  const f = fixture();
  try {
    for (const options of [{ author: "missing" }, { whisper: [] }, { whisper: [f.gm.id] }, { whisper: [f.player.id] }]) {
      assert.equal(await f.service.processMessage(f.message(f.packet, options), f.player.id), false);
    }
    const forged = f.message(); forged.flags["dmicher-generics"].chat.channel = "scene-input";
    assert.equal(await f.service.processMessage(forged, f.player.id), false);
    assert.equal(await f.service.processMessage(f.message(), f.gm.id), false);
    f.setAuthority(false); assert.equal(await f.service.processMessage(f.message(), f.player.id), false);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test("repeated in-flight delivery executes once and changed input cannot reuse an identity", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ accept: async () => { await pending; return { runId: "once" }; } });
  try {
    const first = f.service.execute(f.packet, f.player), duplicate = f.service.execute(structuredClone(f.packet), f.player);
    await Promise.resolve(); assert.equal(f.calls.length, 1);
    const rejected = await f.service.execute({ ...f.packet, commandId: "away" }, f.player);
    assert.equal(rejected.ok, false); assert.equal(f.calls.length, 1);
    release(); assert.deepEqual(await first, await duplicate);
  } finally { release(); f.restore(); }
});

test("validation rejections warn the GM with safe text and keep technical details outside the toast", async () => {
  const f = fixture({ accept: () => { throw new CommandRejection("range", "Your character is too far away to give this command."); } });
  try {
    const message = f.message(); await f.service.processMessage(message, f.player.id);
    const result = message.getFlag(MODULE_ID, "objectCommandResult");
    assert.equal(result.ok, false); assert.deepEqual(f.notices, [result.message]);
    assert.equal(result.message.includes(f.packet.targetUuid), false);
    assert.equal(f.warnings.length, 1); assert.equal(f.warnings[0][1].targetUuid, f.packet.targetUuid);
    assert.equal(Object.hasOwn(result, "code"), false);
  } finally { f.restore(); }
});

test("client configuration injection is rejected before acceptance and no exception details reach players", async () => {
  const f = fixture();
  try {
    const injected = f.message({ ...f.packet, config: { enabled: true } });
    await f.service.processMessage(injected, f.player.id);
    assert.equal(f.calls.length, 0); assert.equal(injected.getFlag(MODULE_ID, "objectCommandResult").ok, false);
    assert.ok(f.notices.every(message => !message.includes("envelope")));
  } finally { f.restore(); }
});

test("local GM requests resolve document UUIDs and coalesce a double click without leaking command configuration", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ accept: async () => { await pending; return { runId: "local", config: { secret: true } }; } });
  try {
    const input = { scene: f.scene, target: { type: "Token", id: "npc" }, actorTokenId: "pc", commandId: "come" };
    const first = f.service.request(input), second = f.service.request(input);
    assert.equal(first, second); await new Promise(setImmediate); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1].actorTokenUuid, f.pc.uuid); assert.equal(f.calls[0][1].targetUuid, f.npc.uuid);
    release(); assert.deepEqual(await first, { ok: true, commandId: "come", runId: "local" });
  } finally { release(); f.restore(); }
});

test("command receipts remain bounded and disposed services cannot accept new work", async () => {
  const f = fixture();
  try {
    for (let index = 0; index < 210; index++) await f.service.execute({ ...f.packet, requestId: `receipt-${index}` }, f.player);
    assert.equal(f.service.receipts.size, 200); assert.equal(f.calls.length, 210);
    f.service.dispose(); assert.equal(await f.service.execute(f.packet, f.player), null); assert.equal(f.calls.length, 210);
  } finally { f.restore(); }
});

test("player request uses private Generics delivery and shows the GM's human warning without executing locally", async () => {
  const f = fixture(), hooks = new Map(), sent = [];
  try {
    game.user = f.player;
    globalThis.Hooks = { on: (_name, callback) => { hooks.set(1, callback); return 1; }, off: (_name, id) => hooks.delete(id) };
    f.service.chat = { create: async (data, options) => {
      sent.push({ data, options });
      const response = { ok: false, message: "The object is already carrying out a command." };
      const document = { id: "reply", getFlag: (_scope, key) => key === "objectCommandResult" ? response : undefined };
      game.messages.set(document.id, document); return [document];
    } };
    const result = await f.service.request({ scene: f.scene, target: { type: "Token", id: "npc" }, actorTokenId: "pc", commandId: "come" });
    assert.equal(result.ok, false); assert.deepEqual(f.notices, [result.message]); assert.equal(f.calls.length, 0);
    assert.equal(sent[0].data.author, f.player.id); assert.deepEqual(sent[0].options.audience.userIds, [f.gm.id, f.player.id]);
    assert.equal(sent[0].options.technical, true); assert.equal(sent[0].options.kind, "object-command");
    assert.equal(hooks.size, 0); assert.equal(f.warnings.length, 1);
  } finally { f.restore(); }
});

test("all native object types expose typed localized command lifecycle signals with validation only before acceptance", () => {
  for (const type of Object.keys(SCENE_COLLECTIONS)) {
    const signals = builtinSignals({ type, key: `${type}:test` });
    assert.deepEqual(signals.map(signal => signal.name), ["commandRequested", "commandStarted", "commandCompleted", "commandCancelled"]);
    for (const signal of signals) {
      assert.ok(signal.builtin && signal.label.ru && signal.label.en && signal.description.ru && signal.description.en);
      const fields = normalizeSignalFields(signal.parameters);
      const values = { playerTokenUuid: "Scene.test.Token.pc", objectUuid: `Scene.test.${type}.npc`, commandId: "go", parameters: '{"point":{"x":1,"y":2}}' };
      assert.deepEqual(validateSignalValues(fields, values), values);
      assert.ok(fields.every(field => field.builtin && field.description.ru && field.description.en));
      assert.deepEqual(signal.returns.map(field => field.name), signal.name === "commandRequested" ? ["allowed", "message"] : []);
    }
  }
});
