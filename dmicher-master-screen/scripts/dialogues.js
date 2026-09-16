import { message as localizedMessage, text } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { getRuntime, saveRuntime, withSceneLock, isAuthority } from "./store.js";
import { requestGMReply } from "./gm-request.js";
import { debugTrace, debugError } from "./debug.js";
import { resolveObjectDialogue, resolveRegisteredObjectDialogue } from "./scene-objects.js";
import { objectKey, validateObjectAccess, validateInteractionIdentity, interactionConditionId, sceneObject } from "./interaction-access.js";
import { generics } from "./generics.js";
import { consumeCondition, getConditionGate, getConditionKey } from "./interaction-conditions.js";
import { createManualDialogueService } from "./manual-dialogues.js";
import { findSignal } from "./signal-catalog.js";
import { validateParameters } from "./signal-types.js";
import { interactionSignal, notifyInteractionSignal } from "./interaction-signals.js";
import { beginInteractionPause, freezeInteractionClock } from "./interaction-pause.js";
import { dialogueSessionIsLive, INTERACTION_LEASE_MS } from "./interaction-session-model.js";
import { createScriptDialogueService } from "./script-dialogues.js";
import { appendDialogueMessage, dialogueObjectMessage, dialoguePlayerMessage, dialogueHistoryForRole, dialogueSessionView as visibleSession } from "./dialogue-history.js";
import { dialogueParticipant } from "./dialogue-participants.js";
import { validateListenerAccess } from "./dialogue-listeners.js";
import { normalizeDialoguePresentation } from "./interaction-model.js";
import { dialogueVisibility, syncDialogueRollMode } from "./dialogue-visibility.js";
import { evaluateInteractionMacro } from "./interaction-macro.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const random = () => foundry.utils.randomID();
// Capture the leading user's visibility when a line is accepted, before it can
// be replayed by a later listener. The history model stays independent of Foundry.
const appendMessage = (session, entry, user) => appendDialogueMessage(session, { ...entry, visibility: dialogueVisibility(session.presentation, user) });
export function getDialogueContext(sceneId, dialogueId, groupId = "main", source) {
  const scene = game.scenes.get(sceneId), runtime = scene ? getRuntime(scene, { groupId }) : null;
  const resolved = source && scene && runtime && dialogueId ? resolveObjectDialogue(scene, source, { groupId, stateId: runtime.stateId }, dialogueId) : null;
  const dialogue = resolved?.config ?? null;
  return { scene, runtime, dialogue, target: scene && dialogue ? sceneObject(scene, dialogue.target) : null };
}
export function getScriptDialogueContext(sceneId, dialogueId, groupId = "main", source) {
  const scene = game.scenes.get(sceneId), runtime = scene ? getRuntime(scene, { groupId }) : null;
  const resolved = source && scene && dialogueId ? resolveRegisteredObjectDialogue(scene, source, { groupId }, dialogueId) : null;
  const dialogue = resolved?.config ?? null;
  return { scene, runtime, dialogue, target: scene && dialogue ? sceneObject(scene, dialogue.target) : null };
}
export function validateScriptDialogueAccess(current, actorTokenId, user, runId) {
  const actorToken = validateInteractionIdentity(current, actorTokenId, user, runId);
  if (!current.runtime.stateId || !current.runtime.state) fail(localizedMessage("Нет действующего состояния с автоматизацией."));
  return actorToken;
}
export function validateDialogueAccess({ scene, runtime, descriptor, target, session, conditionType = "dialogue" }, actorTokenId, user, runId) {
  // Session provenance is read from GM-owned runtime, never from a player command.
  if (session?.origin === "script") return validateScriptDialogueAccess({ scene, runtime, descriptor, target }, actorTokenId, user, runId);
  return validateObjectAccess({ scene, runtime, descriptor, target, conditionType }, actorTokenId, user, runId);
}
/** The command lease is persisted before awaiting subscribers. A second lock checks
 * ownership, the live run and the exact response again before advancing the dialogue. */
