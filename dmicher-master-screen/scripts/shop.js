import { message as localizedMessage, text } from "./localization.js";
import { shopSessionIsLive } from "./interaction-session-model.js";
import { MODULE_ID } from "./model.js";
import { getDefinitions, getRuntime, getRuntimes, saveRuntime, withSceneLock, isAuthority, asArray } from "./store.js";
import { getObjectBindings, resolveObjectShop } from "./scene-objects.js";
import { getInteractionCatalog } from "./scene-assets.js";
import { objectDescriptor, objectKey, sceneObject, validateObjectAccess } from "./interaction-access.js";
import { generics } from "./generics.js";
import { createShopSessions, requireShopSession, shopKey } from "./shop-sessions.js";
import { interactionSignal, notifyInteractionSignal, deniedMessage } from "./interaction-signals.js";
import { isSceneObjectType } from "./scene-object-types.js";
export { shopKey } from "./shop-sessions.js";

const copy = (value) => structuredClone(value);
const id = () => globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();
const fail = (message) => { throw new Error(message); };
const escape = (text) => generics.utilities.escapeHTML(String(text ?? ""));

/** One transferable lot is a whole Item document. Quantities and currencies remain opaque. */
export function itemTransferData(item) {
  const data = copy(typeof item?.toObject === "function" ? item.toObject() : item);
  if (!data || typeof data.name !== "string" || typeof data.type !== "string") fail(localizedMessage("Нужен предмет Foundry."));
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  return data;
}
export async function importShopEntry(uuid, { stock = 1 } = {}) {
  if (!game.user?.isGM) fail(localizedMessage("Настройка магазина доступна мастеру."));
  const item = await fromUuid(String(uuid));
  if (item?.documentName !== "Item") fail(localizedMessage("Перенесите предмет из каталога или листа персонажа."));
  if (!Number.isInteger(Number(stock)) || Number(stock) < 0 || Number(stock) > 9999) fail(localizedMessage("Остаток: целое число от 0 до 9999."));
  return { id: id(), data: itemTransferData(item), stock: Number(stock) };
}
export function getShopContext(sceneId, source, groupId = "main", selectedShopId) {
  const scene = game.scenes?.get(sceneId), runtime = scene ? getRuntime(scene, { groupId }) : null;
  const target = objectDescriptor(source), resolved = scene && runtime && selectedShopId ? resolveObjectShop(scene, target, { groupId, stateId: runtime.stateId }, selectedShopId) : null;
  const shopId = resolved?.asset.id, object = sceneObject(scene, target);
  const inventories = scene?.getFlag?.(MODULE_ID, "shopInventories");
  const inventory = shopId && (inventories?.[shopId]
    ?? getRuntimes(scene).filter((state) => state.shops?.[shopId])
      .sort((a, b) => b.enteredAt - a.enteredAt).map((state) => state.shops[shopId])[0]);
  if (runtime && inventory) { runtime.shops ??= {}; runtime.shops[shopId] = copy(inventory); }
  return { scene, runtime, object, target, shopId, asset: resolved?.asset,
    behavior: resolved ? { enabled: !runtime.disabledObjects?.includes(objectKey(target)), shop: resolved.config } : null };
}
async function saveInventory(current, inventory) {
  if (!current.scene.setFlag) return;
  const values = current.scene.getFlag?.(MODULE_ID, "shopInventories") ?? {};
  values[shopKey(current)] = copy(inventory);
  await current.scene.setFlag(MODULE_ID, "shopInventories", values);
}
/** Catalog stock seeds new lot IDs. Existing lots, including deposits from players,
 * are world facts; preparation edits never replenish or delete them implicitly. */
