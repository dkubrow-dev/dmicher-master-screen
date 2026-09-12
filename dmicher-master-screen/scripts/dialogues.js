import { MODULE_ID } from "./model.js";
import { getRuntime, saveRuntime, withSceneLock, isAuthority } from "./store.js";
import { requestGMReply } from "./gm-request.js";
import { resolveObjectDialogue } from "./scene-objects.js";
import { objectKey, validateObjectAccess, interactionConditionId, sceneObject } from "./interaction-access.js";
import { generics } from "./generics.js";
import { consumeCondition, getConditionGate, getConditionKey } from "./interaction-conditions.js";
import { createManualDialogueService } from "./manual-dialogues.js";
import { findSignal } from "./signal-catalog.js";
import { validateParameters } from "./signal-types.js";
import { interactionSignal, notifyInteractionSignal } from "./interaction-signals.js";
import { beginInteractionPause, freezeInteractionClock, dialogueSessionIsLive, INTERACTION_LEASE_MS } from "./interaction-pause.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const random = () => foundry.utils.randomID();
export function getDialogueContext(sceneId, dialogueId, groupId = "main", source) {
  const scene = game.scenes.get(sceneId), runtime = scene ? getRuntime(scene, { groupId }) : null;
  const resolved = source && scene && runtime && dialogueId ? resolveObjectDialogue(scene, source, { groupId, stateId: runtime.stateId }, dialogueId) : null;
  const dialogue = resolved?.config ?? null;
  return { scene, runtime, dialogue, target: scene && dialogue ? sceneObject(scene, dialogue.target) : null };
}
export function validateDialogueAccess({ scene, runtime, descriptor, target, conditionType = "dialogue" }, actorTokenId, user, runId) {
  return validateObjectAccess({ scene, runtime, descriptor, target, conditionType }, actorTokenId, user, runId);
}
function visibleSession(session, dialogue, target) {
  const node = dialogue.nodes.find((entry) => entry.id === session.nodeId);
  return { sessionId: session.sessionId, dialogueId: dialogue.id, actorTokenId: session.actorTokenId, target: clone(dialogue.target),
    nodeId: session.nodeId, step: session.step, status: session.status, targetName: target.name ?? dialogue.name,
    title: dialogue.name, text: node?.text ?? "", art: node?.art || target.texture?.src || target.actor?.img || "",
    responses: session.status === "active" ? (node?.responses ?? []).map(({ id, label }) => ({ id, label })) : [] };
}
/** The command lease is persisted before awaiting subscribers. A second lock checks
 * ownership, the live run and the exact response again before advancing the dialogue. */
