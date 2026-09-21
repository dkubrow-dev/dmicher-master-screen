import { message as localizedMessage } from "../localization.js";
import { number } from "./parameters.js";

export default Object.freeze({
  id: "wait", label: {"ru":"Ожидание","en":"Wait"},
  category: {"ru":"системные.общие","en":"system.general"},
  description: { ru: "Задерживает переход к следующему шагу на указанное число секунд.", en: "Delays the next step for the selected number of seconds." },
  scopes: ["object","group","world"], premium: false,
  template: {"seconds":1},
  normalize: p => ({ seconds: number(p.seconds, localizedMessage("Ожидание"), 0, true) })
});
