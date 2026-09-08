import { MODULE_ID } from "./model.js";
import { getDefinitions, getRuntime, saveRuntime, withSceneLock, isAuthority, asArray } from "./store.js";
import { sceneDistance, tokenCenter } from "./effects.js";
import { generics } from "./generics.js";
import { createShopSessions, requireShopSession, sessionIsLive } from "./shop-sessions.js";
import { getTriggerGate, getTriggerKey } from "./triggers.js";

const copy = (value) => structuredClone(value);
const id = () => globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();
const fail = (message) => { throw new Error(message); };
const escape = (text) => generics.utilities.escapeHTML(String(text ?? ""));

/** One transferable lot is a whole Item document. Quantities and currencies remain opaque. */
export function itemTransferData(item) {
  const data = copy(typeof item?.toObject === "function" ? item.toObject() : item);
  if (!data || typeof data.name !== "string" || typeof data.type !== "string") fail("Нужен предмет Foundry.");
  for (const key of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[key];
  return data;
}
export async function importShopEntry(uuid, { stock = 1 } = {}) {
  if (!game.user?.isGM) fail("Настройка магазина доступна мастеру.");
  const item = await fromUuid(String(uuid));
  if (item?.documentName !== "Item") fail("Перенесите предмет из каталога или листа персонажа.");
  if (!Number.isInteger(Number(stock)) || Number(stock) < 0 || Number(stock) > 9999) fail("Остаток: целое число от 0 до 9999.");
  return { id: id(), data: itemTransferData(item), stock: Number(stock) };
}
export function getShopContext(sceneId, tokenId, schemeId = "main") {
  const scene = game.scenes?.get(sceneId), runtime = scene ? getRuntime(scene, { schemeId }) : null;
  const inventory = scene?.getFlag?.(MODULE_ID, "shopInventories")?.[tokenId];
  if (runtime && inventory) { runtime.shops ??= {}; runtime.shops[tokenId] = copy(inventory); }
  return { scene, runtime, token: scene?.tokens?.get(tokenId), behavior: runtime?.episode?.tokens?.[tokenId] };
}
export function shopEntries(context) {
  const entries = copy(context.runtime?.shops?.[context.token?.id]?.items ?? []);
  for (const entry of context.behavior?.shop?.items ?? []) if (!entries.some((current) => current.id === entry.id)) entries.push(copy(entry));
  return entries;
}
export function validateTradeContext(context, intent, user) {
  const { scene, runtime, token, behavior } = context;
  if ((intent.schemeId ?? "main") !== (runtime?.schemeId ?? "main")) fail("Запрос относится к другой схеме магазина.");
  if (!scene || scene.id !== globalThis.canvas?.scene?.id) fail("Сцена магазина сейчас не открыта у ведущего мастера.");
  if (!user || !runtime?.runId || runtime.runId !== intent.runId) fail("Эпизод изменился. Откройте взаимодействие заново.");
  if (!token || token.hidden || runtime.halted || runtime.episode?.stop || !behavior?.enabled || !behavior.shop?.enabled || runtime.disabledTokens?.includes(token.id)) fail("Этот магазин сейчас недоступен.");
  const actorToken = scene.tokens.get(intent.actorTokenId);
  if (!actorToken?.actor || actorToken.id === token.id || actorToken.hidden
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail("Нужен ваш персонаж на этой сцене.");
  const origin = tokenCenter(actorToken, scene), destination = tokenCenter(token, scene);
  if (sceneDistance(scene, origin, destination) > Number(behavior.shop.range ?? 5)) fail("Персонаж слишком далеко от магазина.");
  if (!actorToken.object?.checkCollision || actorToken.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) fail("Магазин должен находиться в прямой видимости персонажа.");
  const gate = getTriggerGate(scene, runtime, behavior.shop.trigger, actorToken,
    { triggerKey: getTriggerKey(runtime, "shop", token.id), ignoreQuota: true });
  if (!gate.allowed) fail(gate.reason);
  return actorToken.actor;
}
export function normalizeExchange(intent) {
  const string = (value) => {
    if (typeof value !== "string" || !value.length || value.length > 128) fail("Некорректный идентификатор обмена.");
    return value;
  };
  if (intent?.kind !== "exchange" || !Array.isArray(intent.giveItemIds) || !Array.isArray(intent.take)
    || intent.giveItemIds.length > 100 || intent.take.length > 100) fail("Нужен единый список обмена, не более 100 предметов с каждой стороны.");
  const giveItemIds = [...new Set(intent.giveItemIds.map(string))];
  if (giveItemIds.length !== intent.giveItemIds.length) fail("Предмет персонажа повторяется в предложении.");
  const take = intent.take.map((entry) => {
    if (!Number.isInteger(entry?.count) || entry.count < 1 || entry.count > 100) fail("Количество: целое число от 1 до 100.");
    return { entryId: string(entry.entryId), count: entry.count };
  });
  if (new Set(take.map((entry) => entry.entryId)).size !== take.length || take.reduce((sum, entry) => sum + entry.count, 0) > 100) fail("Предметы магазина повторяются или превышен предел количества.");
  if (!giveItemIds.length && !take.length) fail("Предложение обмена пусто.");
  return { kind: "exchange", requestId: string(intent.requestId), sceneId: string(intent.sceneId), tokenId: string(intent.tokenId),
    actorTokenId: string(intent.actorTokenId), sessionId: string(intent.sessionId), schemeId: string(intent.schemeId ?? "main"), runId: string(intent.runId), giveItemIds, take };
}
function prepare(current, intent, user, validate) {
  const actor = validate(current, intent, user), entries = shopEntries(current);
  const sources = intent.giveItemIds.map((itemId) => actor.items.get(itemId) ?? fail("Один из предложенных предметов уже отсутствует у персонажа."));
  const takes = intent.take.map(({ entryId, count }) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || !Number.isInteger(entry.stock) || entry.stock < count) fail("В магазине уже недостаточно одного из выбранных предметов.");
    return { entry, count };
  });
  return { actor, entries, sources, takes };
}
function trim(receipts) {
  const finished = Object.entries(receipts).filter(([, record]) => ["done", "failed", "rejected"].includes(record.status));
  for (const [key] of finished.slice(0, Math.max(0, finished.length - 100))) delete receipts[key];
}

