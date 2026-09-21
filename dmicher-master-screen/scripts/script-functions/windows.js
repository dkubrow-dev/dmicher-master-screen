import { text as t } from "../localization.js";
import { requireText } from "./parameters.js";

export async function execute({ engine, scene, p, admitted }) {
  if (!admitted()) return {};
  if (!engine.runtime.workspacePresets) throw new Error(t("Управление конфигурациями не подключено.", "Configuration control is not connected."));
  await engine.runtime.workspacePresets.activate(scene, "windows", p.configurationId, { isCurrent: admitted });
  return {};
}

export default Object.freeze({
  id: "windows", label: {"ru":"Окна","en":"Windows"},
  category: {"ru":"сцена.интерфейс","en":"scene.interface"},
  description: { ru: "Активирует подготовленную конфигурацию окон текущей сцены.", en: "Activates a prepared window configuration for the current scene." },
  scopes: ["object"], premium: false,
  template: {"configurationId":""},
  normalize: p => ({ configurationId: requireText(p.configurationId ?? "", 64, t("Конфигурация", "Configuration")) }),
  execute
});
