import { message as localizedMessage } from "../localization.js";
import { bool } from "./parameters.js";
import { scriptObjectCapabilities } from "../script-movement.js";

export async function execute({ object, p, admitted }) {
  if (!scriptObjectCapabilities(object).visibility) throw new Error(localizedMessage("Этот объект не поддерживает скрытие."));
  if (admitted()) await object.update({ hidden: !p.visible });
  return {};
}

export default Object.freeze({
  id: "visibility", label: {"ru":"Видимость","en":"Visibility"},
  category: {"ru":"объекты.общие","en":"objects.general"},
  description: { ru: "Показывает или скрывает объект, если его нативный тип поддерживает видимость.", en: "Shows or hides the object when its native type supports visibility." },
  scopes: ["object"], premium: false,
  template: {"visible":true},
  normalize: p => ({ visible: bool(p.visible, true, localizedMessage("Видимость")) }),
  execute
});
