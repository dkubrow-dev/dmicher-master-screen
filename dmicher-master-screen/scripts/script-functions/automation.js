import { bool, requireText } from "./parameters.js";
import { text } from "../localization.js";

export async function execute({ engine, scene, object, p, admitted }) {
  const target = p.objectUuid ? await globalThis.fromUuid(p.objectUuid) : object;
  if (!target || target.parent?.id !== scene.id) throw new Error(text("Выберите объект текущей сцены.", "Choose an object on this scene."));
  if (admitted()) await engine.runtime.setObjectAutomation(scene, { type: target.documentName, id: target.id }, p.enabled);
  return {};
}
export default Object.freeze({
  id: "automation", label: { ru: "Автоматизация", en: "Automation" },
  category: { ru: "объекты.общие", en: "objects.general" },
  description: { ru: "Включает или отключает поведение объекта; пустой UUID означает исполнителя.", en: "Enables or disables object behavior; an empty UUID means the executing object." },
  scopes: ["object"], premium: false, template: { objectUuid: "", enabled: true },
  normalize(p) { return { objectUuid: requireText(p.objectUuid ?? "", 2048, "UUID"), enabled: bool(p.enabled, true, text("Включена", "Enabled")) }; }, execute
});
