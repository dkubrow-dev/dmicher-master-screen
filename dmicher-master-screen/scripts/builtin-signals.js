import { MODULE_ID } from "./model.js";
import { asArray, getDefinitions } from "./store.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { text } from "./localization.js";

export const SCENE_COLLECTIONS = SCENE_OBJECT_COLLECTIONS;
export const sceneUuid = (scene) => scene.uuid ?? `Scene.${scene.id}`;
export const virtualUuid = (scene, type, id) => `${sceneUuid(scene)}.dmicher.${type}.${id}`;
const description = (ru, en) => ({ ru, en });
const labels = {
  sceneUuid: ["UUID сцены", "Scene UUID"], userUuid: ["UUID пользователя", "User UUID"], actorUuid: ["UUID персонажа", "Character UUID"],
  groupUuid: ["UUID группы", "Group UUID"], groupName: ["Название группы", "Group name"], stateUuid: ["UUID состояния", "State UUID"], stateName: ["Название состояния", "State name"],
  previousStateUuid: ["UUID исходного состояния", "Previous state UUID"], previousStateName: ["Название исходного состояния", "Previous state name"],
  objectUuid: ["UUID объекта взаимодействия", "Interaction object UUID"], shopUuid: ["UUID магазина", "Shop UUID"], dialogueUuid: ["UUID диалога", "Dialogue UUID"], responseUuid: ["UUID выбранного ответа", "Selected response UUID"],
  playerTokenUuid: ["UUID персонажа, выдавшего команду", "Commanding character token UUID"], commandId: ["Встроенная команда", "Built-in command"], parameters: ["Параметры команды (JSON)", "Command parameters (JSON)"],
  startedAt: ["Время начала команды", "Command start time"], patronUuid: ["UUID поручителя", "Patron UUID"], otherObjectUuid: ["UUID второго объекта", "Other object UUID"],
  x: ["Координата X", "X coordinate"], y: ["Координата Y", "Y coordinate"], text: ["Текст сообщения", "Message text"], recipients: ["Получатели (JSON)", "Recipients (JSON)"], mode: ["Режим сообщения", "Message mode"], noteUuid: ["UUID заметки", "Note UUID"],
  combatUuid: ["UUID боя", "Combat UUID"], previousActorUuid: ["UUID персонажа, закончившего ход", "Previous character UUID"], currentActorUuid: ["UUID персонажа, начавшего ход", "Current character UUID"],
  paused: ["Игра приостановлена", "Game paused"], allowed: ["Разрешить действие: все подписчики должны вернуть true", "Allow action: every subscriber must return true"],
  message: ["Сообщение мастеру", "Message for the GM"], exit: ["Завершить диалог успешно", "Finish the dialogue successfully"], interrupt: ["Прервать диалог с сохранением позиции", "Suspend dialogue and remember its position"]
};
const field = (name, type = "string", options = {}) => ({ name, type, nullable: false, builtin: true, description: description(...labels[name]), ...options });
const textFields = (...names) => names.map((name) => field(name));
const sceneUser = () => textFields("sceneUuid", "userUuid");
const groupFields = () => textFields("sceneUuid", "groupUuid", "groupName", "stateUuid", "stateName");
const transitionFields = () => [...groupFields(), ...textFields("previousStateUuid", "previousStateName")];
const permission = () => [field("allowed", "boolean", { default: true }), field("message", "string", { nullable: true, default: null })];
const interactionFields = (kind) => textFields("sceneUuid", "objectUuid", `${kind}Uuid`, "userUuid", "actorUuid");
const combatFields = () => [...textFields("sceneUuid", "combatUuid"), ...["groupUuid", "groupName", "stateUuid", "stateName"].map((name) => field(name, "string", { nullable: true, default: null }))];
const commandFields = () => [...textFields("playerTokenUuid", "objectUuid", "commandId"), field("parameters", "string", { default: "{}" }), field("startedAt", "number", { default: 0 }), field("patronUuid", "string", { nullable: true, default: null })];
const objectEventFields = () => [...textFields("objectUuid", "userUuid"), field("x", "number"), field("y", "number"), field("patronUuid", "string", { nullable: true, default: null })];
const collisionSpec = ["collision", "Столкновение", "Collision", "Соприкосновение объектов после изменения положения.", "Objects touch after a position change.", [...objectEventFields(), field("otherObjectUuid")], []];
const nativeObjectSpecs = {
  Token: [collisionSpec, ["message", "Сообщение", "Message", "Сообщение чата от имени токена.", "A chat message spoken by the token.", [...textFields("objectUuid", "userUuid", "text", "recipients", "mode")], []]],
  Tile: [collisionSpec], Drawing: [collisionSpec], Region: [collisionSpec],
  Wall: [collisionSpec,
    ["doorOpened", "Дверь открыта", "Door opened", "Незапертая дверь открыта.", "An unlocked door opened.", objectEventFields(), []],
    ["doorClosed", "Дверь закрыта", "Door closed", "Дверь закрыта.", "A door closed.", objectEventFields(), []]],
  AmbientLight: [
    ["lightOn", "Свет включён", "Light on", "Источник света включён.", "The light source was enabled.", objectEventFields(), []],
    ["lightOff", "Свет выключен", "Light off", "Источник света выключен.", "The light source was disabled.", objectEventFields(), []]],
  Note: [["noteOpened", "Заметка открыта", "Note opened", "Пользователь открыл заметку.", "A user opened the note.", textFields("objectUuid", "userUuid", "noteUuid"), []]]
};
// Native objects share command lifecycle signals. The packet is structured data;
// its open command parameters travel as JSON within the existing scalar signal interface.
const objectCommandSpecs = [
  ["commandRequested", "Проверка команды", "Command requested", "До приёма команды; отказ любого подписчика отменяет её выполнение.", "Before accepting a command; any subscriber denial cancels it.", commandFields(), permission()],
  ["commandStarted", "Команда начата", "Command started", "Принятая команда начинает предваряющий скрипт или встроенное действие.", "An accepted command starts its preceding script or built-in action.", commandFields(), []],
  ["commandCompleted", "Команда выполнена", "Command completed", "Завершены встроенное действие и заканчивающий скрипт команды.", "The built-in action and following command script have completed.", commandFields(), []],
  ["commandCancelled", "Команда отменена", "Command cancelled", "Команда отменена или остановлена до успешного завершения.", "The command was cancelled or stopped before successful completion.", commandFields(), []]
];
const specs = {
  Scene: [
    ["activated", "Активация", "Activation", "Сцена активирована штатными средствами Foundry.", "The scene was activated in Foundry.", [], []],
    ["userEntered", "Вход пользователя", "User entered", "Пользователь открыл эту сцену.", "A user started viewing this scene.", sceneUser(), []],
    ["userLeft", "Выход пользователя", "User left", "Пользователь покинул эту сцену.", "A user left this scene.", sceneUser(), []],
    ["pauseChanged", "Приостановка игры", "Game pause changed", "Foundry поставил игру на паузу или снял её.", "Foundry paused or resumed the game.", [...textFields("sceneUuid"), field("paused", "boolean")], []]
  ],
  Combat: [
    ["combatStarted", "Начало боя", "Combat started", "Мастер начал бой.", "The GM started combat.", combatFields(), []],
    ["turnChanged", "Передача хода", "Turn changed", "Ход передан другому участнику боя.", "The turn passed to another combatant.", textFields("sceneUuid", "combatUuid", "previousActorUuid", "currentActorUuid"), []],
    ["roundStarted", "Новый раунд", "Round started", "Начался новый раунд боя.", "A new combat round started.", textFields("sceneUuid", "combatUuid"), []],
    ["combatEnded", "Конец боя", "Combat ended", "Мастер завершил бой.", "The GM ended combat.", combatFields(), []]
  ],
  Group: [
    ["validateStart", "Валидация запуска", "Validate start", "До запуска группы; любой отказ подписчика отменяет запуск.", "Before starting a group; any subscriber denial cancels the start.", groupFields(), permission()],
    ["started", "Запуск осуществлён", "Started", "Группа запущена в указанном состоянии.", "The group started in the specified state.", groupFields(), []],
    ["validateTransition", "Валидация перехода", "Validate transition", "До смены состояния; любой отказ подписчика отменяет переход.", "Before changing state; any subscriber denial cancels the transition.", transitionFields(), permission()],
    ["transitioned", "Переход осуществлён", "Transitioned", "Группа перешла в новое состояние.", "The group entered its new state.", transitionFields(), []]
  ],
  Shop: [
    ["opened", "Открыт", "Opened", "Открыта торговая сессия игрока и персонажа.", "A trading session opened for a player and character.", interactionFields("shop"), []],
    ["beforePurchase", "До покупки", "Before purchase", "После подтверждения, до переноса вещей; любой отказ отменяет сделку.", "After confirmation, before item transfer; any denial cancels the trade.", interactionFields("shop"), permission()],
    ["purchased", "Покупка", "Purchased", "Передача вещей успешно завершена.", "The item transfer completed successfully.", interactionFields("shop"), []],
    ["closed", "Закрыт", "Closed", "Торговая сессия закрыта.", "The trading session closed.", interactionFields("shop"), []]
  ],
  Dialogue: [
    ["opened", "Открыт", "Opened", "Игрок начал или продолжил диалог.", "A player started or resumed a dialogue.", interactionFields("dialogue"), []],
    ["response", "Выбор диалога", "Dialogue response", "Игрок выбрал ответ; прерывание сохраняет позицию и имеет приоритет перед завершением.", "A player chose a response; suspension preserves the position and takes priority over completion.", [...interactionFields("dialogue"), field("responseUuid")], [field("exit", "boolean", { default: false }), field("interrupt", "boolean", { default: false }), field("message", "string", { default: "" })]],
    ["closed", "Завершён", "Finished", "Разговор завершён ответом, конечным блоком или игроком; окно истории может оставаться открытым. При прерывании не испускается.", "The conversation finished through a reply, terminal block or player action; its transcript window may remain open. Not emitted on suspension.", interactionFields("dialogue"), []]
  ]
};

