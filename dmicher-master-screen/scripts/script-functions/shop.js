import { text as t } from "../localization.js";
import { requireText, bool } from "./parameters.js";

export async function execute({ engine, job, scene, object, target, runId, script, p: parameters, admitted: current, executionCurrent }) {
  const { getRuntime } = await import("../store.js");
  const runtime = engine.runtime;
  const scriptKey = job.progressKey;
  const fail = message => { throw new Error(message); };
  const waitUntilAdmitted = active => engine.waitUntilAdmitted(job, active, executionCurrent);
  if (!current()) return {};
  if (!runtime.startScriptShop) fail(t("Исполнение магазина скрипта не подключено.", "Script shop execution is not connected."));
  const active = runtime.scriptState(scene, runId);
  if (active?.manual && !active.purpose) fail(t("Для магазина скрипта запустите состояние группы.", "Start a group state to use a scripted shop."));
  const shopRunId = active?.command ? active.parentRunId : active?.manual ? getRuntime(scene, { groupId: job.groupId }).runId : runId;
  const isCurrent = (started = []) => {
    const turn = runtime.combat?.context?.(scene, object);
    return executionCurrent() && !globalThis.game?.paused
      && runtime.currentObject(scene, runId, target, { scriptKey, excludeShopSessions: started })
      && (!turn || script.combat.enabled && turn.isTurn);
  };
  const reference = await runtime.startScriptShop({
    sceneId: scene.id,
    groupId: job.groupId,
    runId: shopRunId,
    target,
    shopId: parameters.shopId,
    tokenUuid: parameters.tokenUuid
  }, {
    isCurrent,
    waitForAdmission: started => waitUntilAdmitted(() => isCurrent(started))
  });
  return { shopSessions: reference ? [reference] : [] };
}

export default Object.freeze({
  id: "shop", label: {"ru":"Магазин","en":"Shop"},
  description: {"ru":"Открывает выбранный магазин для персонажа и при необходимости ожидает завершения торговли.","en":"Opens the selected shop for a character and optionally waits for the trade to finish."},
  category: {"ru":"объекты.взаимодействие","en":"objects.interaction"},
  scopes: ["object"], premium: false,
  objectTypes: ["Token", "Tile", "Drawing", "Region"],
  template: {"shopId":"","tokenUuid":"","wait":true},
  normalize: p => ({
    shopId: requireText(p.shopId ?? "", 64, t("Магазин", "Shop")),
    tokenUuid: requireText(p.tokenUuid ?? "", 2048, t("UUID персонажа", "Character UUID")),
    wait: bool(p.wait, true, t("Дождаться завершения", "Wait for completion"))
  }),
  execute
});
