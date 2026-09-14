import test from "node:test";
import assert from "node:assert/strict";
import { DialogueVolumeController, registerDialogueVolume, DIALOGUE_VOLUME_SETTING } from "../dmicher-master-screen/scripts/dialogue-volume.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { masterScreenExtension } from "../../dmicher-premium/dmicher-premium/sctipts/features/master-screen/index.js";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.value = ""; this.isConnected = true; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  remove() { this.parent.children = this.parent.children.filter((child) => child !== this); this.isConnected = false; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  querySelector(selector) {
    if (selector.includes("global-volume")) return this.list ?? null;
    return this.children.find((child) => Object.hasOwn(child.dataset, "dmicherDialogueVolume"))
      ?? this.list?.querySelector(selector) ?? null;
  }
}

for (const generation of [13, 14]) test(`Foundry ${generation}: dialogue slider is native, local, deduplicated and disabled on revocation`, async () => {
  const old = { game: globalThis.game, document: globalThis.document, foundry: globalThis.foundry, Hooks: globalThis.Hooks };
  let allowed = false, settings;
  const saves = [], hooks = new Map(), list = new Element("ol"), root = new Element(); root.list = list;
  globalThis.game = { release: { generation }, i18n: { lang: generation === 13 ? "ru" : "en" }, settings: {
    register: (_id, _key, definition) => { settings = definition; }, get: () => 0.25,
    set: async (...args) => saves.push(args)
  } };
  globalThis.document = { createElement: (tag) => new Element(tag) };
  globalThis.foundry = { applications: { elements: { HTMLRangePickerElement: { create(options) {
    const slider = new Element("range-picker"); slider.value = options.value; slider.options = options; return slider;
  } } } }, audio: { AudioHelper: { volumeToInput: (value) => Math.sqrt(value), inputToVolume: (value) => value ** 2 } } };
  globalThis.Hooks = { on(name, callback) { hooks.set(name, callback); return name; }, off(name) { hooks.delete(name); } };
  const registration = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => allowed, extensions: [masterScreenExtension] });
  const controller = new DialogueVolumeController();
  try {
    registerDialogueVolume(); assert.equal(settings.scope, "client"); controller.install();
    controller.render(null, root); assert.equal(list.children.length, 1);
    const initial = list.children[0]; assert.equal(initial.children[2].disabled, true);
    assert.equal(initial.children[0].children[0].className, "dmicher-premium-badge");
    assert.equal(initial.children[0].children[0].textContent, "Premium");
    allowed = true; registration.notifyChanged(); assert.equal(list.children.length, 1);
    const row = list.children[0], slider = row.children[2];
    assert.equal(row, initial); assert.equal(slider.disabled, false);
    assert.equal(row.className, "flexrow"); assert.equal(slider.tagName, "RANGE-PICKER");
    assert.equal(slider.value, 0.5); assert.equal(slider.options.name, `dmicher-master-screen.${DIALOGUE_VOLUME_SETTING}`);
    assert.equal(row.children[0].textContent, generation === 13 ? "\u0414\u0438\u0430\u043b\u043e\u0433\u0438" : "Dialogues");
    controller.render(null, root); assert.equal(list.children.length, 1);
    slider.value = 0.8; slider.listeners.change(); await Promise.resolve();
    assert.deepEqual(saves[0], ["dmicher-master-screen", DIALOGUE_VOLUME_SETTING, 0.8 ** 2]);
    allowed = false; registration.notifyChanged(); assert.equal(list.children.length, 1); assert.equal(slider.disabled, true);
    slider.listeners.change(); assert.equal(saves.length, 1, "stale premium slider cannot save after revocation");
    root.isConnected = false; controller.render(null, new Element()); assert.equal(controller.roots.has(root), false);
  } finally { controller.dispose(); registration.dispose(); Object.assign(globalThis, old); }
});
