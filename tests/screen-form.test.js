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

test("external refreshes coalesce and refresh again only after an update during rendering", async () => {
  const { app } = fixture(); app.rendered = true;
  const releases = []; let renders = 0;
  // ApplicationV2.rendered is false while native template rendering is pending.
  app.render = () => { renders++; app.rendered = false; return new Promise((resolve) => releases.push(() => { app.rendered = true; resolve(); })); };
  const task = app.refresh();
  assert.equal(app.refresh(), task);
  await Promise.resolve(); assert.equal(renders, 1);
  assert.equal(app.refresh(), task);
  app.refresh(); releases.shift()();
  await new Promise(setImmediate); assert.equal(renders, 2);
  releases.shift()(); await task;
  assert.equal(app.refreshTask, null);
});

test("a refresh requested during rendering does not reopen a form which has closed", async () => {
  const { app } = fixture(); app.rendered = true;
  let release, renders = 0;
  app.render = () => { renders++; app.rendered = false; return new Promise(resolve => { release = resolve; }); };
  const task = app.refresh(); await Promise.resolve(); assert.equal(app.refresh(), task);
  release(); await task;
  assert.equal(renders, 1); assert.equal(app.refreshTask, null); assert.equal(app.rendered, false);
});

test("an update in the gap after rendering and before queue cleanup is not lost", async () => {
  const { app } = fixture(); app.rendered = true;
  let rendering = false, renders = 0, lateRequest;
  Object.defineProperty(app, "refreshing", { get: () => rendering, set: value => {
    rendering = value;
    if (!value && renders === 1) queueMicrotask(() => { lateRequest = app.refresh(); });
  } });
  app.render = async () => { renders++; };
  await app.refresh(); await lateRequest;
  assert.equal(renders, 2); assert.equal(app.refreshTask, null);
});

test("typing before a queued refresh captures the dirty form before rendering", async () => {
  const { app, root } = fixture(); app.rendered = true; app.bindEvents();
  const captured = []; app.captureRefreshDraft = () => captured.push(app.dirty);
  let renders = 0; app.render = async () => { renders++; };
  const task = app.refresh(); root.dispatchEvent(new Event("input"));
  await task;
  assert.equal(app.dirty, true); assert.equal(renders, 1); assert.deepEqual(captured, [true]);
});

test("input during a refresh captures the dirty draft for the next queued render", async () => {
  const { app, root } = fixture(); app.rendered = true; app.bindEvents();
  let release, renders = 0; const captures = [];
  app.captureRefreshDraft = () => captures.push(app.dirty);
  app.render = () => { renders++; return new Promise((resolve) => { release = resolve; }); };
  const task = app.refresh(); await Promise.resolve(); app.refresh();
  root.dispatchEvent(new Event("input")); release(); await new Promise(setImmediate); release(); await task;
  assert.deepEqual(captures, [false, true, true]); assert.equal(renders, 2);
});

test("a failed refresh releases its queue for the next external update", async () => {
  const { app } = fixture(); app.rendered = true;
  app.render = () => { throw new Error("Render failed"); };
  await assert.rejects(app.refresh(), /Render failed/);
  assert.equal(app.refreshing, false); assert.equal(app.refreshTask, null);
  let rendered = false; app.render = async () => { rendered = true; };
  await app.refresh(); assert.equal(rendered, true);
});
