import { movement } from "./parameters.js";

export default Object.freeze({
  id: "move", label: {"ru":"Перемещение","en":"Move"},
  category: {"ru":"объекты.движение","en":"objects.movement"},
  description: { ru: "Изменяет позицию, поворот и размер объекта за заданное время или с заданной скоростью.", en: "Changes an object's position, rotation, and size using a duration or speed." },
  scopes: ["object"], premium: false,
  template: {"timeMode":"duration","duration":0,"position":null,"rotation":null,"size":null},
  normalize: movement
});
