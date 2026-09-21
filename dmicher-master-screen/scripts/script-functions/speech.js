import { message as localizedMessage } from "../localization.js";
import { fail, requireText, number, bool, choice, effectExecutionMode, seconds, tags, only } from "./parameters.js";

export async function execute({ job, scene, object, stage, p, effects, current, admitted }) {
  const start = stage === "effect";
  if (start && admitted()) await effects.clearPreviousSpeech?.(scene, object, admitted);
  if (admitted() && (start && current?.deleteMessages || !start && p.duration > 0 && p.chat.deleteAfter) && current?.messageIds?.length) {
    await effects.removeSpeech(current.messageIds, admitted);
  }
  if (admitted() && p.chat.enabled && p.chat.timing === (start ? "before" : "after")) {
    const messages = await effects.speak(scene, object, p.chat.text, {
      ...p.chat,
      visibleOnly: true,
      rich: true,
      expiresAfter: !start && p.chat.deleteAfter ? p.duration : 0
    }, `${job.key}:${job.sequence}:chat`, admitted);
    return { messageIds: (messages ?? []).map(message => message.id) };
  }
  return { messageIds: start ? [] : current?.messageIds ?? [] };
}

export default Object.freeze({
  id: "speech", label: {"ru":"Реплика","en":"Speech"},
  description: {"ru":"Показывает реплику в чате и пузыре с настройками аудитории, времени и удаления.","en":"Shows speech in chat and a bubble with audience, timing, and deletion settings."},
  category: {"ru":"объекты.общение","en":"objects.communication"},
  scopes: ["object"], premium: false,
  template: {"executionMode":"wait","duration":0,"chat":{"enabled":true,"timing":"before","text":"","allowTags":[],"denyTags":[],"range":0,"deleteAfter":true},"bubble":{"enabled":true,"text":"","fontSize":24}},
  normalize(p) {
    const c = only(p.chat ?? {}, ["enabled", "timing", "text", "allowTags", "denyTags", "range", "deleteAfter"]);
    const b = only(p.bubble ?? {}, ["enabled", "text", "fontSize"]);
    const parameters = {
      executionMode: effectExecutionMode(p.executionMode, "wait"),
      duration: seconds(p.duration),
      chat: {
        enabled: bool(c.enabled, true, localizedMessage("Чат")),
        timing: choice(c.timing, ["before", "after"], "before"),
        text: requireText(c.text ?? "", 12000, localizedMessage("Текст чата")),
        allowTags: tags(c.allowTags),
        denyTags: tags(c.denyTags),
        range: number(c.range ?? 0, localizedMessage("Расстояние"), 0),
        deleteAfter: bool(c.deleteAfter, true, localizedMessage("Удалять сообщение"))
      },
      bubble: {
        enabled: bool(b.enabled, true, localizedMessage("Пузырь")),
        text: requireText(b.text ?? "", 4000, localizedMessage("Текст пузыря")),
        fontSize: number(b.fontSize ?? 24, localizedMessage("Размер текста"), 1)
      }
    };
    if (parameters.bubble.fontSize > 200) fail(localizedMessage("Размер текста пузыря не больше 200."));
    if (!parameters.chat.enabled && !parameters.bubble.enabled) fail(localizedMessage("Для реплики включите чат или пузырь."));
    return parameters;
  },
  execute
});
