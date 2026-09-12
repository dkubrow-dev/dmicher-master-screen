import { escapeScriptText } from "./script-text.js";
import { isAuthority } from "./store.js";

const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const uuid = (document, fallback) => document?.uuid ?? fallback;
const sceneOf = (combat) => typeof combat?.scene === "string" ? game.scenes?.get(combat.scene) : combat?.scene;
export function combatSupported() { return Boolean(globalThis.CONFIG?.Combat?.documentClass || globalThis.game?.combats); }

/** Uses only Foundry's native encounter/turn contract; it does not infer system actions,
 * initiative formulas, movement resources or the duration of a rules-system round. */
export function createCombatAdapter({ emitSignal, chat } = {}) {
  const hooks = [], snapshots = new Map();
  const informer = chat?.informer?.createMessageService({ ownerId: "dmicher-master-screen", channel: "script-combat" });
  const context = (scene, object) => {
    const combat = values(globalThis.game?.combats).find((entry) => sceneOf(entry)?.id === scene.id && entry.started && entry.active !== false);
    if (!combat) return null;
    return { combat, id: combat.id, turnKey: `${combat.id}:${combat.round}:${combat.turn}:${combat.combatant?.id ?? ""}`, isTurn: object.documentName === "Token" && combat.combatant?.tokenId === object.id };
  };
  const snapshot = (combat) => ({ started: Boolean(combat.started), round: combat.round, turn: combat.turn, actorUuid: combat.combatant?.actor?.uuid ?? combat.combatant?.token?.actor?.uuid ?? null });
  const send = async (combat, name, extra = {}) => {
    const scene = sceneOf(combat); if (!scene || !isAuthority() || !emitSignal) return;
    await emitSignal(scene, name, { sceneUuid: uuid(scene, `Scene.${scene.id}`), combatUuid: uuid(combat, `Combat.${combat.id}`), ...extra });
  };
  const changed = async (combat) => {
    const before = snapshots.get(combat.id) ?? { started: false, round: 0 }, after = snapshot(combat); snapshots.set(combat.id, after);
    const group = { groupUuid: null, groupName: null, stateUuid: null, stateName: null };
    if (!before.started && after.started) await send(combat, "combatStarted", group);
    if (before.started && !after.started) await send(combat, "combatEnded", group);
    if (after.started && before.round !== after.round) await send(combat, "roundStarted");
    if (after.started && before.actorUuid && after.actorUuid && (before.round !== after.round || before.turn !== after.turn || before.actorUuid !== after.actorUuid)) {
      await send(combat, "turnChanged", { previousActorUuid: before.actorUuid, currentActorUuid: after.actorUuid });
    }
  };
  const report = (error) => { console.error("dmicher-master-screen | combat", error); globalThis.ui?.notifications?.error(error.message ?? String(error)); };
  return {
    supported: combatSupported, context,
    activate() {
      if (hooks.length || !globalThis.Hooks) return;
      for (const combat of values(game.combats)) snapshots.set(combat.id, snapshot(combat));
      const on = (name, fn) => hooks.push([name, Hooks.on(name, fn)]);
      on("createCombat", (combat) => { snapshots.set(combat.id, { started: false, round: 0 }); void changed(combat).catch(report); });
      on("updateCombat", (combat) => { void changed(combat).catch(report); });
      on("deleteCombat", (combat) => { const prior = snapshots.get(combat.id); snapshots.delete(combat.id); if (prior?.started ?? combat.started) void send(combat, "combatEnded", { groupUuid: null, groupName: null, stateUuid: null, stateName: null }).catch(report); });
    },
    async notify(object, script, step, rounds, key) {
      const message = `${object.name ?? object.id}: ${script.name || "Скрипт"}, шаг ${step.id} (${step.kind}), ходов: ${rounds}.`;
      if (script.combat.notifyWarning) globalThis.ui?.notifications?.warn(message);
      if (script.combat.notifyChat) {
        if (!informer) throw new Error("Информатор Generics недоступен.");
        await informer.create({ content: `<p>${escapeScriptText(message)}</p>` }, { audience: { type: "gms" }, key, kind: "combat-action", technical: true });
      }
    },
    async confirmAction(object, script, step, rounds) {
      if (!script.combat.confirm) return "continue";
      const Dialog = globalThis.foundry?.applications?.api?.DialogV2;
      if (!Dialog?.wait) throw new Error("Диалог подтверждения Foundry недоступен.");
      return await Dialog.wait({ window: { title: `${object.name ?? object.id}: ${script.name || "Скрипт"}` },
        content: `<p>Шаг ${step.id}: ${escapeScriptText(step.kind)}. Ожидаемая длительность: ${rounds} ход(а).</p>`,
        buttons: [{ action: "continue", label: "Продолжить", default: true }, { action: "skip", label: "Пропустить" }, { action: "stop", label: "Остановить" }], close: () => "skip" }, { rejectClose: false }) ?? "skip";
    },
    async finishTurn(scene, object, expected) {
      const current = context(scene, object);
      if (current?.isTurn && current.turnKey === expected.turnKey && isAuthority()) await current.combat.nextTurn();
    },
    dispose() { for (const [name, id] of hooks) globalThis.Hooks?.off(name, id); hooks.length = 0; snapshots.clear(); }
  };
}
