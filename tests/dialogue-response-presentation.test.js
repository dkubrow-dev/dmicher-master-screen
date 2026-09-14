import test from "node:test";
import assert from "node:assert/strict";
import { dialogueUsesResponseButtons, renderDialogueResponses, dialogueResponseId, bindDialogueResponses,
  dialogueMessages, renderDialogueMessages, dialogueWindowTitle } from "../dmicher-master-screen/scripts/dialogue-response-presentation.js";

const responses = (...labels) => labels.map((label, index) => ({ id: `choice-${index}`, label, pageId: "page" }));

test("all response labels must be short: word and Unicode character boundaries are independent", () => {
  assert.equal(dialogueUsesResponseButtons(responses("Yes", "Спасибо вам", "One two three")), true);
  assert.equal(dialogueUsesResponseButtons(responses("  One\n two\tthree  ")), true);
  assert.equal(dialogueUsesResponseButtons(responses("Yes", "One two three four")), false);
  assert.equal(dialogueUsesResponseButtons(responses("😀".repeat(80))), true);
  assert.equal(dialogueUsesResponseButtons(responses("😀".repeat(81))), false);
  assert.equal(dialogueUsesResponseButtons(responses(" ")), false);
});

test("mixed or long choices use one radio group, explicit reply and finish; short choices retain direct commands", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const choices = responses("Yes", 'Tell me more <script>alert("x")</script>');
  const html = renderDialogueResponses(choices, { groupName: "card-1", canFinish: true, actionAttribute: "data-dialogue-chat-action" });
  assert.match(html, /data-response-mode="radio"/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.match(html, /name="card-1"/);
  assert.match(html, /data-dialogue-answer data-page-id="page" disabled>Reply/);
  assert.match(html, /data-dialogue-chat-action="finish">Finish dialogue/);
  assert.doesNotMatch(html, /<script>/);
  const selected = renderDialogueResponses(choices, { selectedId: "choice-1", canFinish: true });
  assert.match(selected, /value="choice-1"[^>]* checked/);
  assert.match(selected, /data-dialogue-answer data-page-id="page">Reply/);
  const busy = renderDialogueResponses(choices, { selectedId: "choice-1", canFinish: true, busy: true });
  assert.equal((busy.match(/ disabled/g) ?? []).length, 4);
  const short = renderDialogueResponses(responses("Yes", "No"));
  assert.doesNotMatch(short, /type="radio"|data-dialogue-answer/);
  assert.equal((short.match(/data-action="answer"/g) ?? []).length, 2);
  assert.equal(renderDialogueResponses([]), "");
});

test("radio selection enables only its own reply and returns only its own checked response", () => {
  const firstAnswer = {}, secondAnswer = {};
  const first = { dataset: { busy: "false" }, querySelector: (selector) => selector === "[data-dialogue-answer]" ? firstAnswer : { value: "one" } };
  const second = { dataset: { busy: "true" }, querySelector: (selector) => selector === "[data-dialogue-answer]" ? secondAnswer : { value: "two" } };
  const selected = [];
  bindDialogueResponses({ querySelectorAll: () => [first, second] }, (id) => selected.push(id));
  first.onchange({ target: { value: "one", matches: () => true, closest: () => first } });
  assert.equal(firstAnswer.disabled, false); assert.equal(secondAnswer.disabled, undefined);
  second.onchange({ target: { value: "two", matches: () => true, closest: () => second } });
  assert.equal(secondAnswer.disabled, true);
  assert.deepEqual(selected, ["one", "two"]);
  assert.equal(dialogueResponseId({ dataset: {}, closest: () => first }), "one");
  assert.equal(dialogueResponseId({ dataset: {}, closest: () => second }), "two");
  assert.equal(dialogueResponseId({ dataset: { responseId: "short" } }), "short");
  assert.equal(dialogueResponseId({ dataset: {}, closest: () => null }), "");
});

test("history renderer shares snapshots safely with one-message chat cards and keeps player portraits on the right", () => {
  const history = [{ id: 'object"quoted', role: "object", name: "NPC <Keeper>", img: 'npc.webp" onerror="boom', text: "Hello <script>literal</script>", audio: "voice.ogg", imageAlignment: "left" },
    { id: "reply", role: "player", name: "Hero", text: "Yes", img: "hero.webp", audio: "forged.ogg", imageAlignment: "left" }];
  const html = renderDialogueMessages(history);
  assert.equal(html, renderDialogueMessages(dialogueMessages({ history })));
  assert.equal(html, history.map((entry) => renderDialogueMessages([entry])).join(""));
  assert.doesNotMatch(html, /<script>| onerror="/);
  assert.match(html, /NPC &lt;Keeper&gt;/);
  assert.match(html, /data-message-id="reply" data-image-alignment="right"/);
  assert.equal((html.match(/data-dialogue-audio-replay/g) ?? []).length, 1);
  assert.equal(renderDialogueMessages([]), "");
});

test("dialogue titles and reply controls are localized without translating the authored name", () => {
  for (const [lang, prefix, reply, finish] of [["ru", "Диалог", "Ответить", "Завершить диалог"], ["en", "Dialogue", "Reply", "Finish dialogue"]]) {
    globalThis.game = { i18n: { lang } };
    assert.equal(dialogueWindowTitle("Keeper. Greeting"), `${prefix}. Keeper. Greeting`);
    assert.equal(dialogueWindowTitle(), prefix);
    const html = renderDialogueResponses(responses("Please tell me more"), { canFinish: true });
    assert.ok(html.includes(reply)); assert.ok(html.includes(finish));
  }
});
