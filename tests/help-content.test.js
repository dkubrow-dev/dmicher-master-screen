import test from "node:test";
import assert from "node:assert/strict";
import { getScreenHelpContent, getScreenSettingHelp } from "../dmicher-master-screen/scripts/help-content.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";

test("both help languages resolve every navigation, internal link and setting anchor", () => {
  for (const language of ["ru", "en"]) {
    const content = generics.help.normalizeHelpContent(getScreenHelpContent(language));
    const navigation = nodes => nodes.flatMap(node => [node.pageId, ...navigation(node.children)].filter(Boolean));
    const ids = [...navigation(content.tree), ...content.footer];
    assert.equal(new Set(ids).size, content.pages.size, "Every page is reachable exactly once");
    for (const page of content.pages.values()) {
      assert.ok(page.title && page.html);
      for (const link of page.html.matchAll(/data-help-page="([^"]+)"/g)) assert.ok(content.pages.has(link[1]), link[1]);
    }
    for (const target of getScreenSettingHelp(language)) {
      assert.ok(content.pages.get(target.pageId)?.html.includes(`id="${target.anchor}"`), `${target.pageId}#${target.anchor}`);
      assert.ok(target.hint && target.label);
    }
  }
});

test("help language selection preserves deep links and translates page content", () => {
  const ru = getScreenHelpContent("ru-RU"), en = getScreenHelpContent("en");
  assert.deepEqual(ru.pages.map(p => p.id), en.pages.map(p => p.id));
  for (let index = 0; index < ru.pages.length; index++) assert.notEqual(ru.pages[index].html, en.pages[index].html);
  assert.deepEqual(getScreenHelpContent("de"), en);
  assert.deepEqual(ru.footer, ["author", "thanks", "premium"]);
});
