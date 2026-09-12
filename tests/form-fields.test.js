import test from "node:test";
import assert from "node:assert/strict";
import { actionButton, textInput, selectOptions, formField, formValue, formChecked, parameterRow } from "../dmicher-master-screen/scripts/apps/form-fields.js";

test("shared form renderers keep configured names and values as text", () => {
  const unsafe = '\"><img src=x onerror=alert(1)>';
  for (const markup of [actionButton(unsafe, unsafe), textInput(unsafe, unsafe, unsafe),
    selectOptions([{ id: unsafe, name: unsafe }], unsafe), parameterRow(unsafe, "<input>")]) {
    assert.ok(!markup.includes("<img"));
    assert.ok(markup.includes("&lt;img"));
  }
  assert.match(selectOptions([{ id: "a", name: "A" }], "a"), /value="a" selected/);
  assert.ok(!selectOptions([{ id: "a", name: "A" }], "a").includes('value=""'));
  assert.match(selectOptions([], null, "Choose"), /value="">Choose/);
});

test("form lookup escapes CSS strings and retains false, zero and empty values", () => {
  let selector;
  const root = { querySelector: (query) => { selector = query; return { value: "", checked: false }; } };
  formField(root, 'unsafe"\\\nname');
  assert.equal(selector, '[name="unsafe\\"\\\\\\a name"]');
  assert.equal(formValue(root, "known", "fallback"), "");
  assert.equal(formChecked(root, "known"), false);
  assert.equal(formValue(null, "missing", "fallback"), "fallback");
  assert.equal(formValue({ querySelector: () => ({ value: 0 }) }, "number", "fallback"), 0);
});
