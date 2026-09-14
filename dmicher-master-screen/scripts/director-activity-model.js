import { text as t } from "./localization.js";
import { scriptActionLabel } from "./script-action-labels.js";
import { objectCommandName } from "./object-command-model.js";
import { scriptProgressKey as progressKey } from "./script-model.js";
import { dialogueSessionIsLive, shopSessionIsLive } from "./interaction-session-model.js";

const keyOf = target => target ? `${target.type}:${target.id}` : "";
const unavailable = () => t("Недоступен", "Unavailable");
const sourceName = source => ({ combat: t("Бой", "Combat"), interaction: t("Взаимодействие", "Interaction"),
  manual: t("Ручная остановка", "Manual stop"), command: t("Команда", "Command"), error: t("Ошибка", "Error") })[source] ?? "";
const slotName = slot => ({ initial: t("Исходное состояние", "Initial state"), transition: t("Переход", "Transition"),
  routine: t("Рутина", "Routine"), "command-before": t("До команды", "Before command"), "command-after": t("После команды", "After command") })[slot] ?? "";
function progressStatus(progress, run) {
  if (run?.halted) return t("Остановлен", "Stopped");
  if (progress?.interruption) return `${sourceName(progress.interruption.source)} · ${progress.status === "interrupted" ? t("Ожидает продолжения", "Waiting to resume") : t("Прерван", "Interrupted")}`;
  return ({ done: t("Завершён", "Completed"), stopped: t("Прерван", "Interrupted"), failed: t("Ошибка", "Failed"),
    uncertain: t("Нужна проверка мастера", "GM review required"), pending: t("Выполняется", "Running"),
    ready: t("Выполняется", "Running") })[progress?.status] ?? t("Ожидает запуска", "Waiting to start");
}

function interactionStatus(kind, session, tradeIssue) {
  if (kind === "shop") {
    if (tradeIssue === "uncertain") return t("Нужна сверка обмена", "Trade reconciliation required");
    if (tradeIssue === "processing") return t("Обмен выполняется", "Trade in progress");
    return session.status === "pending" ? t("Ожидает решения мастера", "Awaiting GM approval") : t("Подготовка обмена", "Editing trade");
  }
  if (session.status === "interrupted") return t("Прерван", "Interrupted");
  return session.status === "processing" ? t("Обрабатывается ответ", "Processing reply") : t("Идёт диалог", "In conversation");
}

/** Compact snapshots only. In particular, no transcript, offer, parameter JSON or
 * countdown is read: neither a growing history nor a clock tick changes a row. */
export function directorInteractionRows({ sceneId, runtimes = [], dialogueNames = new Map(), shopNames = new Map(),
  objectName = () => "", tokenName = () => "", userName = () => "", groupName = () => "", now = Date.now() }) {
  const rows = [], deadlines = [];
  for (const run of runtimes) {
    // Receipts may still be processing or need reconciliation after the offer
    // enters pending. Read only their status and session identity, never Items.
    const tradeIssues = new Map();
    for (const receipt of Object.values(run.tradeRequests ?? {})) {
      if (["processing", "uncertain"].includes(receipt.status) && receipt.intent?.sessionId) tradeIssues.set(receipt.intent.sessionId, receipt.status);
    }
    for (const [kind, sessions] of [["dialogue", run.dialogueSessions], ["shop", run.shopSessions]]) {
      for (const session of Object.values(sessions ?? {})) {
        if (!session?.sessionId) continue;
        // Pending stock remains held even if its former state has ended.
        const pendingTrade = kind === "shop" && session.status === "pending";
        const interrupted = kind === "dialogue" && session.status === "interrupted" && session.expiresAt > now;
        if (!pendingTrade && session.runId !== run.runId) continue;
        if (!(kind === "shop" ? shopSessionIsLive(session, now) : dialogueSessionIsLive(session, now) || interrupted)) continue;
        if (!pendingTrade && Number.isFinite(session.expiresAt)) deadlines.push(session.expiresAt);
        const listeners = kind === "dialogue" ? (session.participants ?? []).filter(participant => participant.role === "listener" && participant.expiresAt > now) : [];
        for (const listener of listeners) if (Number.isFinite(listener.expiresAt)) deadlines.push(listener.expiresAt);
        const names = kind === "shop" ? shopNames : dialogueNames, assetId = kind === "shop" ? session.shopId : session.dialogueId;
        rows.push({ key: `${kind}:${session.sessionId}`, kind, name: names.get(assetId) || session.title || unavailable(),
          object: objectName(session.target) || unavailable(), actor: tokenName(session.actorTokenId) || unavailable(),
          user: userName(session.userId), group: groupName(run.groupId),
          listeners: listeners.map(participant => tokenName(participant.actorTokenId) || userName(participant.userId) || unavailable()).join(", "),
          status: interactionStatus(kind, session, tradeIssues.get(session.sessionId)),
          packet: { sceneId, groupId: run.groupId, runId: session.runId, target: session.target ? { ...session.target } : null,
            sessionId: session.sessionId, actorTokenId: session.actorTokenId, ...(kind === "shop" ? { shopId: assetId } : { dialogueId: assetId }) } });
      }
    }
  }
  return { rows, expiresAt: deadlines.length ? Math.min(...deadlines) : null };
}

