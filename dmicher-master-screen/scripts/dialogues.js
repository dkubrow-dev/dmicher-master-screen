import { MODULE_ID } from "./model.js";
import { getRuntime, saveRuntime, withSceneLock, isAuthority } from "./store.js";
import { requestGMReply } from "./gm-request.js";
import { resolveObjectDialogue } from "./scene-objects.js";
import { objectKey, validateObjectAccess, interactionTriggerId } from "./interaction-access.js";
import { generics } from "./generics.js";
import { consumeTrigger, getTriggerGate, getTriggerKey } from "./triggers.js";
import { createManualDialogueService } from "./manual-dialogues.js";
import { EVENT_NAME } from "./event-catalog.js";
import { beginInteractionPause, freezeInteractionClock, dialogueSessionIsLive, INTERACTION_LEASE_MS } from "./interaction-pause.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const random = () => foundry.utils.randomID();
const targetOf = (scene, descriptor) => descriptor?.type === "Token" ? scene.tokens.get(descriptor.id)
  : descriptor?.type === "Tile" ? scene.tiles.get(descriptor.id) : null;

export function getDialogueContext(sceneId, dialogueId, schemeId = "main", source) {
  const scene = game.scenes.get(sceneId), runtime = scene ? getRuntime(scene, { schemeId }) : null;
  const resolved = source && scene && runtime ? resolveObjectDialogue(scene, source, { schemeId, episodeId: runtime.episodeId }) : null;
  const dialogue = resolved && resolved.asset.id === dialogueId ? resolved.config : null;
  return { scene, runtime, dialogue, target: scene && dialogue ? targetOf(scene, dialogue.target) : null };
}

export function validateDialogueAccess({ scene, runtime, descriptor, target, triggerType = "dialogue" }, actorTokenId, user, runId) {
  return validateObjectAccess({ scene, runtime, descriptor, target, triggerType }, actorTokenId, user, runId);
}

function visibleSession(session, dialogue, target) {
  const node = dialogue.nodes.find((entry) => entry.id === session.nodeId);
  return { sessionId: session.sessionId, dialogueId: dialogue.id, actorTokenId: session.actorTokenId, target: clone(dialogue.target),
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
    const initial = context(command.sceneId, command.dialogueId, command.schemeId ?? "main", command.target);
    if (!initial.scene) fail("Сцена не найдена.");
    const events = [];
    const releasePause = command.kind === "start" ? beginInteractionPause(initial.scene, command.target ?? initial.dialogue?.target) : () => {};
    const result = await lock(initial.scene, async () => {
      if (!authority()) fail("Исполняющий мастер изменился.");
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
          dialogue = context(command.sceneId, command.dialogueId, command.schemeId ?? "main", command.target).dialogue;
          const target = dialogue ? targetOf(initial.scene, dialogue.target) : null;
          validate({ scene: initial.scene, runtime: state, descriptor: dialogue, target }, command.actorTokenId, user, command.runId);
          session = state.dialogueSessions[sessionKey(user.id, command.actorTokenId)];
          if (!(["active", "finished"].includes(session?.status) && session.runId === state.runId && session.dialogueId === dialogue.id
            && objectKey(session.target) === objectKey(dialogue.target))) {
            const triggerKey = getTriggerKey(state, "dialogue", interactionTriggerId(dialogue));
            const gate = getTriggerGate(initial.scene, state, dialogue.trigger, initial.scene.tokens.get(command.actorTokenId), { triggerKey });
            if (!gate.allowed) fail(gate.reason);
            admittedTrigger = triggerKey;
            session = { sessionId: random(), userId: user.id, actorTokenId: command.actorTokenId, dialogueId: dialogue.id,
              target: clone(dialogue.target), actorId: initial.scene.tokens.get(command.actorTokenId)?.actor?.id,
              schemeId: state.schemeId, runId: state.runId, nodeId: dialogue.startNodeId, step: 0, status: "active" };
            state.dialogueSessions[sessionKey(user.id, command.actorTokenId)] = session;
          }
          if (dialogue.target.type === "Token") freezeInteractionClock(state, dialogue.target.id);
        } else if (["answer", "renew"].includes(command.kind)) {
          session = Object.values(state.dialogueSessions).find((entry) => entry.sessionId === command.sessionId && entry.userId === user.id);
          if (!dialogueSessionIsLive(session)) fail("Разговор уже завершён.");
          if (command.kind === "answer" && (session.status !== "active" || session.nodeId !== command.nodeId || session.step !== command.step)) fail("Этот ответ относится к предыдущему шагу разговора.");
          if (command.target && objectKey(command.target) !== objectKey(session.target)) fail("Ответ относится к другому объекту.");
          dialogue = context(command.sceneId, session.dialogueId, command.schemeId ?? "main", session.target).dialogue;
        } else fail("Неизвестное действие диалога.");
        const target = dialogue ? targetOf(initial.scene, dialogue.target) : null;
        if (session.actorId !== initial.scene.tokens.get(session.actorTokenId)?.actor?.id) fail("Персонаж взаимодействия изменился.");
        if (objectKey(session.target) !== objectKey(dialogue?.target)) fail("Разговор относится к другому объекту.");
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
        if (session.status === "finished" && !session.finishedEmitted) {
          emit("dialogue.finished", session, payload, "finished"); session.finishedEmitted = true;
        }
        if (admittedTrigger) consumeTrigger(state, admittedTrigger, dialogue.trigger);
        session.expiresAt = Date.now() + INTERACTION_LEASE_MS;
        response = visibleSession(session, dialogue, target);
      }
      state.dialogueCommands[commandKey] = clone(response);
      for (const old of Object.keys(state.dialogueCommands).slice(0, -200)) delete state.dialogueCommands[old];
      await save(initial.scene, state);
      return response;
    }).finally(releasePause);
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
        response = await requestGMReply(chat, { command, commandFlag: "dialogueCommand", responseFlag: "dialogueResult",
          content: "<p>Ширма: взаимодействие со сценой.</p>", kind: "dialogue-command",
          timeoutMessage: "Мастер не ответил. Состояние разговора можно восстановить повторным открытием." });
        if (response.failure) throw new Error(response.failure);
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
    requestStart: (command) => send({ ...command, kind: "start", runId: command.runId ?? context(command.sceneId, command.dialogueId, command.schemeId ?? "main", command.target).runtime?.runId }),
    requestInteraction: (command) => send({ ...command, kind: "interaction", runId: context(command.sceneId, null, command.schemeId ?? "main").runtime?.runId }),
    requestAnswer: (command) => {
      const known = knownSessions.get(command.sessionId);
      return send({ ...command, kind: "answer", nodeId: command.nodeId ?? known?.nodeId, step: command.step ?? known?.step });
    },
    leaveSession: (command) => send({ ...command, kind: "leave" }),
    renewSession: (command) => send({ ...command, kind: "renew" }),
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
