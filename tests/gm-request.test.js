import test from "node:test";
import assert from "node:assert/strict";
import { requestGMReply } from "../dmicher-master-screen/scripts/gm-request.js";

function fixture() {
  let serial = 0;
  const hooks = new Map(), messages = new Map(), sent = [];
  globalThis.Hooks = { on: (_name, callback) => { const id = ++serial; hooks.set(id, callback); return id; },
    off: (_name, id) => hooks.delete(id) };
  globalThis.game = { user: { id: "player" }, messages, users: new Map([
    ["gm", { id: "gm", active: true, role: 4 }], ["assistant", { id: "assistant", active: true, role: 3 }],
    ["offline", { id: "offline", active: false, role: 4 }]
  ]) };
  const make = (id, result) => ({ id, getFlag: (_module, flag) => flag === "reply" ? result : undefined });
  const update = (id, result) => { const message = make(id, result); messages.set(id, message); for (const callback of hooks.values()) callback(message); };
  const chat = { create: async (data, options) => { const message = make(`message-${sent.length + 1}`); messages.set(message.id, message); sent.push({ data, options }); return [message]; } };
  const request = (overrides = {}, service = chat) => requestGMReply(service, { command: { action: "open" }, commandFlag: "command", responseFlag: "reply",
    content: "Request", kind: "test", timeoutMessage: "timeout", timeoutMs: 1000, ...overrides });
  return { hooks, messages, sent, make, update, chat, request };
}

test("parallel interactions correlate their own reply and release their subscriptions", async () => {
  const f = fixture(), first = f.request(), second = f.request();
  await new Promise(setImmediate);
  assert.equal(f.hooks.size, 2);
  assert.deepEqual(f.sent[0].options.audience.userIds, ["gm", "player"]);
  f.update("unrelated", { ok: false }); assert.equal(f.hooks.size, 2);
  f.update("message-2", { ok: true, session: "second" });
  assert.deepEqual(await second, { ok: true, session: "second" }); assert.equal(f.hooks.size, 1);
  f.update("message-1", { ok: true, session: "first" });
  assert.deepEqual(await first, { ok: true, session: "first" }); assert.equal(f.hooks.size, 0);
});

test("reply arriving before chat creation resolves is recovered from the stored message", async () => {
  const f = fixture();
  const reply = await f.request({}, { create: async () => { f.update("early", { ready: true }); return [f.make("early")]; } });
  assert.deepEqual(reply, { ready: true }); assert.equal(f.hooks.size, 0);
});

test("failed delivery and timeout release hooks without resending the command", async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(f.request({}, { create: () => { calls++; throw new Error("delivery"); } }), /delivery/);
  assert.equal(calls, 1); assert.equal(f.hooks.size, 0);
  await assert.rejects(f.request({ timeoutMs: 5 }), /timeout/);
  assert.equal(f.sent.length, 1); assert.equal(f.hooks.size, 0);
});

test("missing GM prevents publishing a request", async () => {
  const f = fixture(); game.users.delete("gm");
  await assert.rejects(f.request()); assert.equal(f.sent.length, 0); assert.equal(f.hooks.size, 0);
});