/** One elected GM serializes changes. Pending/processing receipts are never automatically replayed. */
export function createShopService({ onChange = () => {}, context = getShopContext, save = saveRuntime,
  lock = withSceneLock, authority = isAuthority, validate = validateTradeContext } = {}) {
  const submitted = new Map(), sent = new Map();
  const chat = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "commerce-requests" });
  const sessions = createShopSessions({ context, save, lock, authority, validate, chat, onChange,
    validateOffer: (current, draft, user) => {
      if (Array.isArray(draft.giveItemIds) && Array.isArray(draft.take) && !draft.giveItemIds.length && !draft.take.length) return { giveItemIds: [], take: [] };
      const clean = normalizeExchange(draft);
      prepare(current, clean, user, validate);
      return { giveItemIds: clean.giveItemIds, take: clean.take };
    } });
  const receiptKey = (userId, intent) => `${userId}:${intent.requestId}`;
  const publish = async (message, receipt) => {
    if (!message?.update) return;
    const labels = { pending: "Предложение ожидает решения мастера.", processing: "Обмен выполняется.", done: "Обмен выполнен.",
      rejected: "Предложение отклонено.", failed: "Обмен отменён.", uncertain: "Нужна сверка мастером; автоматическое повторение запрещено." };
    let content = `<section class="ms-trade-card"><p>${escape(labels[receipt.status] ?? receipt.status)}</p>`;
    if (receipt.summary) content += `<p>Персонаж отдаёт: ${escape(receipt.summary.give || "ничего")}.<br>Получает: ${escape(receipt.summary.take || "ничего")}.</p>`;
    if (receipt.error) content += `<p>${escape(receipt.error)}</p>`;
    if (receipt.status === "pending") content += `<div data-ms-gm-trade>${generics.chat.renderActionButton({ id: "approve-exchange", label: "Подтвердить обмен" })}${generics.chat.renderActionButton({ id: "reject-exchange", label: "Отклонить" })}</div>`;
    await message.update({ content: `${content}</section>`, [`flags.${MODULE_ID}.tradeResult`]: receipt.status });
  };
  const execute = async (current, intent, user, key, receipt) => {
    requireShopSession(current, intent, user);
    const { actor, entries, sources, takes } = prepare(current, intent, user, validate);
    const sourceSnapshots = sources.map((source) => ({ id: source.id, data: source.toObject(),
      fingerprint: JSON.stringify(itemTransferData(source)) }));
    const checkSources = () => {
      for (const source of sourceSnapshots) {
        const item = actor.items.get(source.id);
        if (!item || JSON.stringify(itemTransferData(item)) !== source.fingerprint) fail("Один из исходных предметов изменён другим действием. Подготовьте предложение заново.");
      }
    };
    const runtime = copy(current.runtime);
    runtime.tradeRequests ??= {};
    receipt = { ...copy(receipt), status: "processing", actorId: actor.id, at: Date.now(), effectId: id(), createdItemIds: [], givenItemIds: sources.map((source) => source.id) };
    runtime.tradeRequests[key] = receipt;
    runtime.shopSessions[intent.tokenId].status = "pending";
    trim(runtime.tradeRequests);
    await save(current.scene, runtime);
    const oldShop = copy(runtime.shops?.[intent.tokenId] ?? null), created = [];
    let creationUncertain = false, deletionStarted = false;
    try {
      for (const { entry, count } of takes) {
        for (let index = 0; index < count; index++) {
          const data = itemTransferData(entry.data);
          data.flags ??= {};
          data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], exchange: { key, effectId: receipt.effectId, index: created.length } };
          let documents;
          try { documents = await actor.createEmbeddedDocuments("Item", [data]); }
          catch (error) { creationUncertain = true; throw error; }
          const item = documents?.[0];
          if (!item?.id) { creationUncertain = true; fail("Система не создала предмет поддерживаемого типа."); }
          created.push(item.id);
          receipt.createdItemIds = [...created];
        }
        entry.stock -= count;
      }
      for (const source of sourceSnapshots) entries.push({ id: id(), data: itemTransferData(source.data), stock: 1 });
      validate(context(intent.sceneId, intent.tokenId, intent.schemeId ?? "main"), intent, user);
      checkSources();
      runtime.shops ??= {};
      runtime.shops[intent.tokenId] = { items: entries };
      await save(current.scene, runtime);
      if (sources.length) {
        // Foundry does not offer a cross-document transaction. Recheck immediately before
        // our delete so a concurrent sheet edit is preserved and the exchange is rolled back.
        checkSources();
        deletionStarted = true;
        await actor.deleteEmbeddedDocuments("Item", sources.map((source) => source.id));
        if (sources.some((source) => actor.items.has(source.id))) fail("Система не удалила часть исходных предметов.");
      }
      if (current.scene.setFlag) await current.scene.setFlag(MODULE_ID, `shopInventories.${intent.tokenId}`, copy(runtime.shops[intent.tokenId]));
      receipt.status = "done";
      delete runtime.shopSessions[intent.tokenId];
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
          if (createdIds.some((itemId) => actor.items.has(itemId))) fail("Полученные предметы остались у персонажа."); }
        catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      }
      const missingSources = deletionStarted ? sourceSnapshots.filter((source) => !actor.items.has(source.id)) : [];
      if (missingSources.length) {
        try { await actor.createEmbeddedDocuments("Item", missingSources.map((source) => copy(source.data)), { keepId: true });
          if (missingSources.some((source) => !actor.items.has(source.id))) fail("Часть исходных предметов не восстановлена."); }
        catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
      }
      if (!rollbackErrors.length && !creationUncertain) {
        if (oldShop) runtime.shops[intent.tokenId] = oldShop;
        else if (runtime.shops) delete runtime.shops[intent.tokenId];
        if (oldShop && current.scene.setFlag) {
          try { await current.scene.setFlag(MODULE_ID, `shopInventories.${intent.tokenId}`, oldShop); }
          catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
        }
      }
      receipt.status = rollbackErrors.length || creationUncertain ? "uncertain" : "failed";
      if (receipt.status === "failed") delete runtime.shopSessions[intent.tokenId];
      else runtime.shopSessions[intent.tokenId] = { ...copy(current.runtime.shopSessions[intent.tokenId]), status: "pending" };
      receipt.error = String(error.message ?? error);
      receipt.createdItemIds = createdIds;
      if (rollbackErrors.length) receipt.rollbackErrors = rollbackErrors;
      try { await save(current.scene, runtime); } catch { receipt.status = "uncertain"; }
      onChange(current.scene);
      return copy(receipt);
    }
  };
  const receive = async (intent, user, message = null) => {
    intent = normalizeExchange(intent);
    const initial = context(intent.sceneId, intent.tokenId, intent.schemeId ?? "main");
    if (!initial.scene) fail("Сцена магазина не найдена.");
    return lock(initial.scene, async () => {
      const current = context(intent.sceneId, intent.tokenId, intent.schemeId ?? "main"), key = receiptKey(user.id, intent);
      const previous = current.runtime.tradeRequests?.[key];
      if (previous) return copy(previous);
      const plan = prepare(current, intent, user, validate);
      const session = requireShopSession(current, intent, user);
      if (session.status !== "editing") fail("Предыдущее предложение этой сессии ещё не завершено.");
      const receipt = { status: "pending", userId: user.id, messageId: message?.id ?? null, intent,
        summary: { give: plan.sources.map((item) => item.name).join(", "), take: plan.takes.map(({ entry, count }) => `${entry.data.name} × ${count}`).join(", ") } };
      if (current.behavior.shop.requireGMApproval !== false && !user.isGM) {
        const runtime = copy(current.runtime); runtime.tradeRequests ??= {};
        if (Object.values(runtime.tradeRequests).filter((item) => item.status === "pending" && item.userId === user.id).length >= 10) fail("Сначала дождитесь решения мастера по предыдущим предложениям.");
        runtime.tradeRequests[key] = receipt;
        runtime.shopSessions[intent.tokenId].status = "pending";
        runtime.shopSessions[intent.tokenId].draft = { giveItemIds: copy(intent.giveItemIds), take: copy(intent.take) };
        await save(current.scene, runtime); onChange(current.scene);
        return copy(receipt);
      }
      return execute(current, intent, user, key, receipt);
    });
  };
  const decide = async (messageId, approved) => {
    if (!authority() || !game.user?.isGM) fail("Решение доступно ведущему мастеру.");
    const message = game.messages.get(messageId), claimed = message?.getFlag?.(MODULE_ID, "trade");
    if (!claimed) fail("Запрос обмена не найден.");
    const authorId = typeof message.author === "string" ? message.author : message.author?.id;
    const initial = context(claimed.sceneId, claimed.tokenId, claimed.schemeId ?? "main");
    if (!initial.scene) fail("Сцена обмена не найдена.");
    const result = await lock(initial.scene, async () => {
      const current = context(claimed.sceneId, claimed.tokenId, claimed.schemeId ?? "main"), key = receiptKey(authorId, claimed);
      const receipt = current.runtime.tradeRequests?.[key];
      if (!receipt || receipt.userId !== authorId || receipt.messageId !== messageId) fail("Нет подтверждённого сервером запроса обмена для этого сообщения.");
      if (receipt.status !== "pending") return copy(receipt);
      if (!approved) {
        const runtime = copy(current.runtime); runtime.tradeRequests[key].status = "rejected";
        if (runtime.shopSessions?.[receipt.intent.tokenId]?.sessionId === receipt.intent.sessionId) delete runtime.shopSessions[receipt.intent.tokenId];
        await save(current.scene, runtime); onChange(current.scene);
        return copy(runtime.tradeRequests[key]);
      }
      // Execute only the persisted authenticated intent, never flags edited after the request was accepted.
      try { return await execute(current, receipt.intent, game.users.get(receipt.userId), key, receipt); }
      catch (error) {
        const runtime = copy(current.runtime);
        runtime.tradeRequests[key] = { ...receipt, status: "failed", error: error.message };
        if (runtime.shopSessions?.[receipt.intent.tokenId]?.sessionId === receipt.intent.sessionId) delete runtime.shopSessions[receipt.intent.tokenId];
        await save(current.scene, runtime);
        return copy(runtime.tradeRequests[key]);
      }
    });
    await publish(message, result);
    return result;
  };
  return Object.freeze({
    ...sessions,
    listSceneShops(scene) {
      if (!scene) return [];
      return getDefinitions(scene).flatMap((definition) => {
      const runtime = getRuntime(scene, { schemeId: definition.schemeId });
      return asArray(scene?.tokens).flatMap((token) => {
        const behavior = runtime.episode?.tokens?.[token.id];
        const configuredEpisodes = definition.episodes.filter((episode) => episode.tokens?.[token.id]?.shop?.enabled);
        if (!behavior?.shop?.enabled && !configuredEpisodes.length) return [];
        const session = runtime.shopSessions?.[token.id];
        return [{ tokenId: token.id, schemeId: definition.schemeId, schemeName: definition.schemeName, npcName: token.name, img: token.texture?.src || token.actor?.img,
          enabled: Boolean(!runtime.episode?.stop && behavior?.enabled && behavior.shop?.enabled && !runtime.disabledTokens?.includes(token.id)),
          configuredEpisodes: configuredEpisodes.map((episode) => episode.name),
          session: session ? { ...copy(session), id: session.sessionId, userName: game.users.get(session.userId)?.name,
            actorName: scene.tokens.get(session.actorTokenId)?.name, expired: !sessionIsLive(session) } : null,
          pending: Object.values(runtime.tradeRequests ?? {}).filter((receipt) => receipt.status === "pending" && receipt.intent?.tokenId === token.id)
            .map((receipt) => ({ ...copy(receipt), requestId: receipt.intent.requestId })),
          issues: Object.values(runtime.tradeRequests ?? {}).filter((receipt) => ["processing", "uncertain"].includes(receipt.status) && receipt.intent?.tokenId === token.id)
            .map(copy) }];
      }); });
    },
    getContext: context, approveTrade: (messageId) => decide(messageId, true), rejectTrade: (messageId) => decide(messageId, false),
    async requestTrade(rawIntent) {
      const intent = normalizeExchange(rawIntent), key = receiptKey(game.user.id, intent);
      if (submitted.has(key)) return submitted.get(key);
      if (sent.has(key)) return game.messages.get(sent.get(key)) ?? { status: "pending" };
      const task = (async () => {
        if (authority() && game.user.isGM) return receive(intent, game.user);
        validate(context(intent.sceneId, intent.tokenId, intent.schemeId ?? "main"), intent, game.user);
        const gms = asArray(game.users).filter((user) => user.active && Number(user.role) === 4).map((user) => user.id);
        if (!gms.length) fail("Для обмена нужен подключённый мастер.");
        const messages = await chat.create({ author: game.user.id, content: "<p>Ширма: предложение обмена отправлено мастеру.</p>",
          flags: { [MODULE_ID]: { trade: intent } } }, { audience: { type: "users", userIds: [...new Set([...gms, game.user.id])] }, kind: "trade-request", technical: true });
        if (!messages[0]) fail("Запрос не отправлен.");
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