export function createDialogueService({ emitSignal, onChange = () => {}, context = getDialogueContext,
  runtimeOf = getRuntime, save = saveRuntime, lock = withSceneLock, authority = isAuthority, validate = validateDialogueAccess,
  scriptContext = getScriptDialogueContext,
  messageService, openScriptWindow, presentScriptChat, onSessionChange = () => {}, onDialogueStart = () => {} } = {}) {
  const chat = messageService ?? generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "scene-input" });
  const inFlight = new Map(), commands = new Map(), knownSessions = new Map();
  const slot = (userId, actorTokenId, dialogueId, target) => `${userId}:${actorTokenId}:${dialogueId}:${objectKey(target)}`;
  const sessionContext = (sceneId, session, groupId) => ({
    ...(session.origin === "script" ? scriptContext : context)(sceneId, session.dialogueId, groupId, session.target), session
  });
  const getContext = (sceneId, dialogueId, groupId = "main", target, { sessionId } = {}) => {
    const current = context(sceneId, dialogueId, groupId, target);
    const session = sessionId && Object.values(current.runtime?.dialogueSessions ?? {}).find((entry) => entry.sessionId === sessionId);
    return session ? sessionContext(sceneId, session, groupId) : current;
  };
  // A GM observes a player's conversation without becoming its speaker or
  // extending its lease. Privileged reads are checked on every refresh.
  const inspectSession = (command) => {
    if (!game.user?.isGM || generics.chat.isManagedIdentityUser(game.user)) return null;
    const current = getContext(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target, { sessionId: command.sessionId });
    const session = current.session;
    if (!current.scene || !session || session.runId !== current.runtime?.runId
      || (command.runId && command.runId !== session.runId)
      || (command.dialogueId && command.dialogueId !== session.dialogueId)
      || (command.target && objectKey(command.target) !== objectKey(session.target))) return null;
    return visibleSession(session, current.dialogue, current.target, { role: "moderator" });
  };
  const refreshSession = (command) => {
    if (command.moderator) return inspectSession(command);
    const current = context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target);
    const session = Object.values(current.runtime?.dialogueSessions ?? {}).find((entry) => entry?.sessionId === command.sessionId);
    if (!session || !current.scene || globalThis.canvas?.scene?.id !== current.scene.id || session.runId !== current.runtime.runId) return null;
    let participant;
    try { participant = dialogueParticipant(current.scene, session, game.user, command.listenerTokenId); }
    catch { return null; }
    const resolved = sessionContext(command.sceneId, session, command.groupId ?? "main");
    return visibleSession(session, resolved.dialogue, resolved.target, { role: participant.role, listenerTokenId: command.listenerTokenId });
  };
  const remember = (state, key, response) => {
    // History already belongs to the session. Copying it into every response and
    // heartbeat cache makes Scene flags grow quadratically with the conversation.
    const { history, ...snapshot } = response;
    state.dialogueCommands ??= {};
    state.dialogueCommands[key] = { ...clone(snapshot), ...(Array.isArray(history) ? { historyLength: history.length } : {}) };
    for (const old of Object.keys(state.dialogueCommands).slice(0, -200)) delete state.dialogueCommands[old];
  };
  const recall = (state, saved) => {
    const { historyLength, ...response } = clone(saved);
    if (Number.isInteger(historyLength)) {
      const session = Object.values(state.dialogueSessions ?? {}).find((entry) => entry?.sessionId === response.sessionId);
      response.history = clone(dialogueHistoryForRole(session, response.role).slice(0, historyLength));
      if (response.role === "listener") {
        // Older cached DTO media may predate visibility snapshots. Rebuild only
        // from the authorized prefix rather than trusting their stored fallback.
        const current = response.history.findLast(entry => entry.role === "object");
        Object.assign(response, { text: current?.text ?? "", art: current?.img ?? "", audio: current?.audio ?? "",
          imageAlignment: current?.imageAlignment ?? "left", responses: [] });
      }
    }
    return response;
  };
  const customSignal = (scene, emitterKey, signalId, parameters, session, suffix) => {
    const descriptor = findSignal(scene, { emitterKey, signalId });
    if (!descriptor) fail(localizedMessage("Сигнал не объявлен этим эмитентом."));
    return { id: `${session.sessionId}.${session.step}.${suffix}`, emitterKey, signalId, name: descriptor.name,
      parameters: validateParameters(descriptor, parameters ?? {}), context: { runId: session.runId, groupId: session.groupId } };
  };
  const processOnce = async (command, user, commandId, { scriptStart = false } = {}) => {
    const initial = context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target);
    if (!initial.scene) fail(localizedMessage("Сцена не найдена."));
    const scene = initial.scene, commandKey = `${user.id}:${commandId}`, signals = [], signalErrors = [];
    const release = command.kind === "start" ? beginInteractionPause(scene, command.target) : () => {};
    let staged;
    try {
      let conditionSignature;
      if(command.kind === "start" && !scriptStart && initial.dialogue?.conditionMacro) {
        conditionSignature=JSON.stringify(initial.dialogue);
        if(!await evaluateInteractionMacro(scene,{target:command.target,conditionMacro:initial.dialogue.conditionMacro,runtime:initial.runtime,actorToken:scene.tokens?.get(command.actorTokenId),user,current:authority})) fail(text("Условия диалога сейчас не выполнены.","The dialogue conditions are not currently met."));
      }
      staged = await lock(scene, async () => {
        if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
        if(conditionSignature && JSON.stringify(context(command.sceneId,command.dialogueId,command.groupId ?? "main",command.target).dialogue) !== conditionSignature) fail(text("Условия диалога изменились. Откройте меню заново.","Dialogue conditions changed. Reopen the menu."));
        const state = clone(runtimeOf(scene, { groupId: command.groupId ?? "main" }));
        state.dialogueSessions ??= {}; state.dialogueCommands ??= {};
        const previous = state.dialogueCommands[commandKey];
        if (previous) {
          if (previous.role === "moderator" && (!user.isGM || generics.chat.isManagedIdentityUser(user))) fail(text("Доступ мастера к диалогу больше недоступен.", "GM access to this dialogue is no longer available."));
          if (previous.status === "processing") fail(localizedMessage("Исход предыдущего ответа ещё не подтверждён. Откройте диалог заново."));
          if (previous.role === "listener") {
            const session = Object.values(state.dialogueSessions).find(entry => entry?.sessionId === previous.sessionId);
            if (!session || session.runId !== state.runId) fail(text("У вас больше нет доступа к этому разговору.", "You no longer have access to this conversation."));
            dialogueParticipant(scene, session, user, previous.listenerTokenId);
          }
          return { response: recall(state, previous) };
        }
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
          if (!command.dialogueId) fail(localizedMessage("Нужно выбрать конкретный диалог."));
          ({ dialogue, target } = (scriptStart ? scriptContext : context)(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target));
          (scriptStart ? validateScriptDialogueAccess : validate)({ scene, runtime: state, descriptor: dialogue, target }, command.actorTokenId, user, command.runId);
          const key = slot(user.id, command.actorTokenId, dialogue.id, dialogue.target);
          session = state.dialogueSessions[key];
          const continuing = session && ["active", "interrupted"].includes(session.status) && session.runId === state.runId;
          if (!continuing) {
            const conditionKey = getConditionKey(state, "dialogue", interactionConditionId(dialogue));
            if (!scriptStart) {
              const gate = getConditionGate(scene, state, dialogue.conditions, scene.tokens.get(command.actorTokenId), { conditionKey });
              if (!gate.allowed) fail(gate.reason);
              consumeCondition(state, conditionKey, dialogue.conditions);
            }
            session = { sessionId: random(), userId: user.id, actorTokenId: command.actorTokenId, dialogueId: dialogue.id, target: clone(dialogue.target),
              actorId: scene.tokens.get(command.actorTokenId)?.actor?.id, groupId: state.groupId, runId: state.runId, nodeId: dialogue.startPageId, step: 0, status: "active",
              origin: scriptStart ? "script" : "player", title: dialogue.name,
              presentation: normalizeDialoguePresentation(dialogue.presentation), history: [], participants: [] };
            appendMessage(session, dialogueObjectMessage(session, dialogue.pages.find(({ id }) => id === session.nodeId), dialogue, target), user);
            state.dialogueSessions[key] = session;
            signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "opened"));
          } else if (session.status === "interrupted") {
            session.status = "active"; session.step++; signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "opened"));
          }
          if (scriptStart) session.origin = "script";
          freezeInteractionClock(state, dialogue.target, Date.now(), { external: !scriptStart });
        } else {
          session = Object.values(state.dialogueSessions).find((entry) => entry?.sessionId === command.sessionId);
          if (!session) fail(localizedMessage("Разговор не найден или принадлежит другому игроку."));
          if (command.dialogueId && command.dialogueId !== session.dialogueId) fail(localizedMessage("Ответ относится к другому диалогу."));
          if (command.target && objectKey(command.target) !== objectKey(session.target)) fail(localizedMessage("Ответ относится к другому объекту."));
          if (command.kind === "listen") {
            const actor = validateListenerAccess({ scene, runtime: state, session }, command.actorTokenId, user);
            session.participants ??= [];
            let participant = session.participants.find((entry) => entry.userId === user.id && entry.actorTokenId === actor.id && entry.role === "listener");
            if (!participant) {
              participant = { userId: user.id, actorTokenId: actor.id, actorId: actor.actor.id, role: "listener" };
              session.participants.push(participant);
            }
            participant.actorId = actor.actor.id;
            participant.expiresAt = Date.now() + INTERACTION_LEASE_MS;
            ({ dialogue, target } = sessionContext(command.sceneId, session, command.groupId ?? "main"));
            const response = visibleSession(session, dialogue, target, { role: "listener", listenerTokenId: actor.id });
            remember(state, commandKey, response); await save(scene, state); return { response };
          }
          if (command.kind === "moderator-finish") {
            if (!user?.isGM || generics.chat.isManagedIdentityUser(user)) fail(text("Завершить чужой диалог может только мастер.", "Only a GM can finish another player's dialogue."));
            if (session.runId !== state.runId || (command.runId && command.runId !== session.runId)) fail(localizedMessage("Разговор уже завершён или ответ ещё обрабатывается."));
            if (["active", "processing", "interrupted"].includes(session.status)) {
              session.status = "finished"; session.step++;
              signals.push(interactionSignal(scene, "Dialogue", session.dialogueId, session, "closed"));
            }
            ({ dialogue, target } = sessionContext(command.sceneId, session, command.groupId ?? "main"));
            const response = visibleSession(session, dialogue, target, { role: "moderator" });
            remember(state, commandKey, response); await save(scene, state); return { response };
          }
          const participant = dialogueParticipant(scene, session, user, command.listenerTokenId);
          if (participant.role === "listener") {
            if (!["renew", "leave"].includes(command.kind)) fail(text("Слушатель не может выбирать ответы или завершать разговор.", "A listener cannot choose answers or finish the conversation."));
            if (command.kind === "leave") {
              session.participants = session.participants.filter((entry) => entry !== participant.participant);
              const response = { status: "left", sessionId: session.sessionId, role: "listener" };
              remember(state, commandKey, response); await save(scene, state); return { response };
            }
            if (session.runId !== state.runId) fail(localizedMessage("Разговор уже завершён или ответ ещё обрабатывается."));
            participant.participant.expiresAt = Date.now() + INTERACTION_LEASE_MS;
            ({ dialogue, target } = sessionContext(command.sceneId, session, command.groupId ?? "main"));
            const response = visibleSession(session, dialogue, target, { role: "listener", listenerTokenId: command.listenerTokenId });
            remember(state, commandKey, response); await save(scene, state); return { response };
          }
          if (command.kind === "finish") {
            if (["active", "processing", "interrupted"].includes(session.status)) {
              session.status = "finished"; session.step++;
              signals.push(interactionSignal(scene, "Dialogue", session.dialogueId, session, "closed"));
            }
            ({ dialogue, target } = sessionContext(command.sceneId, session, command.groupId ?? "main"));
            const response = visibleSession(session, dialogue, target);
            remember(state, commandKey, response); await save(scene, state); return { response };
          }
          if (command.kind === "leave") {
            if (["active", "processing", "interrupted", "finished"].includes(session.status)) {
              // Finish already emitted the closing signal and released automation;
              // closing its remaining transcript window must not repeat the signal.
              const alreadyFinished = session.status === "finished";
              session.status = "left"; session.step++;
              if (!alreadyFinished) signals.push(interactionSignal(scene, "Dialogue", session.dialogueId, session, "closed"));
            }
            const response = { status: "left", sessionId: session.sessionId }; remember(state, commandKey, response); await save(scene, state); return { response };
          }
          if (!["answer", "renew"].includes(command.kind)) fail(localizedMessage("Неизвестное действие диалога."));
          const canContinue = session.status === "active";
          if (!dialogueSessionIsLive(session) || !canContinue) fail(localizedMessage("Разговор уже завершён или ответ ещё обрабатывается."));
          ({ dialogue, target } = sessionContext(command.sceneId, session, command.groupId ?? "main"));
        }
        if (session.actorId !== scene.tokens.get(session.actorTokenId)?.actor?.id) fail(localizedMessage("Персонаж взаимодействия изменился."));
        if (!dialogue || objectKey(session.target) !== objectKey(dialogue.target)) fail(localizedMessage("Диалог этого объекта больше недоступен."));
        validate({ scene, runtime: state, descriptor: dialogue, target, session }, session.actorTokenId, user, session.runId);
        const page = dialogue.pages.find((entry) => entry.id === session.nodeId);
        if (!page) fail(localizedMessage("Текущий шаг разговора не найден."));
        session.expiresAt = Date.now() + INTERACTION_LEASE_MS;
        if (command.kind === "answer") {
          if (session.nodeId !== command.nodeId || session.step !== command.step) fail(localizedMessage("Ответ относится к предыдущему шагу разговора."));
          const selected = page.responses.find((entry) => entry.id === command.responseId);
          if (!selected) fail(localizedMessage("Такого ответа нет на текущем шаге."));
          if (selected.signalId) customSignal(scene, `Dialogue:${dialogue.id}`, selected.signalId, selected.parameters, session, "answer");
          session.status = "processing";
          remember(state, commandKey, { status: "processing", sessionId: session.sessionId }); await save(scene, state);
          return { session: clone(session), dialogue: clone(dialogue), selected: clone(selected) };
        }
        if (session.status === "active" && !page.responses.length) { session.status = "finished"; signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "closed")); }
        const response = visibleSession(session, dialogue, target); remember(state, commandKey, response); await save(scene, state); return { response };
      });
    } finally { release(); }
    if (staged.session) {
      const original = staged.session;
      const outcome = await notifyInteractionSignal(emitSignal, scene, interactionSignal(scene, "Dialogue", original.dialogueId, original, "response", { responseId: staged.selected.id }));
      if (outcome.error) signalErrors.push(outcome.error);
      staged.response = await lock(scene, async () => {
        if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
        const state = clone(runtimeOf(scene, { groupId: original.groupId }));
        const session = Object.values(state.dialogueSessions ?? {}).find((entry) => entry?.sessionId === original.sessionId);
        if (!session || state.runId !== original.runId || session.status !== "processing" || session.step !== original.step) fail(localizedMessage("Диалог изменён во время обработки сигнала."));
        const current = sessionContext(command.sceneId, session, original.groupId), dialogue = current.dialogue;
        try {
          if (outcome.status === "stale") fail(localizedMessage("Автоматизация остановлена во время ответа."));
          validate({ scene, runtime: state, descriptor: dialogue, target: current.target, session }, session.actorTokenId, user, session.runId);
          const selected = dialogue.pages.find((page) => page.id === session.nodeId)?.responses.find((entry) => entry.id === staged.selected.id);
          if (JSON.stringify(selected) !== JSON.stringify(staged.selected)) fail(localizedMessage("Ответ изменён мастером во время обработки."));
          appendMessage(session, dialoguePlayerMessage(session, selected, scene.tokens.get(session.actorTokenId), user), user);
          session.step++;
          if (selected.nextPageId) {
            if (!dialogue.pages.some((page) => page.id === selected.nextPageId)) fail(localizedMessage("Следующий шаг разговора не найден."));
            session.nodeId = selected.nextPageId;
            appendMessage(session, dialogueObjectMessage(session, dialogue.pages.find(({ id }) => id === session.nodeId), dialogue, current.target), user);
          }
          session.status = outcome.interrupt ? "interrupted" : outcome.exit || !selected.nextPageId ? "finished" : "active";
          if (!outcome.interrupt && selected.signalId) signals.push(customSignal(scene, `Dialogue:${dialogue.id}`, selected.signalId, selected.parameters, session, "answer"));
          if (session.status === "active" && !dialogue.pages.find((page) => page.id === session.nodeId)?.responses.length) session.status = "finished";
          if (session.status === "finished") signals.push(interactionSignal(scene, "Dialogue", dialogue.id, session, "closed"));
          const response = visibleSession(session, dialogue, current.target); remember(state, commandKey, response); await save(scene, state); return response;
        } catch (error) {
          debugError("dialogue", "answer.interrupted", error, () => ({ sceneId: scene.id, groupId: session.groupId,
            runId: session.runId, sessionId: session.sessionId, dialogueId: session.dialogueId,
            target: session.target, nodeId: session.nodeId, step: session.step, responseId: staged.selected.id }));
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
  const process = (command, user, commandId, options) => {
    const key = `${command.sceneId}:${user.id}:${commandId}`;
    if (commands.has(key)) return commands.get(key);
    const details = () => ({ sceneId: command.sceneId, groupId: command.groupId, runId: command.runId,
      dialogueId: command.dialogueId, target: command.target, sessionId: command.sessionId,
      actorTokenId: command.actorTokenId, userId: user.id, commandId, nodeId: command.nodeId,
      step: command.step, responseId: command.responseId, listenerTokenId: command.listenerTokenId });
    if (command.kind !== "renew") debugTrace("dialogue", `${command.kind}.begin`, details);
    const task = processOnce(command, user, commandId, options).then(async (result) => {
      if (command.kind !== "renew") debugTrace("dialogue", `${command.kind}.result`, () => ({ ...details(),
        sessionId: result.sessionId, nodeId: result.nodeId, step: result.step, status: result.status, role: result.role }));
      if (result.failure || result.error) debugError("dialogue", `${command.kind}.failed`, result.failure || result.error, details);
      if (result.sessionId && command.kind === "start") {
        try { await onDialogueStart({ command, user, view: result }); }
        catch (error) { debugError("dialogue", "start-notice.failed", error, details); globalThis.ui?.notifications?.error?.(error.message); }
      }
      // Publication follows the committed session outside its document lock.
      // Chat failures cannot replay an already accepted answer or its signals.
      if (result.sessionId && command.kind !== "renew" && !options?.scriptStart) {
        try { await onSessionChange({ command, user, view: result }); }
        catch (error) { debugError("dialogue", "publication.failed", error, details); globalThis.ui?.notifications?.error?.(error.message); }
      }
      return result;
    }).catch((error) => { debugError("dialogue", `${command.kind}.failed`, error, details); throw error; })
      .finally(() => commands.delete(key));
    commands.set(key, task); return task;
  };
  const send = async (raw) => {
    const command = { ...raw, groupId: raw.groupId ?? "main" }, key = JSON.stringify(command);
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      if (command.kind === "start") await syncDialogueRollMode();
      let response;
      if (authority() && game.user.isGM) response = await process(command, game.user, random());
      else response = await requestGMReply(chat, { command, commandFlag: "dialogueCommand", responseFlag: "dialogueResult", content: `<p>${text("Ширма: взаимодействие со сценой.", "Master screen: scene interaction.")}</p>`, kind: "dialogue-command", timeoutMessage: localizedMessage("Мастер не ответил. Состояние разговора можно восстановить повторным открытием.") });
      if (response.failure) throw new Error(response.failure);
      if (response.sessionId) { knownSessions.set(response.sessionId, { nodeId: response.nodeId, step: response.step }); if (knownSessions.size > 200) knownSessions.delete(knownSessions.keys().next().value); }
      return response;
    })();
    inFlight.set(key, task); try { return await task; } finally { inFlight.delete(key); }
  };
  return Object.freeze({ ...createManualDialogueService(),
    ...createScriptDialogueService({ context: scriptContext, validate: validateScriptDialogueAccess,
      process: (command, user, commandId) => process(command, user, commandId, { scriptStart: true }),
      authority, chat, openWindow: openScriptWindow, presentChat: presentScriptChat }), getContext, refreshSession, inspectSession,
    requestStart: (command) => send({ ...command, kind: "start", runId: command.runId ?? context(command.sceneId, command.dialogueId, command.groupId ?? "main", command.target).runtime?.runId }),
    requestInteraction: (command) => send({ ...command, kind: "interaction", runId: command.runId ?? context(command.sceneId, null, command.groupId ?? "main").runtime?.runId }),
    requestAnswer: (command) => { const known = knownSessions.get(command.sessionId); return send({ ...command, kind: "answer", nodeId: command.nodeId ?? known?.nodeId, step: command.step ?? known?.step }); },
    requestListen: (command) => send({ ...command, kind: "listen" }),
    requestFinish: (command) => send({ ...command, kind: "finish" }),
    requestModeratorFinish: (command) => send({ ...command, kind: "moderator-finish" }),
    leaveSession: (command) => send({ ...command, kind: "leave" }), renewSession: (command) => send({ ...command, kind: "renew" }),
    async processCommand(message, initiatingUserId) {
      const command = message.getFlag?.(MODULE_ID, "dialogueCommand");
      if (!command || !authority()) return false;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      if (authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return true;
      const user = game.users.get(authorId); if (!user) return true;
      let result; try { result = await process(clone(command), user, message.id); } catch (error) { result = { failure: error.message }; }
      await message.update({ [`flags.${MODULE_ID}.dialogueResult`]: result, content: `<p>${generics.utilities.escapeHTML(result.failure ?? localizedMessage("Ширма: взаимодействие обработано."))}</p>` });
      if (!result.failure) setTimeout(() => { void message.delete().catch(() => {}); }, 2000);
      return true;
    }
  });
}
