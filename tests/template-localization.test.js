import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { registerTemplateLocalization } from "../dmicher-master-screen/scripts/apps/template-localization.js";

const require = createRequire(import.meta.url);
for (const version of ["13.351", "14.366"]) {
  const library = `E:/Foundry Portable/Foundry VTT ${version}/App/resources/app/node_modules/handlebars`;
  test(`Foundry ${version} template translations follow the current language and preserve escaping`, { skip: !existsSync(library) }, () => {
    const hbs = require(library).create();
    registerTemplateLocalization(hbs);
    hbs.registerHelper("selectOptions", (_entries, { hash }) => hash.blank);
    const template = hbs.compile('{{dmicherScreenText "Уйти" "Leave"}} {{selectOptions entries blank=(dmicherScreenText "Выберите объект" "Choose an object")}} {{name}} {{dmicherScreenText "<имя>" "<name>"}}');
    globalThis.game = { i18n: { lang: "en" } };
    const data = { name: '<img src=x onerror="alert(1)">' };
    const english = template(data);
    assert.match(english, /^Leave Choose an object/);
    assert.ok(english.includes("&lt;name&gt;"));
    assert.ok(!english.includes("<img"));
    game.i18n.lang = "ru";
    assert.match(template(data), /^Уйти Выберите объект/);
  });
}
