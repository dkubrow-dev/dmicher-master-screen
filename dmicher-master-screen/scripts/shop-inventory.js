import { MODULE_ID } from "./model.js";
import { requireGM, withSceneLock, isAuthority } from "./store.js";
import { normalizeShopItems } from "./interaction-model.js";
import { replacementFlagData, writeSceneFlags } from "./scene-flags.js";
import { notifyExecutionChange } from "./execution.js";
import { text } from "./localization.js";

const clone = value => structuredClone(value);
const flag = (scene, name) => scene?.getFlag?.(MODULE_ID, name);
const asset = (scene, shopId) => flag(scene, "interactionCatalog")?.shops?.find(shop => shop.id === shopId);
const revision = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export const hasShopInventory = (scene, shopId) => Object.hasOwn(flag(scene, "shopInventories") ?? {}, shopId);
export function requireShopInventoryAuthority() {
  requireGM();
  if (!isAuthority()) throw new Error(text("Текущие товары меняет исполняющий мастер, чтобы не прервать незавершённый обмен. Обратитесь к нему.", "Only the GM running automation can change current stock without interrupting an exchange. Ask that GM to make this change."));
}

/** Current stock is a complete snapshot, including an intentionally empty list.
 * Old runtime snapshots are read only when canonical stock has never been stored.
 * Reading or opening an editor never initializes data in the world. */
export function getShopInventory(scene, shopId, { initialItems } = {}) {
  const stored = flag(scene, "shopInventories")?.[shopId];
  const prior = stored ?? Object.values(flag(scene, "groupRuntimes") ?? {})
    .filter(state => state.shops?.[shopId])
    .sort((a, b) => Number(b.enteredAt ?? 0) - Number(a.enteredAt ?? 0))[0]?.shops?.[shopId];
  return { items: clone(prior?.items ?? initialItems ?? asset(scene, shopId)?.items ?? []), revision: revision(prior?.revision) };
}

function cancelUnfinishedTrades(scene, shopId) {
  const previous = flag(scene, "groupRuntimes") ?? {}, next = clone(previous);
  let changed = false;
  for (const runtime of Object.values(next)) {
    if (runtime.shopSessions?.[shopId]) { delete runtime.shopSessions[shopId]; changed = true; }
    for (const receipt of Object.values(runtime.tradeRequests ?? {})) {
      if (receipt.intent?.shopId !== shopId || !["pending", "validating"].includes(receipt.status)) continue;
      receipt.status = "rejected";
      receipt.error = text("Мастер изменил текущие товары магазина. Подготовьте новую сделку.", "The GM changed the shop's current stock. Prepare a new trade.");
      changed = true;
    }
  }
  return changed ? { groupRuntimes: replacementFlagData(previous, next) } : {};
}

/** Caller owns the scene lock. Preparation contains no callbacks or document
 * writes, so it can join a catalog save or the final phase of an exchange. */
export function prepareShopInventoryChange(scene, shopId, items, {
  expectedRevision, initialItems, cancelTrades = true, incrementRevision = true
} = {}) {
  const previous = getShopInventory(scene, shopId, { initialItems });
  if (expectedRevision !== undefined && expectedRevision !== previous.revision)
    throw new Error(text("Текущие товары магазина изменились. Обновите их перед сохранением.", "The shop's current stock changed. Reload it before saving."));
  const inventory = { items: normalizeShopItems(items), revision: previous.revision + (incrementRevision ? 1 : 0) };
  const inventories = flag(scene, "shopInventories") ?? {};
  const fields = { shopInventories: replacementFlagData(inventories, { ...inventories, [shopId]: inventory }),
    ...(cancelTrades ? cancelUnfinishedTrades(scene, shopId) : {}) };
  return { inventory, fields };
}

/** Resets wait behind an executing exchange, cancel pending admission/approval,
 * and retain completed or uncertain receipts without undoing character Items. */
export async function resetShopInventory(scene, shopId, { expectedRevision, isCurrent = () => true } = {}) {
  return withSceneLock(scene, async () => {
    requireShopInventoryAuthority();
    if (!isCurrent()) return { stale: true };
    const shop = asset(scene, shopId);
    if (!shop) throw new Error(text("Магазин больше не существует.", "The shop no longer exists."));
    const { inventory, fields } = prepareShopInventoryChange(scene, shopId, shop.items ?? [], { expectedRevision });
    if (!isCurrent()) return { stale: true };
    await writeSceneFlags(scene, fields);
    notifyExecutionChange(scene, "shop-inventory");
    return isCurrent() ? clone(inventory) : { stale: true };
  });
}
