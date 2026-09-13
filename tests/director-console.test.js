import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticSummary, renderDiagnosticEntry } from "../dmicher-master-screen/scripts/apps/director-console.js";
import { renderMenu, renderMenuSettings } from "../dmicher-master-screen/scripts/apps/ide-view.js";
import { normalizeIDEPreferences, ScreenLayout } from "../dmicher-master-screen/scripts/apps/screen-layout.js";

test("Console exists only in Director navigation, settings and direct tab selection", () => {
  for (const mode of ["constructor", "director"]) {
    const available = mode === "director";
    assert.equal(renderMenu("detail", [], "parameters", { mode }).includes('data-id="console"'), available);
    assert.equal(renderMenuSettings("detail", [], mode).includes('data-menu-visible="console"'), available);
    const layout = { mode, preferences: normalizeIDEPreferences({}, mode), save() {} };
    assert.equal(ScreenLayout.prototype.selectDetailTab.call(layout, "console"), available);
    if (available) {
      ScreenLayout.prototype.setMode.call(layout, "constructor");
      assert.equal(layout.preferences.detailTab, "parameters");
    }
  }
});

test("A saved Director-only selection cannot leave Constructor with no visible detail tab", () => {
  const source = { hiddenDetail: ["parameters", "reference"], detailTab: "console" };
  assert.equal(normalizeIDEPreferences(source, "director").detailTab, "console");
  const constructor = normalizeIDEPreferences(source, "constructor");
  assert.equal(constructor.detailTab, "parameters");
  assert.ok(!constructor.hiddenDetail.includes("parameters"));
  assert.equal(normalizeIDEPreferences({ detailTab: "console" }, "constructor").detailTab, "parameters");
  assert.equal(normalizeIDEPreferences({ detailTab: "console", hiddenDetail: ["parameters"] }, "constructor").detailTab, "parameters");
});

test("Diagnostic entries render names and parameter/error snapshots as inert data", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const entry = { id: 1, at: "2026-09-14T12:30:00.123Z", level: "error", category: "signal", event: "subscriber.failed",
    context: { signalName: "<signal>", emitterName: "<img src=x onerror=bad>", subscriberName: "<script>bad</script>", value: { constructor: "safe" } },
    error: { name: "Error", message: '<button onclick="bad">', stack: "trace" } };
  const html = renderDiagnosticEntry(entry);
  assert.match(html, /Subscriber failed/);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"));
  assert.ok(html.includes("trace") && html.includes("safe"));
});

test("A completed method visibly reports rejection and stale/failed delivery outcomes", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const entry = { context: { signalName: "request", emitterName: "Guard", subscriberName: "Door", allowed: false } };
  assert.match(diagnosticSummary(entry), /Guard → Door.*Rejected/);
  assert.match(diagnosticSummary({ context: { status: "stale" } }), /stale/);
  assert.match(diagnosticSummary({ context: { status: "failed" } }), /Failed/);
  assert.match(diagnosticSummary({ context: { reason: "disabled" } }), /Disabled/);
});

test("Director control events name the command, initiator and scene in RU and EN", () => {
  const entry = { id: 8, at: "2026-09-15T12:00:00.000Z", level: "command", category: "control", event: "requested",
    context: { command: "stop-all", commandId: "director-1", initiatorId: "gm", initiatorName: "Master <GM>", sceneName: "Hall" } };
  for (const [lang, action, stage] of [["en", "Stop all", "Command received"], ["ru", "Остановить всё", "Команда принята"]]) {
    globalThis.game = { i18n: { lang } };
    const html = renderDiagnosticEntry(entry);
    assert.ok(html.includes(action)); assert.ok(html.includes(stage));
    assert.ok(html.includes("Master &lt;GM&gt;")); assert.ok(html.includes("Hall"));
    assert.ok(html.includes("director-1"));
  }
});
