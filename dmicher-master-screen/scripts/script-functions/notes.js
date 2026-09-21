import { text as t } from "../localization.js";
import { requireText } from "./parameters.js";

export async function execute({ engine, scene, p, admitted }) {
  if (!admitted()) return {};
  if (!engine.runtime.workspacePresets) throw new Error(t("Управление конфигурациями не подключено.", "Configuration control is not connected."));
  await engine.runtime.workspacePresets.activate(scene, "notes", p.configurationId, { isCurrent: admitted });
  return {};
}

export default Object.freeze({
  id: "notes", label: {"ru":"Заметки","en":"Notes"},
  category: {"ru":"сцена.интерфейс","en":"scene.interface"},
  description: { ru: "Создаёт заметки из подготовленной конфигурации текущей сцены.", en: "Creates notes from a prepared configuration for the current scene." },
  scopes: ["object"], premium: false,
  template: {"configurationId":""},
  normalize: p => ({ configurationId: requireText(p.configurationId ?? "", 64, t("Конфигурация", "Configuration")) }),
  execute
});
