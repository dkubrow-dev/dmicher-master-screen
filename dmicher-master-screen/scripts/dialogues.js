import { MODULE_ID } from "./model.js";
import { getRuntime, saveRuntime, withSceneLock, isAuthority, asArray } from "./store.js";
import { sceneDistance, tokenCenter } from "./effects.js";
import { generics } from "./generics.js";
import { consumeTrigger, getTriggerGate, getTriggerKey } from "./triggers.js";
import { createManualDialogueService } from "./manual-dialogues.js";
import { EVENT_NAME } from "./event-catalog.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const random = () => foundry.utils.randomID();
const targetOf = (scene, descriptor) => descriptor?.type === "Token" ? scene.tokens.get(descriptor.id)
  : descriptor?.type === "Tile" ? scene.tiles.get(descriptor.id) : null;

export function getDialogueContext(sceneId, dialogueId, schemeId = "main") {
  const scene = game.scenes.get(sceneId), runtime = scene ? getRuntime(scene, { schemeId }) : null;
  const dialogue = runtime?.episode?.dialogues?.find((entry) => entry.id === dialogueId);
  return { scene, runtime, dialogue, target: scene && dialogue ? targetOf(scene, dialogue.target) : null };
}

export function validateDialogueAccess({ scene, runtime, descriptor, target, triggerType = "dialogue" }, actorTokenId, user, runId) {
  if (!scene || canvas.scene?.id !== scene.id || !runtime?.runId || runtime.runId !== runId) fail("Сцена или эпизод изменились. Откройте взаимодействие заново.");
  if (runtime.halted || runtime.episode?.stop || !descriptor?.enabled || !target || target.hidden
    || (descriptor.target.type === "Token" && runtime.disabledTokens?.includes(target.id))) fail("Взаимодействие сейчас недоступно.");
  const actorToken = scene.tokens.get(actorTokenId);
  if (!user || !actorToken?.actor || actorToken.hidden || (descriptor.target.type === "Token" && actorToken.id === target.id)
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail("Нужен принадлежащий вам персонаж на карте.");
  const origin = tokenCenter(actorToken, scene);
  const destination = descriptor.target.type === "Token" ? tokenCenter(target, scene)
    : { x: Number(target.x) + Number(target.width) / 2, y: Number(target.y) + Number(target.height) / 2 };
  if (actorToken.level != null && target.level != null && actorToken.level !== target.level) fail("Объект находится на другом уровне сцены.");
  if (sceneDistance(scene, origin, destination) > Number(descriptor.range ?? 5)) fail("Персонаж слишком далеко от объекта.");
  if (!actorToken.object?.checkCollision || actorToken.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) fail("Объект должен находиться в прямой видимости персонажа.");
  const gate = getTriggerGate(scene, runtime, descriptor.trigger, actorToken,
    { triggerKey: getTriggerKey(runtime, triggerType, descriptor.id), ignoreQuota: true });
  if (!gate.allowed) fail(gate.reason);
  return actorToken;
}

function visibleSession(session, dialogue, target) {
  const node = dialogue.nodes.find((entry) => entry.id === session.nodeId);
  return { sessionId: session.sessionId, dialogueId: dialogue.id, actorTokenId: session.actorTokenId,
    nodeId: session.nodeId, step: session.step, status: session.status, targetName: target.name ?? dialogue.name,
    title: dialogue.name, text: node?.text ?? "", art: node?.art || target.texture?.src || target.actor?.img || "",
    responses: session.status === "active" ? (node?.responses ?? []).map(({ id, label }) => ({ id, label })) : [] };
}

/** Stateful conversations and direct scene interactions share only authenticated input transport. */
export function createDialogueService({ emitEvent, onChange = () => {}, context = getDialogueContext,
  runtimeOf = getRuntime, save = saveRuntime, lock = withSceneLock, authority = isAuthority, validate = validateDialogueAccess } = {}) {
  const chat = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "scene-input" });
  const inFlight = new Map(), knownSessions = new Map();
  const sessionKey = (userId, actorTokenId) => `${userId}:${actorTokenId}`;
  const process = async (command, user, commandId) => {
    const initial = context(command.sceneId, command.dialogueId, command.schemeId ?? "main");
    if (!initial.scene) fail("Сцена не найдена.");
    const events = [];
    const result = await lock(initial.scene, async () => {
      const state = clone(runtimeOf(initial.scene, { schemeId: command.schemeId ?? "main" }));
      state.dialogueSessions ??= {}; state.dialogueCommands ??= {};
      const commandKey = `${user.id}:${commandId}`;
      if (state.dialogueCommands[commandKey]) return clone(state.dialogueCommands[commandKey]);
      let response;
      const emit = (name, session, payload, suffix = "response") => {
        if (!EVENT_NAME.test(name)) fail("Некорректное имя события взаимодействия.");
        events.push({ id: `${session.sessionId ?? commandId}.${session.step ?? 0}.${suffix}`, name,
          source: command.kind === "interaction" ? "interaction" : "dialogue", runId: state.runId,
          actorTokenId: session.actorTokenId, payload });
      };
      if (command.kind === "interaction") {
        const descriptor = state.episode?.interactions?.find((entry) => entry.id === command.interactionId);
        const target = descriptor ? targetOf(initial.scene, descriptor.target) : null;
        const actorToken = validate({ scene: initial.scene, runtime: state, descriptor, target, triggerType: "interaction" }, command.actorTokenId, user, command.runId);
        const triggerKey = getTriggerKey(state, "interaction", descriptor.id);
        const gate = getTriggerGate(initial.scene, state, descriptor.trigger, actorToken, { triggerKey });
        if (!gate.allowed) fail(gate.reason);
        const payload = { interactionId: descriptor.id, target: clone(descriptor.target), userId: user.id };
        emit(descriptor.eventName, { actorTokenId: command.actorTokenId }, payload, "interaction");
        consumeTrigger(state, triggerKey, descriptor.trigger);
        response = { status: "completed", interactionId: descriptor.id };
      } else if (command.kind === "leave") {
        const found = Object.values(state.dialogueSessions).find((session) => session.sessionId === command.sessionId && session.userId === user.id);
        if (found) { found.status = "left"; found.step++; }
        response = { status: "left", sessionId: command.sessionId };
      } else {
        let session, dialogue, admittedTrigger = null;
        if (command.kind === "start") {
          dialogue = state.episode?.dialogues?.find((entry) => entry.id === command.dialogueId);
          const target = dialogue ? targetOf(initial.scene, dialogue.target) : null;
          validate({ scene: initial.scene, runtime: state, descriptor: dialogue, target }, command.actorTokenId, user, command.runId);
          session = state.dialogueSessions[sessionKey(user.id, command.actorTokenId)];
          if (!(session?.status === "active" && session.runId === state.runId && session.dialogueId === dialogue.id)) {
            const triggerKey = getTriggerKey(state, "dialogue", dialogue.id);
            const gate = getTriggerGate(initial.scene, state, dialogue.trigger, initial.scene.tokens.get(command.actorTokenId), { triggerKey });
            if (!gate.allowed) fail(gate.reason);
            admittedTrigger = triggerKey;
            session = { sessionId: random(), userId: user.id, actorTokenId: command.actorTokenId, dialogueId: dialogue.id,
              schemeId: state.schemeId, runId: state.runId, nodeId: dialogue.startNodeId, step: 0, status: "active" };
            state.dialogueSessions[sessionKey(user.id, command.actorTokenId)] = session;
          }
        } else if (command.kind === "answer") {
          session = Object.values(state.dialogueSessions).find((entry) => entry.sessionId === command.sessionId && entry.userId === user.id);
          if (!session || session.status !== "active") fail("Разговор уже завершён.");
          if (session.nodeId !== command.nodeId || session.step !== command.step) fail("Этот ответ относится к предыдущему шагу разговора.");
          dialogue = state.episode?.dialogues?.find((entry) => entry.id === session.dialogueId);
        } else fail("Неизвестное действие диалога.");
        const target = dialogue ? targetOf(initial.scene, dialogue.target) : null;
        validate({ scene: initial.scene, runtime: state, descriptor: dialogue, target }, session.actorTokenId, user, session.runId);
        const node = dialogue.nodes.find((entry) => entry.id === session.nodeId);
        if (!node) fail("Текущий шаг разговора не найден.");
        let selected = null;
        if (command.kind === "answer") {
          selected = node.responses.find((entry) => entry.id === command.responseId);
          if (!selected) fail("Такого ответа нет на текущем шаге.");
          if (selected.nextNodeId && selected.eventName) fail("Ответ должен либо продолжать диалог, либо завершать его событием.");
          session.step++;
          if (selected.nextNodeId) {
            if (!dialogue.nodes.some((entry) => entry.id === selected.nextNodeId)) fail("Следующий шаг разговора не найден.");
            session.nodeId = selected.nextNodeId;
          } else session.status = "finished";
        }
        const currentNode = dialogue.nodes.find((entry) => entry.id === session.nodeId);
        if (!currentNode.responses?.length) session.status = "finished";
        const payload = { dialogueId: dialogue.id, responseId: selected?.id ?? null, target: clone(dialogue.target), userId: user.id };
        if (selected?.eventName && !(selected.eventName === "dialogue.finished" && session.status === "finished")) emit(selected.eventName, session, payload);
        if (session.status === "finished") emit("dialogue.finished", session, payload, "finished");
        if (admittedTrigger) consumeTrigger(state, admittedTrigger, dialogue.trigger);
        response = visibleSession(session, dialogue, target);
      }
      state.dialogueCommands[commandKey] = clone(response);
      for (const old of Object.keys(state.dialogueCommands).slice(0, -200)) delete state.dialogueCommands[old];
      await save(initial.scene, state);
      return response;
    });
    // SceneEvents admits work using the same Scene lock, so emit only after releasing it.
    for (const event of events) {
      try {
        if (typeof emitEvent !== "function") fail("Исполнитель событий сцены не подключён.");
        await emitEvent(initial.scene, event);
      } catch (error) {
        result.error = `Состояние сохранено, но событие «${event.name}» не зарегистрировано: ${error.message}`;
        await lock(initial.scene, async () => {
          const state = clone(runtimeOf(initial.scene, { schemeId: command.schemeId ?? "main" })); state.error = result.error;
          if (state.dialogueCommands?.[`${user.id}:${commandId}`]) state.dialogueCommands[`${user.id}:${commandId}`].error = result.error;
          await save(initial.scene, state);
        });
      }
    }
    onChange(initial.scene);
    return clone(result);
  };

  const send = async (raw) => {
    const command = { ...raw, schemeId: raw.schemeId ?? "main" };
    const key = JSON.stringify(command);
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      let response;
      if (authority() && game.user.isGM) response = await process(command, game.user, random());
      else {
        const gms = asArray(game.users).filter((user) => user.active && Number(user.role) === 4).map((user) => user.id);
        if (!gms.length) fail("Для взаимодействия нужен подключённый мастер.");
        response = await new Promise((resolve, reject) => {
          let messageId, timer, hookId;
          const check = (message) => {
            if (!messageId || message.id !== messageId) return;
            const result = message.getFlag?.(MODULE_ID, "dialogueResult");
            if (!result) return;
            clearTimeout(timer); Hooks.off("updateChatMessage", hookId);
            if (result.failure) reject(new Error(result.failure)); else resolve(result);
          };
          hookId = Hooks.on("updateChatMessage", check);
          timer = setTimeout(() => { Hooks.off("updateChatMessage", hookId); reject(new Error("Мастер не ответил. Состояние разговора можно восстановить повторным открытием.")); }, 20_000);
          chat.create({ author: game.user.id, content: "<p>Ширма: взаимодействие со сценой.</p>", flags: { [MODULE_ID]: { dialogueCommand: command } } },
            { audience: { type: "users", userIds: [...gms, game.user.id] }, kind: "dialogue-command", technical: true })
            .then((messages) => { if (!messages[0]) throw new Error("Запрос не отправлен."); messageId = messages[0].id; check(game.messages.get(messageId) ?? messages[0]); })
            .catch((error) => { clearTimeout(timer); Hooks.off("updateChatMessage", hookId); reject(error); });
        });
      }
      if (response.sessionId) {
        knownSessions.set(response.sessionId, clone(response));
        if (knownSessions.size > 200) knownSessions.delete(knownSessions.keys().next().value);
      }
      return response;
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
  };
  return Object.freeze({
    ...createManualDialogueService(),
    getContext: context,
    requestStart: (command) => send({ ...command, kind: "start", runId: context(command.sceneId, command.dialogueId, command.schemeId ?? "main").runtime?.runId }),
    requestInteraction: (command) => send({ ...command, kind: "interaction", runId: context(command.sceneId, null, command.schemeId ?? "main").runtime?.runId }),
    requestAnswer: (command) => {
      const known = knownSessions.get(command.sessionId);
      return send({ ...command, kind: "answer", nodeId: command.nodeId ?? known?.nodeId, step: command.step ?? known?.step });
    },
    leaveSession: (command) => send({ ...command, kind: "leave" }),
    async processCommand(message, initiatingUserId) {
      const command = message.getFlag?.(MODULE_ID, "dialogueCommand");
      if (!command || !authority()) return false;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      if (authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return true;
      const user = game.users.get(authorId);
      if (!user) return true;
      let result;
      try { result = await process(clone(command), user, message.id); }
      catch (error) { result = { failure: error.message }; }
      await message.update({ [`flags.${MODULE_ID}.dialogueResult`]: result,
        content: `<p>${generics.utilities.escapeHTML(result.failure ?? result.error ?? "Ширма: взаимодействие обработано.")}</p>` });
      if (!result.failure && !result.error) setTimeout(() => { void message.delete().catch(() => {}); }, 2000);
      return true;
    }
  });
}
