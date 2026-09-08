export const MODULE_ID = "dmicher-master-screen";
export const VERSION = "0.0.1";
export const DEFAULT_SCHEME_ID = "main";
export const normalizeColor = (value, fallback = "#36404A") => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : fallback;
export const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const clone = (value) => structuredClone(value);
const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 2000) => String(value ?? "").slice(0, max);
const number = (value, fallback = 0, min = -1000000, max = 1000000) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function normalizeTags(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map((entry) => text(entry, 64).trim().toLowerCase()).filter(Boolean))].slice(0, 100);
}

export function normalizeTrigger(value = {}) {
  return { enabled: value.enabled !== false,
    schemeIds: [...new Set(list(value.schemeIds).map((id) => text(id, 64)).filter(Boolean))].slice(0, 100),
    episodeIds: [...new Set(list(value.episodeIds).map((id) => text(id, 64)).filter(Boolean))].slice(0, 100),
    allowTags: normalizeTags(value.allowTags), denyTags: normalizeTags(value.denyTags),
    repeat: value.repeat === "always" ? "always" : "limited",
    limit: Math.floor(number(value.limit, 1, 1, 1000000)), resetOnEntry: value.resetOnEntry !== false };
}

export function normalizeObjectTags(value) {
  return Object.fromEntries(["Token", "Tile"].map((type) => [type, Object.fromEntries(
    Object.entries(value?.[type] ?? {}).filter(([id]) => /^[a-zA-Z0-9_-]+$/.test(id)).slice(0, 2000)
      .map(([id, tags]) => [id, normalizeTags(tags)])
  )]));
}

export function defaultTokenBehavior() {
  return { enabled: true, emoji: "", position: null, hidden: null,
    speech: { interval: 30, phrases: [], range: 30, visibleOnly: true }, entrySpeech: "",
    shop: { enabled: false, range: 5, requireGMApproval: true, display: "list", items: [], trigger: normalizeTrigger() },
    patrol: { enabled: false, speed: 5, points: [] }, interaction: { label: "", targetEpisodeId: "", trigger: normalizeTrigger() } };
}

export function defaultEpisode(name = "Новый эпизод", id = randomId()) {
  return { id, name, background: "#36404A", textColor: "#FFFFFF", events: [], allowFromAll: true, from: [], stop: false, pause: false, sound: "",
    spawns: [], tokens: {}, zones: [], dialogues: [], interactions: [], subscriptions: [], workspace: { gm: [], players: [] } };
}