export function shopEntries(context) {
  const entries = copy(context.runtime?.shops?.[shopKey(context)]?.items ?? []);
  for (const entry of context.behavior?.shop?.items ?? []) if (!entries.some((current) => current.id === entry.id)) entries.push(copy(entry));
  return entries;
}
export function validateTradeContext(context, intent, user) {
  const { scene, runtime, object, behavior } = context;
  if ((intent.groupId ?? "main") !== (runtime?.groupId ?? "main")) fail(localizedMessage("Запрос относится к другой группе магазина."));
  if (!intent.shopId || intent.shopId !== shopKey(context)) fail(localizedMessage("Назначение магазина изменилось. Откройте взаимодействие заново."));
  if (context.target && objectKey(intent.target ?? intent.tokenId) !== objectKey(context.target)) fail(localizedMessage("Объект магазина изменился."));
  if (!behavior?.enabled || !behavior.shop?.enabled) fail(localizedMessage("Этот магазин сейчас недоступен."));
  const descriptor = { ...behavior.shop, id: object?.id, target: context.target ?? { type: "Token", id: object?.id } };
  return validateObjectAccess({ scene, runtime, descriptor, target: object, conditionType: "shop" }, intent.actorTokenId, user, intent.runId).actor;
}
export function normalizeExchange(intent) {
  const string = (value) => {
    if (typeof value !== "string" || !value.length || value.length > 128) fail(localizedMessage("Некорректный идентификатор обмена."));
    return value;
  };
  if (intent?.kind !== "exchange" || !Array.isArray(intent.giveItemIds) || !Array.isArray(intent.take)
    || intent.giveItemIds.length > 100 || intent.take.length > 100) fail(localizedMessage("Нужен единый список обмена, не более 100 предметов с каждой стороны."));
  const giveItemIds = [...new Set(intent.giveItemIds.map(string))];
  if (giveItemIds.length !== intent.giveItemIds.length) fail(localizedMessage("Предмет персонажа повторяется в предложении."));
  const take = intent.take.map((entry) => {
    if (!Number.isInteger(entry?.count) || entry.count < 1 || entry.count > 100) fail(localizedMessage("Количество: целое число от 1 до 100."));
    return { entryId: string(entry.entryId), count: entry.count };
  });
  if (new Set(take.map((entry) => entry.entryId)).size !== take.length || take.reduce((sum, entry) => sum + entry.count, 0) > 100) fail(localizedMessage("Предметы магазина повторяются или превышен предел количества."));
  if (!giveItemIds.length && !take.length) fail(localizedMessage("Предложение обмена пусто."));
  const target = objectDescriptor(intent.target ?? intent.tokenId);
  if (!isSceneObjectType(target?.type)) fail(localizedMessage("Неизвестный тип объекта магазина."));
  const tokenId = string(target.id);
  return { kind: "exchange", requestId: string(intent.requestId), sceneId: string(intent.sceneId), tokenId,
    target: { type: target.type, id: tokenId }, shopId: string(intent.shopId),
    actorTokenId: string(intent.actorTokenId), sessionId: string(intent.sessionId), groupId: string(intent.groupId ?? "main"), runId: string(intent.runId), giveItemIds, take };
}
function prepare(current, intent, user, validate) {
  const actor = validate(current, intent, user), entries = shopEntries(current);
  const sources = intent.giveItemIds.map((itemId) => actor.items.get(itemId) ?? fail(localizedMessage("Один из предложенных предметов уже отсутствует у персонажа.")));
  const takes = intent.take.map(({ entryId, count }) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || !Number.isInteger(entry.stock) || entry.stock < count) fail(localizedMessage("В магазине уже недостаточно одного из выбранных предметов."));
    return { entry, count };
  });
  return { actor, entries, sources, takes };
}
function trim(receipts) {
  const finished = Object.entries(receipts).filter(([, record]) => ["done", "failed", "rejected"].includes(record.status));
  for (const [key] of finished.slice(0, Math.max(0, finished.length - 100))) delete receipts[key];
}