function scriptRow(run, target, script, slot) {
  if (script?.enabled === false || !script?.steps?.length) return null;
  const progress = run.scriptStates?.[progressKey(target, script, slot)];
  const step = script.steps.find(entry => entry.id === progress?.stepId);
  return { script: script.name || slotName(slot), phase: slotName(slot), step: step ? `${step.id} · ${scriptActionLabel(step.kind)}` : "—",
    active: !["done", "stopped", "failed", "uncertain", "interrupted"].includes(progress?.status), status: progressStatus(progress, run) };
}

function groupScript(run, target, transition, routine) {
  if (!run?.runId) return null;
  if (transition?.enabled !== false && transition?.steps?.length
    && run.scriptStates?.[progressKey(target, transition, "transition")]?.status !== "done") return scriptRow(run, target, transition, "transition");
  return scriptRow(run, target, routine, "routine");
}

/** Match the executor's transition/routine precedence using its saved state
 * snapshot, never the draft or newly edited preparation. A command waiting for an
 * ignored block exposes that block's real step alongside the waiting command. */
export function directorExecutionRows({ bindings = [], groupId, run, manualRuns = [], commandRuns = [],
  objectName = () => "", sceneHalted = false, paused = false }) {
  if (!groupId) return [];
  const commands = new Map(commandRuns.filter(command => command.groupId === groupId).map(command => [keyOf(command.target), command]));
  const manuals = new Map(manualRuns.filter(manual => manual.groupId === groupId).map(manual => [keyOf(manual.target), manual]));
  const transitions = new Map((run?.state?.transitions ?? []).map(script => [keyOf(script.target), script]));
  const routines = new Map((run?.state?.scripts ?? []).map(script => [keyOf(script.target), script]));
  return bindings.filter(binding => binding.groupId === groupId).map(binding => {
    const target = { type: binding.type, id: binding.id }, key = keyOf(target), command = commands.get(key), manual = manuals.get(key);
    const name = objectName(target), disabled = binding.playerCharacter || run?.disabledObjects?.includes(key);
    let detail = manual ? scriptRow(manual, target, manual.script, "initial") : groupScript(run, target, transitions.get(key), routines.get(key));
    let commandLabel = "";
    if (command) {
      commandLabel = objectCommandName(command.config.id);
      if (command.pendingReplacement) commandLabel += ` · ${t("Затем", "Then")}: ${objectCommandName(command.pendingReplacement.config.id)}`;
      if (command.phase === "waiting") {
        detail = { ...(detail ?? { script: "—", step: "—" }), phase: t("Команда ждёт скрипт", "Command waiting for script"), status: t("Ожидает окончания скрипта", "Waiting for script completion") };
      } else {
        detail = scriptRow(command, target, command.script, command.scriptSlot) ?? { script: "—", step: "—",
          phase: command.phase === "core" ? t("Команда", "Command") : command.phase === "before" ? t("До команды", "Before command") : t("После команды", "After command"),
          active: true, status: t("Выполняется", "Running") };
      }
      if (command.interruption) detail.status = `${sourceName(command.interruption.source)} · ${t("Ожидает продолжения", "Waiting to resume")}`;
    }
    const result = { key, target, object: name || unavailable(), command: commandLabel,
      ...(detail ?? { script: "—", step: "—", phase: "—", status: run?.runId ? t("Нет скрипта", "No script") : t("Не запущен", "Not started") }) };
    if (!name) result.status = unavailable();
    else if (disabled && !command) result.status = binding.playerCharacter ? t("Персонаж игрока", "Player character") : t("Автоматизация выключена", "Automation disabled");
    else if (!manual && (sceneHalted || run?.halted)) result.status = t("Остановлен", "Stopped");
    else if (paused && detail?.active && !command?.interruption) result.status = t("Пауза Foundry", "Foundry paused");
    return result;
  });
}