function uniqueId(value, ids, label) {
  const id = text(value || randomId(), 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(`${label}: требуется уникальный идентификатор`);
  ids.add(id);
  return id;
}

export function normalizeDialogue(raw = {}, ids = new Set()) {
  const id = uniqueId(raw.id, ids, "Диалог"), nodeIds = new Set();
  if (raw.target?.type && !["Token", "Tile"].includes(raw.target.type)) throw new Error("Диалог привязывается к токену или тайлу");
  const nodes = list(raw.nodes).slice(0, 100).map((node) => {
    const responseIds = new Set();
    return { id: uniqueId(node.id, nodeIds, "Страница диалога"), text: text(node.text, 12000), art: text(node.art, 1024),
      responses: list(node.responses).slice(0, 30).map((response) => ({
        id: uniqueId(response.id, responseIds, "Ответ"), label: text(response.label, 200),
        nextNodeId: text(response.nextNodeId, 64), eventName: text(response.eventName, 100).trim()
      })) };
  });
  const startNodeId = text(raw.startNodeId || nodes[0]?.id, 64);
  if (nodes.length && !nodeIds.has(startNodeId)) throw new Error("Начальная страница диалога отсутствует");
  for (const node of nodes) for (const response of node.responses) {
    if (response.nextNodeId && !nodeIds.has(response.nextNodeId)) throw new Error("Ответ ссылается на отсутствующую страницу диалога");
    if (response.eventName && response.nextNodeId) throw new Error("Ответ продолжает разговор либо завершает его с событием");
  }
  return { id, name: text(raw.name, 100).trim() || "Диалог", enabled: raw.enabled !== false,
    target: { type: raw.target?.type === "Tile" ? "Tile" : "Token", id: text(raw.target?.id, 64) },
    range: number(raw.range, 5, 0, 100000), startNodeId, nodes, trigger: normalizeTrigger(raw.trigger) };
}

function normalizeSubscriptions(entries) {
  const ids = new Set();
  return list(entries).slice(0, 100).map((entry) => {
    if (entry.kind && !["macro", "transition", "chat"].includes(entry.kind)) throw new Error("Подписка выполняет макрос, переход эпизода или сообщение в чат");
    return { id: uniqueId(entry.id, ids, "Подписка"), enabled: entry.enabled !== false,
      event: text(entry.event, 100).trim(), kind: ["transition", "chat"].includes(entry.kind) ? entry.kind : "macro",
      macroUuid: text(entry.macroUuid, 256), episodeId: text(entry.episodeId, 64), text: text(entry.text, 12000),
      audience: { gms: entry.audience?.gms !== false, interactor: entry.audience?.interactor === true,
        nearby: entry.audience?.nearby === true, range: number(entry.audience?.range, 30, 0, 100000),
        visibleOnly: entry.audience?.visibleOnly !== false } };
  });
}

function normalizeInteractions(entries) {
  const ids = new Set();
  return list(entries).slice(0, 100).map((entry) => {
    if (entry.target?.type && !["Token", "Tile"].includes(entry.target.type)) throw new Error("Взаимодействие привязывается к токену или тайлу");
    return { id: uniqueId(entry.id, ids, "Взаимодействие"), name: text(entry.name, 100).trim() || "Взаимодействовать",
      enabled: entry.enabled !== false, target: { type: entry.target?.type === "Tile" ? "Tile" : "Token", id: text(entry.target?.id, 64) },
      range: number(entry.range, 5, 0, 100000), eventName: text(entry.eventName, 100).trim(), trigger: normalizeTrigger(entry.trigger) };
  });
}

export function defaultDefinition() {
  const episodes = [defaultEpisode("Спокойствие", "calm"), defaultEpisode("Напряжение", "tension"),
    defaultEpisode("Тревога", "alarm"), { ...defaultEpisode("Остановка", "stop"), stop: true }];
  return { schemaVersion: 1, schemeId: DEFAULT_SCHEME_ID, schemeName: "Основная схема", background: "#36404A", textColor: "#FFFFFF", order: 0, revision: 0, episodes };
}

export function normalizeTokenBehavior(value = {}) {
  const base = defaultTokenBehavior();
  return { enabled: value.enabled !== false, emoji: text(value.emoji, 32),
    position: value.position ? { x: number(value.position.x), y: number(value.position.y) } : null,
    hidden: typeof value.hidden === "boolean" ? value.hidden : null,
    speech: { interval: number(value.speech?.interval, 30, 1, 86400),
      phrases: list(value.speech?.phrases).map((phrase) => text(phrase)).filter(Boolean).slice(0, 100),
      range: number(value.speech?.range, 30, 0, 100000), visibleOnly: value.speech?.visibleOnly !== false },
    entrySpeech: text(value.entrySpeech),
    shop: { enabled: value.shop?.enabled === true, range: number(value.shop?.range, 5, 0, 100000),
      trigger: normalizeTrigger(value.shop?.trigger),
      requireGMApproval: value.shop?.requireGMApproval !== false, display: value.shop?.display === "tiles" ? "tiles" : "list",
      items: list(value.shop?.items).slice(0, 200).map((entry) => ({
        id: text(entry.id || randomId(), 64), data: clone(entry.data ?? {}),
        stock: Math.floor(number(entry.stock, 1, 0, 10000))
      })) },
    patrol: { enabled: value.patrol?.enabled === true, speed: number(value.patrol?.speed, 5, 0.1, 1000),
      points: list(value.patrol?.points).slice(0, 200).map((point) => ({
        x: number(point.x), y: number(point.y), macroUuid: text(point.macroUuid, 256), onTrue: text(point.onTrue, 64), eventName: text(point.eventName, 100)
      })) },
    interaction: { ...base.interaction, label: text(value.interaction?.label, 80), targetEpisodeId: text(value.interaction?.targetEpisodeId, 64), eventName: text(value.interaction?.eventName, 100), trigger: normalizeTrigger(value.interaction?.trigger) } };
}

export function normalizeDefinition(value) {
  if (!value) return defaultDefinition();
  if (value.schemaVersion !== 1) throw new Error("Неподдерживаемая версия определения Ширмы");
  if (value.schemeId && !/^[a-zA-Z0-9_-]+$/.test(value.schemeId)) throw new Error("Некорректный идентификатор схемы");
  if (!Array.isArray(value.episodes) || value.episodes.length > 100) throw new Error("Допустимо до 100 эпизодов");
  const ids = new Set();
  const episodes = value.episodes.map((raw) => {
    const id = text(raw.id || randomId(), 64);
    if (ids.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Идентификаторы эпизодов должны быть уникальными");
    ids.add(id);
    const windows = (entries) => list(entries).slice(0, 30).map((entry) => ({
      uuid: text(entry.uuid, 256), x: number(entry.x), y: number(entry.y),
      width: number(entry.width, 500, 150, 4000), height: number(entry.height, 450, 100, 4000)
    })).filter((entry) => entry.uuid);
    return { id, name: text(raw.name, 100).trim() || "Эпизод", background: normalizeColor(raw.background), textColor: normalizeColor(raw.textColor, "#FFFFFF"),
      events: [...new Set(list(raw.events).map((entry) => text(entry, 100).trim()).filter(Boolean))], allowFromAll: raw.allowFromAll !== false,
      from: [...new Set(list(raw.from).map((entry) => text(entry, 64)))], stop: raw.stop === true,
      pause: raw.pause === true, sound: text(raw.sound, 1024),
      spawns: list(raw.spawns).slice(0, 50).map((spawn) => ({ id: text(spawn.id || randomId(), 64),
        actorUuid: text(spawn.actorUuid, 256), x: number(spawn.x), y: number(spawn.y),
        count: Math.floor(number(spawn.count, 1, 1, 50)), spacing: number(spawn.spacing, 1, 0, 1000) })),
      tokens: Object.fromEntries(Object.entries(raw.tokens ?? {}).slice(0, 500).map(([tokenId, behavior]) => {
        if (!/^[a-zA-Z0-9_-]+$/.test(tokenId)) throw new Error("Некорректный ID токена");
        return [tokenId, normalizeTokenBehavior(behavior)];
      })),
      zones: list(raw.zones).slice(0, 100).map((zone) => ({ id: text(zone.id || randomId(), 64), label: text(zone.label, 80),
        x: number(zone.x), y: number(zone.y), width: number(zone.width, 100, 1), height: number(zone.height, 100, 1),
        targetEpisodeId: text(zone.targetEpisodeId, 64), eventName: text(zone.eventName, 100), trigger: normalizeTrigger(zone.trigger) })),
      dialogues: (() => { const ids = new Set(); return list(raw.dialogues).slice(0, 100).map((dialogue) => normalizeDialogue(dialogue, ids)); })(),
      interactions: normalizeInteractions(raw.interactions),
      subscriptions: normalizeSubscriptions(raw.subscriptions),
      workspace: { gm: windows(raw.workspace?.gm), players: windows(raw.workspace?.players) } };
  });
  // Older definitions stored a direct target on a trigger. Give that specific source
  // an explicit event route; general entered/interacted events stay independent.
  const bindLegacyRoute = (source, targetId, name) => {
    if (!targetId) return;
    source.eventName ||= name;
    const target = episodes.find((entry) => entry.id === targetId);
    if (target && !target.events.includes(source.eventName)) target.events.push(source.eventName);
  };
  for (const episode of episodes) {
    for (const subscription of episode.subscriptions) if (subscription.kind === "transition" && subscription.episodeId && subscription.event) {
      const target = episodes.find((entry) => entry.id === subscription.episodeId);
      if (target && !target.events.includes(subscription.event)) target.events.push(subscription.event);
    }
    for (const zone of episode.zones) bindLegacyRoute(zone, zone.targetEpisodeId, `zone.${episode.id}.${zone.id}`);
    for (const [tokenId, behavior] of Object.entries(episode.tokens)) {
      bindLegacyRoute(behavior.interaction, behavior.interaction.targetEpisodeId, `npc.${episode.id}.${tokenId}`);
      behavior.patrol.points.forEach((point, index) => bindLegacyRoute(point, point.onTrue, `patrol.${episode.id}.${tokenId}.${index}`));
    }
  }
  const names = new Set(), routes = new Map();
  for (const episode of episodes) {
    const name = episode.name.toLocaleLowerCase();
    if (names.has(name)) throw new Error("Названия эпизодов внутри схемы должны быть уникальными");
    names.add(name);
    for (const event of episode.events) {
      if (routes.has(event)) throw new Error(`Событие «${event}» ведёт в несколько эпизодов одной схемы`);
      routes.set(event, episode.id);
    }
  }
  for (const episode of episodes) {
    episode.from = episode.from.filter((id) => ids.has(id) && id !== episode.id);
    const references = [...episode.zones.map((zone) => zone.targetEpisodeId),
      ...episode.subscriptions.filter((subscription) => subscription.kind === "transition").map((subscription) => subscription.episodeId),
      ...Object.values(episode.tokens).flatMap((token) => [token.interaction.targetEpisodeId, ...token.patrol.points.map((point) => point.onTrue)])];
    if (references.some((id) => id && !ids.has(id))) throw new Error("Переход ссылается на отсутствующий эпизод");
  }
  return { schemaVersion: 1, schemeId: value.schemeId || DEFAULT_SCHEME_ID, schemeName: text(value.schemeName, 100).trim() || "Основная схема",
    background: normalizeColor(value.background), textColor: normalizeColor(value.textColor, "#FFFFFF"), order: number(value.order, 0, 0, 10000),
    revision: Math.floor(number(value.revision, 0, 0, Number.MAX_SAFE_INTEGER)), episodes };
}

export const getEpisode = (definition, id) => definition?.episodes?.find((episode) => episode.id === id) ?? null;
export function canTransition(definition, fromId, toId) {
  const target = getEpisode(definition, toId);
  return Boolean(target && (!fromId || target.stop || target.allowFromAll || target.from.includes(fromId)));
}

/** Each line uses names or IDs: Calm -> Tension; * -> Alarm. No executable text. */
export function parseTransitions(source, episodes) {
  const result = clone(episodes);
  for (const episode of result) { episode.allowFromAll = false; episode.from = []; }
  const resolve = (name) => {
    const matches = result.filter((episode) => episode.id === name || episode.name === name);
    if (matches.length !== 1) throw new Error(`Неоднозначный или отсутствующий эпизод: ${name}`);
    return matches[0];
  };
  for (const [index, raw] of String(source).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("->").map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => !part)) throw new Error(`Строка ${index + 1}: ожидается «Источник -> Цель»`);
    const from = parts[0] === "*" ? result : [resolve(parts[0])];
    const targets = parts[1] === "*" ? result : [resolve(parts[1])];
    for (const target of targets) {
      if (parts[0] === "*") target.allowFromAll = true;
      else target.from = [...new Set([...target.from, ...from.filter((entry) => entry.id !== target.id).map((entry) => entry.id)])];
    }
  }
  return result;
}
export function transitionsText(definition) {
  // IDs stay unambiguous even when display names contain arrows or match another ID.
  return definition.episodes.flatMap((episode) => episode.allowFromAll ? [`* -> ${episode.id}`]
    : episode.from.map((from) => `${from} -> ${episode.id}`)).join("\n");
}

export function emptyRuntime(schemeId = DEFAULT_SCHEME_ID) {
  return { schemaVersion: 1, schemeId, episodeId: null, runId: "", enteredAt: 0, definitionRevision: 0,
    halted: false, haltedAt: 0,
    disabledTokens: [], episode: null, effects: {}, speech: {}, patrol: {}, shops: {}, shopSessions: {}, tradeRequests: {},
    dialogueSessions: {}, dialogueCommands: {}, eventLog: [], eventClaims: {}, triggerCounts: {}, triggerEnabledOverrides: {}, error: "" };
}
export function normalizeRuntime(value) {
  if (!value) return emptyRuntime();
  if (value.schemaVersion !== 1) throw new Error("Неподдерживаемое состояние Ширмы");
  if (value.schemeId && !/^[a-zA-Z0-9_-]+$/.test(value.schemeId)) throw new Error("Некорректный идентификатор схемы");
  return { ...emptyRuntime(), ...clone(value), disabledTokens: [...new Set(list(value.disabledTokens))] };
}