export function createDialogueService({ emitSignal, onChange = () => {}, context = getDialogueContext,
  runtimeOf = getRuntime, save = saveRuntime, lock = withSceneLock, authority = isAuthority, validate = validateDialogueAccess } = {}) {
  const chat = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "scene-input" });
  const inFlight = new Map(), commands = new Map(), knownSessions = new Map();
  const slot = (userId, actorTokenId, dialogueId, target) => `${userId}:${actorTokenId}:${dialogueId}:${objectKey(target)}`;
  const remember = (state, key, response) => {
    state.dialogueCommands ??= {}; state.dialogueCommands[key] = clone(response);
    for (const old of Object.keys(state.dialogueCommands).slice(0, -200)) delete state.dialogueCommands[old];
  };
  const customSignal = (scene, emitterKey, signalId, parameters, session, suffix) => {
    const descriptor = findSignal(scene, { emitterKey, signalId });
    if (!descriptor) fail("Сигнал не объявлен этим эмитентом.");
    return { id: `${session.sessionId}.${session.step}.${suffix}`, emitterKey, signalId, name: descriptor.name,
      parameters: validateParameters(descriptor, parameters ?? {}), context: { runId: session.runId, groupId: session.groupId } };
  };
  const processOnce = async (command, user, commandId) => {
    const initial = context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target);
    if (!initial.scene) fail("Сцена не найдена.");
    const scene = initial.scene, commandKey = `${user.id}:${commandId}`, signals = [], signalErrors = [];
    const release = command.kind === "start" ? beginInteractionPause(scene, command.target) : () => {};
    let staged;
    try {
      staged = await lock(scene, async () => {
        if (!authority()) fail("Исполняющий мастер изменился.");
        const state = clone(runtimeOf(scene, { groupId: command.groupId ?? "main" }));
        state.dialogueSessions ??= {}; state.dialogueCommands ??= {};
        const previous = state.dialogueCommands[commandKey];
        if (previous) { if (previous.status === "processing") fail("Исход предыдущего ответа ещё не подтверждён. Откройте диалог заново."); return { response: clone(previous) }; }
        if (command.kind === "interaction") {
          const descriptor = state.state?.interactions?.find((entry) => entry.id === command.interactionId), target = sceneObject(scene, descriptor?.target);
          const actor = validate({ scene, runtime: state, descriptor, target, conditionType: "interaction" }, command.actorTokenId, user, command.runId);
          const conditionKey = getConditionKey(state, "interaction", descriptor.id), gate = getConditionGate(scene, state, descriptor.conditions, actor, { conditionKey });
          if (!gate.allowed) fail(gate.reason);
          signals.push(customSignal(scene, objectKey(descriptor.target), descriptor.signalId, descriptor.parameters, { sessionId: commandId, step: 0, runId: state.runId, groupId: state.groupId }, "interaction"));
          consumeCondition(state, conditionKey, descriptor.conditions);
          const response = { status: "completed", interactionId: descriptor.id }; remember(state, commandKey, response); await save(scene, state); return { response };
        }
        let session, dialogue, target;
        if (command.kind === "start") {
          if (!command.dialogueId) fail("Нужно выбрать конкретный диалог.");
          ({ dialogue, target } = context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target));
          validate({ scene, runtime: state, descriptor: dialogue, target }, command.actorTokenId, user, command.runId);
          const key = slot(user.id, command.actorTokenId, dialogue.id, dialogue.target);
          session = state.dialogueSessions[key];
          const continuing = session && ["active", "interrupted"].includes(session.status) && session.runId === state.runId;
          if (!continuing) {
            const conditionKey = getConditionKey(state, "dialogue", interactionConditionId(dialogue));
            const gate = getConditionGate(scene, state, dialogue.conditions, scene.tokens.get(command.actorTokenId), { conditionKey });
            if (!gate.allowed) fail(gate.reason);
            session = { sessionId: random(), userId: user.id, actorTokenId: command.actorTokenId, dialogueId: dialogue.id, target: clone(dialogue.target),
              actorId: scene.tokens.get(command.actorTokenId)?.actor?.id, groupId: state.groupId, runId: state.runId, nodeId: dialogue.startNodeId, step: 0, status: "active" };
            state.dialogueSessions[key] = session; consumeCondition(state, conditionKey, dialogue.conditions);
            signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "opened"));
          } else if (session.status === "interrupted") {
            session.status = "active"; session.step++; signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "opened"));
          }
          if (dialogue.target.type === "Token") freezeInteractionClock(state, dialogue.target.id);
        } else {
          session = Object.values(state.dialogueSessions).find((entry) => entry?.sessionId === command.sessionId && entry.userId === user.id);
          if (!session) fail("Разговор не найден или принадлежит другому игроку.");
          if (command.dialogueId && command.dialogueId !== session.dialogueId) fail("Ответ относится к другому диалогу.");
          if (command.target && objectKey(command.target) !== objectKey(session.target)) fail("Ответ относится к другому объекту.");
          if (command.kind === "leave") {
            if (["active", "processing", "interrupted"].includes(session.status)) { session.status = "left"; session.step++; signals.push(interactionSignal(scene, "Dialogue", session.dialogueId, session, "closed")); }
            const response = { status: "left", sessionId: session.sessionId }; remember(state, commandKey, response); await save(scene, state); return { response };
          }
          if (!["answer", "renew"].includes(command.kind)) fail("Неизвестное действие диалога.");
          if (!dialogueSessionIsLive(session) || session.status !== "active") fail("Разговор уже завершён или ответ ещё обрабатывается.");
          ({ dialogue, target } = context(command.sceneId, session.dialogueId, command.groupId ?? "main", session.target));
        }
        if (session.actorId !== scene.tokens.get(session.actorTokenId)?.actor?.id) fail("Персонаж взаимодействия изменился.");
        if (!dialogue || objectKey(session.target) !== objectKey(dialogue.target)) fail("Диалог этого объекта больше недоступен.");
        validate({ scene, runtime: state, descriptor: dialogue, target }, session.actorTokenId, user, session.runId);
        const node = dialogue.nodes.find((entry) => entry.id === session.nodeId);
        if (!node) fail("Текущий шаг разговора не найден.");
        session.expiresAt = Date.now() + INTERACTION_LEASE_MS;
        if (command.kind === "answer") {
          if (session.nodeId !== command.nodeId || session.step !== command.step) fail("Ответ относится к предыдущему шагу разговора.");
          const selected = node.responses.find((entry) => entry.id === command.responseId);
          if (!selected) fail("Такого ответа нет на текущем шаге.");
          if (selected.signalId) customSignal(scene, `Dialogue:${dialogue.id}`, selected.signalId, selected.parameters, session, "answer");
          session.status = "processing";
          remember(state, commandKey, { status: "processing", sessionId: session.sessionId }); await save(scene, state);
          return { session: clone(session), dialogue: clone(dialogue), selected: clone(selected) };
        }
        if (!node.responses.length) { session.status = "finished"; signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "closed")); }
        const response = visibleSession(session, dialogue, target); remember(state, commandKey, response); await save(scene, state); return { response };
      });
    } finally { release(); }
    if (staged.session) {
      const original = staged.session;
      const outcome = await notifyInteractionSignal(emitSignal, scene, interactionSignal(scene, "Dialogue", original.dialogueId, original, "response", { responseId: staged.selected.id }));
      if (outcome.error) signalErrors.push(outcome.error);
      staged.response = await lock(scene, async () => {
        if (!authority()) fail("Исполняющий мастер изменился.");
        const state = clone(runtimeOf(scene, { groupId: original.groupId }));
        const session = Object.values(state.dialogueSessions ?? {}).find((entry) => entry?.sessionId === original.sessionId);
        if (!session || state.runId !== original.runId || session.status !== "processing" || session.step !== original.step) fail("Диалог изменён во время обработки сигнала.");
        const current = context(command.sceneId, session.dialogueId, original.groupId, session.target), dialogue = current.dialogue;
        try {
          if (outcome.status === "stale") fail("Автоматизация остановлена во время ответа.");
          validate({ scene, runtime: state, descriptor: dialogue, target: current.target }, session.actorTokenId, user, session.runId);
          const selected = dialogue.nodes.find((node) => node.id === session.nodeId)?.responses.find((entry) => entry.id === staged.selected.id);
          if (JSON.stringify(selected) !== JSON.stringify(staged.selected)) fail("Ответ изменён мастером во время обработки.");
          session.step++;
          if (selected.nextNodeId) {
            if (!dialogue.nodes.some((node) => node.id === selected.nextNodeId)) fail("Следующий шаг разговора не найден.");
            session.nodeId = selected.nextNodeId;
          }
          session.status = outcome.interrupt ? "interrupted" : outcome.exit || !selected.nextNodeId ? "finished" : "active";
          if (!outcome.interrupt && selected.signalId) signals.push(customSignal(scene, `Dialogue:${dialogue.id}`, selected.signalId, selected.parameters, session, "answer"));
          if (session.status === "active" && !dialogue.nodes.find((node) => node.id === session.nodeId)?.responses.length) session.status = "finished";
          if (session.status === "finished") signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "closed"));
          const response = visibleSession(session, dialogue, current.target); remember(state, commandKey, response); await save(scene, state); return response;
        } catch (error) {
          session.status = "interrupted"; session.step++;
          const response = { sessionId: session.sessionId, status: "interrupted", failure: error.message }; remember(state, commandKey, response); await save(scene, state); return response;
        }
      });
    }
    for (const signal of signals) { const outcome = await notifyInteractionSignal(emitSignal, scene, signal); if (outcome.error) signalErrors.push(outcome.error); }
    if (signalErrors.length) {
      staged.response.error = [...new Set(signalErrors)].join("; ");
      await lock(scene, async () => {
        if (!authority()) return;
        const state = clone(runtimeOf(scene, { groupId: command.groupId ?? "main" }));
        if (!state.dialogueCommands?.[commandKey]) return;
        state.error = staged.response.error; remember(state, commandKey, staged.response); await save(scene, state);
      });
    }
    onChange(scene); return clone(staged.response);
  };
  const process = (command, user, commandId) => {
    const key = `${command.sceneId}:${user.id}:${commandId}`;
    if (commands.has(key)) return commands.get(key);
    const task = processOnce(command, user, commandId).finally(() => commands.delete(key)); commands.set(key, task); return task;
  };
  const send = async (raw) => {
    const command = { ...raw, groupId: raw.groupId ?? "main" }, key = JSON.stringify(command);
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      let response;
      if (authority() && game.user.isGM) response = await process(command, game.user, random());
      else response = await requestGMReply(chat, { command, commandFlag: "dialogueCommand", responseFlag: "dialogueResult", content: "<p>Ширма: взаимодействие со сценой.</p>", kind: "dialogue-command", timeoutMessage: "Мастер не ответил. Состояние разговора можно восстановить повторным открытием." });
      if (response.failure) throw new Error(response.failure);
      if (response.sessionId) { knownSessions.set(response.sessionId, clone(response)); if (knownSessions.size > 200) knownSessions.delete(knownSessions.keys().next().value); }
      return response;
    })();
    inFlight.set(key, task); try { return await task; } finally { inFlight.delete(key); }
  };
  return Object.freeze({ ...createManualDialogueService(), getContext: context,
    requestStart: (command) => send({ ...command, kind: "start", runId: command.runId ?? context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target).runtime?.runId }),
    requestInteraction: (command) => send({ ...command, kind: "interaction", runId: command.runId ?? context(command.sceneId, null, command.groupId ?? "main").runtime?.runId }),
    requestAnswer: (command) => { const known = knownSessions.get(command.sessionId); return send({ ...command, kind: "answer", nodeId: command.nodeId ?? known?.nodeId, step: command.step ?? known?.step }); },
    leaveSession: (command) => send({ ...command, kind: "leave" }), renewSession: (command) => send({ ...command, kind: "renew" }),
    async processCommand(message, initiatingUserId) {
      const command = message.getFlag?.(MODULE_ID, "dialogueCommand");
      if (!command || !authority()) return false;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      if (authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return true;
      const user = game.users.get(authorId); if (!user) return true;
      let result; try { result = await process(clone(command), user, message.id); } catch (error) { result = { failure: error.message }; }
      await message.update({ [`flags.${MODULE_ID}.dialogueResult`]: result, content: `<p>${generics.utilities.escapeHTML(result.failure ?? "Ширма: взаимодействие обработано.")}</p>` });
      if (!result.failure) setTimeout(() => { void message.delete().catch(() => {}); }, 2000);
      return true;
    }
  });
}
