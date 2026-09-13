import { MODULE_ID } from "./model.js";
import { generics } from "./generics.js";

const dialogueAudio = generics.premium.forModule(MODULE_ID, {
  apiVersion: 1, methods: ["resolveDialogueAudioPickerOptions", "resolveDialogueAudio"]
});
const audioPath = (value) => typeof value === "string" ? value.trim().slice(0, 2048) : "";
export const isDialogueAudioAvailable = () => dialogueAudio.getStatus().active;
export const subscribeDialogueAudioAccess = (listener) => dialogueAudio.subscribe(listener);

export function getDialogueAudioPickerOptions(current = "") {
  const path = audioPath(current);
  const result = dialogueAudio.invoke("resolveDialogueAudioPickerOptions", [path], () => null,
    (value) => value === null || (value?.type === "audio" && value.current === path));
  return result && { type: "audio", current: path };
}

export function resolveDialogueAudio(src, volume = 1) {
  const path = audioPath(src), level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
  if (!path) return null;
  const result = dialogueAudio.invoke("resolveDialogueAudio", [path, level], () => null,
    (value) => value === null || (value?.src === path && value.volume === level && value.loop === false));
  // Only these value fields cross the boundary, never callbacks or broadcasts.
  return result && { src: path, volume: level, loop: false };
}
