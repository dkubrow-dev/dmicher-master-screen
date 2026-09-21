import { only } from "./parameters.js";

export async function execute({ admitted }) {
  if (admitted()) await globalThis.game.togglePause(true, true);
  return {};
}
export default Object.freeze({
  id: "pause", label: { ru: "Пауза", en: "Pause" },
  category: { ru: "системные.общие", en: "system.general" },
  description: { ru: "Немедленно ставит мир на паузу.", en: "Immediately pauses the world." },
  scopes: ["object", "group", "world"], premium: false, template: {},
  normalize(p) { only(p, []); return {}; }, execute
});