/** One elected GM serializes changes. Pending/processing receipts are never automatically replayed. */
export function createShopService({ emitSignal, onChange = () => {}, context = getShopContext, save = saveRuntime,
  lock = withSceneLock, authority = isAuthority, validate = validateTradeContext } = {}) {
  const submitted = new Map(), sent = new Map(), decisions = new Map();
  const chat = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "commerce-requests" });
  const sessions = createShopSessions({ context, save, lock, authority, validate, chat, onChange, emitSignal,
    validateOffer: (current, draft, user) => {
      if (Array.isArray(draft.giveItemIds) && Array.isArray(draft.take) && !draft.giveItemIds.length && !draft.take.length) return { giveItemIds: [], take: [] };
      const clean = normalizeExchange(draft);
      prepare(current, clean, user, validate);
      return { giveItemIds: clean.giveItemIds, take: clean.take };
    } });
  const receiptKey = (userId, intent) => `${userId}:${intent.requestId}`;
  const publish = async (message, receipt) => {
    if (!message?.update) return;
    const labels = { pending: localizedMessage("Предложение ожидает решения мастера."), validating: localizedMessage("Проверяются условия покупки."), processing: localizedMessage("Обмен выполняется."), done: localizedMessage("Обмен выполнен."),
      rejected: localizedMessage("Предложение отклонено."), failed: localizedMessage("Обмен отменён."), uncertain: localizedMessage("Нужна сверка мастером; автоматическое повторение запрещено.") };
    let content = `<section class="ms-trade-card"><p>${escape(labels[receipt.status] ?? receipt.status)}</p>`;
    if (receipt.summary) content += `<p>${text("Персонаж отдаёт", "Character gives")}: ${escape(receipt.summary.give || localizedMessage("ничего"))}.<br>${text("Получает", "Receives")}: ${escape(receipt.summary.take || localizedMessage("ничего"))}.</p>`;
    if (receipt.error) content += `<p>${escape(receipt.error)}</p>`;
    if (receipt.status === "pending") content += `<div data-ms-gm-trade>${generics.chat.renderActionButton({ id: "approve-exchange", label: localizedMessage("Подтвердить обмен") })}${generics.chat.renderActionButton({ id: "reject-exchange", label: localizedMessage("Отклонить") })}</div>`;
    await message.update({ content: `${content}</section>`, [`flags.${MODULE_ID}.tradeResult`]: receipt.status });
  };
  const execute = async (current, intent, user, key, receipt) => {
    if (!authority()) fail(localizedMessage("Исполняющий мастер изменился. Откройте взаимодействие заново."));
    requireShopSession(current, intent, user);
    const { actor, entries, sources, takes } = prepare(current, intent, user, validate);
    const sourceSnapshots = sources.map((source) => ({ id: source.id, data: source.toObject(),
      fingerprint: JSON.stringify(itemTransferData(source)) }));
    const checkSources = () => {
      for (const source of sourceSnapshots) {
        const item = actor.items.get(source.id);
        if (!item || JSON.stringify(itemTransferData(item)) !== source.fingerprint) fail(localizedMessage("Один из исходных предметов изменён другим действием. Подготовьте предложение заново."));
      }
    };
    const runtime = copy(current.runtime);
    runtime.tradeRequests ??= {};
    receipt = { ...copy(receipt), status: "processing", actorId: actor.id, at: Date.now(), effectId: id(), createdItemIds: [], givenItemIds: sources.map((source) => source.id) };
    runtime.tradeRequests[key] = receipt;
    runtime.shopSessions[shopKey(current)].status = "pending";
    trim(runtime.tradeRequests);
    await save(current.scene, runtime);
    const oldShop = copy(runtime.shops?.[shopKey(current)] ?? null), created = [];
    let creationUncertain = false, deletionStarted = false;
    try {
      for (const { entry, count } of takes) {
        for (let index = 0; index < count; index++) {
          if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
          validate(context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), intent, user);
          const data = itemTransferData(entry.data);
          data.flags ??= {};
          data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], exchange: { key, effectId: receipt.effectId, index: created.length } };
          let documents;
          try { documents = await actor.createEmbeddedDocuments("Item", [data]); }
          catch (error) { creationUncertain = true; throw error; }
          const item = documents?.[0];
          if (!item?.id) { creationUncertain = true; fail(localizedMessage("Система не создала предмет поддерживаемого типа.")); }
          created.push(item.id);
          receipt.createdItemIds = [...created];
        }
        entry.stock -= count;
      }
      for (const source of sourceSnapshots) entries.push({ id: id(), data: itemTransferData(source.data), stock: 1 });
      validate(context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), intent, user);
      checkSources();
      runtime.shops ??= {};
      runtime.shops[shopKey(current)] = { items: entries };
      await save(current.scene, runtime);
      if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
      validate(context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), intent, user);
      if (sources.length) {
        // Foundry does not offer a cross-document transaction. Recheck immediately before
        // our delete so a concurrent sheet edit is preserved and the exchange is rolled back.
        checkSources();
        deletionStarted = true;
        await actor.deleteEmbeddedDocuments("Item", sources.map((source) => source.id));
        if (sources.some((source) => actor.items.has(source.id))) fail(localizedMessage("Система не удалила часть исходных предметов."));
      }
      validate(context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), intent, user);
      await saveInventory(current, runtime.shops[shopKey(current)]);
      receipt.status = "done";
      delete runtime.shopSessions[shopKey(current)];
      await save(current.scene, runtime);
      onChange(current.scene);
      return copy(receipt);
    } catch (error) {
      const rollbackErrors = [];
      const marked = asArray(actor.items).filter((item) => {
        const marker = item.getFlag?.(MODULE_ID, "exchange") ?? item.flags?.[MODULE_ID]?.exchange;
        return marker?.key === key && marker.effectId === receipt.effectId;
      }).map((item) => item.id);
      const createdIds = [...new Set([...created, ...marked])];
      if (createdIds.length) {
        try { await actor.deleteEmbeddedDocuments("Item", createdIds);
          if (createdIds.some((itemId) => actor.items.has(itemId))) fail(localizedMessage("Полученные предметы остались у персонажа.")); }
        catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      }
      const missingSources = deletionStarted ? sourceSnapshots.filter((source) => !actor.items.has(source.id)) : [];
      if (missingSources.length) {
        try { await actor.createEmbeddedDocuments("Item", missingSources.map((source) => copy(source.data)), { keepId: true });
          if (missingSources.some((source) => !actor.items.has(source.id))) fail(localizedMessage("Часть исходных предметов не восстановлена.")); }
        catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      }
      if (!rollbackErrors.length && !creationUncertain) {
        if (oldShop) runtime.shops[shopKey(current)] = oldShop;
        else if (runtime.shops) delete runtime.shops[shopKey(current)];
        if (oldShop && current.scene.setFlag) {
          try { await saveInventory(current, oldShop); }
          catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
        }
      }
      receipt.status = rollbackErrors.length || creationUncertain ? "uncertain" : "failed";
      if (receipt.status === "failed") delete runtime.shopSessions[shopKey(current)];
      else runtime.shopSessions[shopKey(current)] = { ...copy(current.runtime.shopSessions[shopKey(current)]), status: "pending" };
      receipt.error = String(error.message ?? error);
      receipt.createdItemIds = createdIds;
      if (rollbackErrors.length) receipt.rollbackErrors = rollbackErrors;
      try { await save(current.scene, runtime); } catch { receipt.status = "uncertain"; }
      onChange(current.scene);
      return copy(receipt);
    }
  };
  const completeApproval = async (scene, intent, user, key, session) => {
    // Subscriber macros may read/write this scene. Await them outside the inventory
    // lock, then rebuild the exchange from current stock and documents under it.
    let outcome;
    try { outcome = await notifyInteractionSignal(emitSignal, scene, interactionSignal(scene, "Shop", intent.shopId, session, "beforePurchase", { suffix: `${intent.requestId}.beforePurchase`, validation: true })); }
    catch (error) { outcome = { allowed: false, error: error.message }; }
    const result = await lock(scene, async () => {
      if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
      const current = context(intent.sceneId, intent.target, intent.groupId, intent.shopId), receipt = current.runtime.tradeRequests?.[key];
      if (!receipt || receipt.status !== "validating") return copy(receipt ?? { status: "failed", error: localizedMessage("Состояние обмена изменилось во время проверки.") });
      try {
        if (outcome?.allowed !== true || ["failed", "stale"].includes(outcome?.status)) fail(deniedMessage(outcome, outcome?.error ?? localizedMessage("Подписчик не разрешил покупку.")));
        requireShopSession(current, intent, user);
        prepare(current, intent, user, validate);
        return await execute(current, intent, user, key, receipt);
      } catch (error) {
        const runtime = copy(current.runtime);
        runtime.tradeRequests[key] = { ...receipt, status: "failed", error: error.message };
        if (runtime.shopSessions?.[intent.shopId]?.sessionId === intent.sessionId) runtime.shopSessions[intent.shopId].status = "editing";
        await save(scene, runtime); globalThis.ui?.notifications?.error(error.message);
        return copy(runtime.tradeRequests[key]);
      }
    });
    if (result.status === "done") {
      await notifyInteractionSignal(emitSignal, scene, interactionSignal(scene, "Shop", intent.shopId, session, "purchased", { suffix: `${intent.requestId}.purchased` }));
      await notifyInteractionSignal(emitSignal, scene, interactionSignal(scene, "Shop", intent.shopId, session, "closed"));
    }
    onChange(scene); return result;
  };
  const receive = async (intent, user, message = null) => {
    intent = normalizeExchange(intent);
    const initial = context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId);
    if (!initial.scene) fail(localizedMessage("Сцена магазина не найдена."));
    const staged = await lock(initial.scene, async () => {
      if (!authority()) fail(localizedMessage("Исполняющий мастер изменился."));
      const current = context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), key = receiptKey(user.id, intent);
      const previous = current.runtime.tradeRequests?.[key];
      if (previous) return copy(previous);
      const plan = prepare(current, intent, user, validate);
      const session = requireShopSession(current, intent, user);
      intent = { ...intent, ...(current.shopId ? { shopId: current.shopId, target: copy(current.target) } : {}) };
      if (session.status !== "editing") fail(localizedMessage("Предыдущее предложение этой сессии ещё не завершено."));
      const receipt = { status: "pending", userId: user.id, messageId: message?.id ?? null, intent,
        summary: { give: plan.sources.map((item) => item.name).join(", "), take: plan.takes.map(({ entry, count }) => `${entry.data.name} × ${count}`).join(", ") } };
      const approvalRequired = current.behavior.shop.requireGMApproval !== false && !user.isGM;
      const runtime = copy(current.runtime); runtime.tradeRequests ??= {};
      if (Object.values(runtime.tradeRequests).filter((item) => item.status === "pending" && item.userId === user.id).length >= 10) fail(localizedMessage("Сначала дождитесь решения мастера по предыдущим предложениям."));
      receipt.status = approvalRequired ? "pending" : "validating";
      runtime.tradeRequests[key] = receipt;
      runtime.shopSessions[shopKey(current)].status = "pending";
      runtime.shopSessions[shopKey(current)].draft = { giveItemIds: copy(intent.giveItemIds), take: copy(intent.take) };
      await save(current.scene, runtime); onChange(current.scene);
      return approvalRequired ? copy(receipt) : { receipt: copy(receipt), session: copy(session), key };
    });
    return staged.receipt ? completeApproval(initial.scene, intent, user, staged.key, staged.session) : staged;
  };
  const decideOnce = async (messageId, approved) => {
    if (!authority() || !game.user?.isGM) fail(localizedMessage("Решение доступно ведущему мастеру."));
    const message = game.messages.get(messageId), claimed = message?.getFlag?.(MODULE_ID, "trade");
    if (!claimed) fail(localizedMessage("Запрос обмена не найден."));
    const authorId = typeof message.author === "string" ? message.author : message.author?.id;
    const initial = context(claimed.sceneId, claimed.target ?? claimed.tokenId, claimed.groupId ?? "main", claimed.shopId);
    if (!initial.scene) fail(localizedMessage("Сцена обмена не найдена."));
    let closed;
    const staged = await lock(initial.scene, async () => {
      const current = context(claimed.sceneId, claimed.target ?? claimed.tokenId, claimed.groupId ?? "main", claimed.shopId), key = receiptKey(authorId, claimed);
      const receipt = current.runtime.tradeRequests?.[key];
      if (!receipt || receipt.userId !== authorId || receipt.messageId !== messageId) fail(localizedMessage("Нет подтверждённого сервером запроса обмена для этого сообщения."));
      if (receipt.status !== "pending") return copy(receipt);
      const persistedShopId = receipt.intent.shopId ?? shopKey(current);
      if (!approved) {
        const runtime = copy(current.runtime); runtime.tradeRequests[key].status = "rejected";
        if (runtime.shopSessions?.[persistedShopId]?.sessionId === receipt.intent.sessionId) {
          closed = runtime.shopSessions[persistedShopId]; delete runtime.shopSessions[persistedShopId];
        }
        await save(current.scene, runtime); onChange(current.scene);
        return copy(runtime.tradeRequests[key]);
      }
      const runtime = copy(current.runtime);
      runtime.tradeRequests[key].status = "validating";
      const session = copy(runtime.shopSessions?.[persistedShopId]);
      await save(current.scene, runtime);
      return { receipt: copy(runtime.tradeRequests[key]), session, key };
    });
    const result = staged.receipt ? await completeApproval(initial.scene, staged.receipt.intent, game.users.get(staged.receipt.userId), staged.key, staged.session) : staged;
    if (closed) await notifyInteractionSignal(emitSignal, initial.scene, interactionSignal(initial.scene, "Shop", closed.shopId, closed, "closed"));
    await publish(message, result);
    return result;
  };
  const decide = (messageId, approved) => {
    if (decisions.has(messageId)) return decisions.get(messageId);
    const task = decideOnce(messageId, approved).finally(() => decisions.delete(messageId));
    decisions.set(messageId, task); return task;
  };
  return Object.freeze({
    ...sessions,
    listSceneShops(scene) {
      if (!scene) return [];
      const definitions = getDefinitions(scene), states = getRuntimes(scene), bindings = Object.values(getObjectBindings(scene).bindings);
      return getInteractionCatalog(scene).shops.map((asset) => {
        const owners = bindings.filter((binding) => binding.shops?.some((reference) => reference.shopId === asset.id));
        const occupiedState = states.find((state) => shopSessionIsLive(state.shopSessions?.[asset.id]));
        const fallbackState = states.find((state) => state.shopSessions?.[asset.id]);
        const source = occupiedState ?? fallbackState;
        const session = source?.shopSessions?.[asset.id];
        const availableOwner = owners.find((owner) => {
          const runtime = states.find((state) => state.groupId === owner.groupId);
          return runtime?.runId && !runtime.halted && !runtime.state?.stop
            && resolveObjectShop(scene, owner, { groupId: owner.groupId, stateId: runtime.stateId }, asset.id);
        });
        const owner = owners.find((owner) => objectKey(owner) === objectKey(session?.target)) ?? availableOwner ?? owners[0];
        const target = session?.target ?? (owner ? { type: owner.type, id: owner.id } : null);
        const groupId = source?.groupId ?? owner?.groupId;
        const receipts = states.flatMap((state) => Object.values(state.tradeRequests ?? {}).filter((receipt) => receipt.intent?.shopId === asset.id));
        return { shopId: asset.id, tokenId: target?.id ?? asset.id, target, groupId,
          groupName: definitions.find((entry) => entry.groupId === groupId)?.groupName ?? "",
          npcName: asset.name, img: asset.img || sceneObject(scene, target)?.texture?.src, enabled: Boolean(availableOwner),
          sources: owners.map((binding) => ({ type: binding.type, id: binding.id, name: sceneObject(scene, binding)?.name ?? binding.id })),
          session: session ? { ...copy(session), id: session.sessionId, userName: game.users.get(session.userId)?.name,
            actorName: scene.tokens.get(session.actorTokenId)?.name, expired: !shopSessionIsLive(session) } : null,
          pending: receipts.filter((receipt) => receipt.status === "pending").map((receipt) => ({ ...copy(receipt), requestId: receipt.intent.requestId })),
          issues: receipts.filter((receipt) => ["processing", "uncertain"].includes(receipt.status)).map(copy) };
      });
    },
    getContext: context, approveTrade: (messageId) => decide(messageId, true), rejectTrade: (messageId) => decide(messageId, false),
    async requestTrade(rawIntent) {
      const intent = normalizeExchange(rawIntent), key = receiptKey(game.user.id, intent);
      if (submitted.has(key)) return submitted.get(key);
      if (sent.has(key)) return game.messages.get(sent.get(key)) ?? { status: "pending" };
      const task = (async () => {
        if (authority() && game.user.isGM) return receive(intent, game.user);
        validate(context(intent.sceneId, intent.target ?? intent.tokenId, intent.groupId ?? "main", intent.shopId), intent, game.user);
        const gms = asArray(game.users).filter((user) => user.active && Number(user.role) === 4).map((user) => user.id);
        if (!gms.length) fail(localizedMessage("Для обмена нужен подключённый мастер."));
        const messages = await chat.create({ author: game.user.id, content: `<p>${text("Ширма: предложение обмена отправлено мастеру.", "Master screen: trade offer submitted to the GM.")}</p>`,
          flags: { [MODULE_ID]: { trade: intent } } }, { audience: { type: "users", userIds: [...new Set([...gms, game.user.id])] }, kind: "trade-request", technical: true });
        if (!messages[0]) fail(localizedMessage("Запрос не отправлен."));
        sent.set(key, messages[0].id); return messages[0];
      })();
      submitted.set(key, task);
      try { return await task; } finally { submitted.delete(key); }
    },
    async processTradeRequest(message, initiatingUserId) {
      if (!authority()) return null;
      if (await sessions.processCommand(message, initiatingUserId)) return null;
      const source = message.getFlag?.(MODULE_ID, "trade");
      if (!source || !message.id) return null;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      if (!initiatingUserId || authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return null;
      const user = game.users.get(initiatingUserId);
      if (!user) return null;
      let result;
      try { result = await receive(copy(source), user, message); }
      catch (error) { result = { status: "rejected", error: error.message }; }
      await publish(message, result); return result;
    },
    renderChatMessage(message, html) {
      if (!message.getFlag?.(MODULE_ID, "trade")) return;
      const root = generics.windows.getRenderedElement(html);
      if (!root) return;
      const controls = root.querySelector("[data-ms-gm-trade]");
      if (controls) controls.hidden = !authority();
      return generics.chat.bindActions({ moduleId: MODULE_ID, message, root, key: "exchange-approval", actions: [
        { selector: '[data-dmicher-chat-action="approve-exchange"]', authorize: () => authority() && game.user.isGM, handle: ({ message: latest }) => decide(latest.id, true) },
        { selector: '[data-dmicher-chat-action="reject-exchange"]', authorize: () => authority() && game.user.isGM, handle: ({ message: latest }) => decide(latest.id, false) }
      ], onError: (error) => ui.notifications.error(error.message) });
    }
  });
}
