import test from "node:test";
import assert from "node:assert/strict";

class ApplicationStub { async _onClose() {} }
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base } } };
const { ScreenFormApplication } = await import("../dmicher-master-screen/scripts/apps/screen-form.js");

function fixture() {
  const root = new EventTarget();
  root.ownerDocument = { defaultView: { AbortController } };
  root.querySelector = () => null;
  const button = { dataset: { screenAction: "save" }, disabled: false, isConnected: true };
  root.closest = () => button;
  const app = new ScreenFormApplication();
  app.element = root;
  return { app, root, button };
}

test("a synchronous action failure is reported and releases the button for retry", async () => {
  const { app, root, button } = fixture(), reports = [];
  const previousUI = globalThis.ui, previousError = console.error;
  globalThis.ui = { notifications: { error: (message) => reports.push(message) } };
  console.error = () => {};
  try {
    app.handleAction = () => { throw new Error("Cannot save this draft"); };
    app.bindEvents();
    root.dispatchEvent(new Event("click", { cancelable: true }));
    await new Promise(setImmediate);
    assert.deepEqual(reports, ["Cannot save this draft"]);
    assert.equal(button.disabled, false);
    let saved = false;
    app.handleAction = () => { saved = true; };
    root.dispatchEvent(new Event("click", { cancelable: true }));
    await new Promise(setImmediate);
    assert.equal(saved, true);
  } finally { console.error = previousError; globalThis.ui = previousUI; await app._onClose(); }
});

test("rebinding a form does not duplicate actions and leaves native submits untouched", async () => {
  const { app, root } = fixture();
  let calls = 0;
  app.handleAction = () => { calls++; };
  app.bindEvents(); app.bindEvents();
  root.dispatchEvent(new Event("click", { cancelable: true }));
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  root.dataset = {};
  const submit = new Event("submit", { cancelable: true });
  root.dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, false);
  assert.equal(calls, 1);
  await app._onClose();
  root.dispatchEvent(new Event("click", { cancelable: true }));
  assert.equal(calls, 1);
});