/** Built-in declarations are derived from existing documents, never create scene data. */
export function listSignalEmitters(scene) {
  if (!scene?.id) return [];
  const raw = scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings ?? {};
  const emitters = [{ key: `Scene:${scene.id}`, type: "Scene", id: scene.id, name: scene.name ?? text("Сцена", "Scene"), groupId: null, uuid: sceneUuid(scene), builtin: true }];
  if (globalThis.CONFIG?.Combat?.documentClass || globalThis.game?.combats) emitters.push({ key: `Combat:${scene.id}`, type: "Combat", id: scene.id, name: text("Боевой агент", "Combat agent"), description: description("Боевой агент", "Combat agent"), groupId: null, uuid: virtualUuid(scene, "Combat", scene.id), builtin: true });
  for (const group of getDefinitions(scene)) emitters.push({ key: `Group:${group.groupId}`, type: "Group", id: group.groupId, name: group.groupName, groupId: group.groupId, uuid: virtualUuid(scene, "Group", group.groupId), builtin: true });
  for (const [type, collection] of Object.entries(SCENE_COLLECTIONS)) for (const document of asArray(scene[collection])) {
    const key = `${type}:${document.id}`;
    emitters.push({ key, type, id: document.id, name: document.name ?? type, groupId: raw[key]?.groupId ?? null, uuid: document.uuid ?? `${sceneUuid(scene)}.${type}.${document.id}`, builtin: false,
      ...(type === "Wall" ? { door: Number(document.door) > 0 } : {}) });
  }
  const assets = scene.getFlag?.(MODULE_ID, "interactionCatalog") ?? {};
  for (const [type, collection] of [["Shop", "shops"], ["Dialogue", "dialogues"]]) for (const asset of assets[collection] ?? []) emitters.push({ key: `${type}:${asset.id}`, type, id: asset.id, name: asset.name, groupId: null, uuid: virtualUuid(scene, type, asset.id), builtin: true });
  return emitters;
}
export function builtinSignals(emitter, { includeUnavailable = false } = {}) {
  const native = Object.hasOwn(SCENE_COLLECTIONS, emitter.type);
  const declarations = specs[emitter.type] ?? (native ? [...objectCommandSpecs, ...(nativeObjectSpecs[emitter.type] ?? [])] : []);
  const available = name => emitter.type !== "Wall" || !name.startsWith("door") || emitter.door;
  return structuredClone(declarations.filter(([name]) => includeUnavailable || available(name)).map(([name, ru, en, ruDescription, enDescription, parameters, returns]) => ({
    id: `builtin:${emitter.key}:${name}`, emitterKey: emitter.key, name, label: description(ru, en), description: description(ruDescription, enDescription), builtin: true, parameters, returns,
    ...(!available(name) ? { available: false } : {})
  })));
}
export function builtinCatalog(scene, options) { return { signals: listSignalEmitters(scene).flatMap(emitter => builtinSignals(emitter, options)), macros: [], subscriptions: [] }; }
