/** Small, serializable presentation settings; independent of documents and UI. */
export const INTERACTIVE_TYPES = Object.freeze(["Token", "Tile", "Drawing", "Wall", "AmbientLight", "AmbientSound", "Region", "Note"]);
export const INTERACTION_WORLD_SETTING = "interactiveObjects";
export const INTERACTION_PLAYER_SETTING = "interactiveObjectsPlayer";
const frameDefaults = {
  Token: [true, "#388BFF"], Tile: [false, "#FFFFFF"], Drawing: [false, "#FFFFFF"],
  Wall: [true, "#FFFFFF"], AmbientLight: [true, "#FFDF38"], AmbientSound: [false, "#FFFFFF"],
  Region: [false, "#FFFFFF"], Note: [true, "#FF4242"]
};
const iconDefaults = {
  Token: [true, "🖐", "left", "top"], Wall: [true, "🔒", "left", "top"],
  AmbientLight: [true, "💡", "center", "center"]
};
export function defaultInteractionSettings() {
  return {
    highlight: { enabled: true, activation: "keys", keys: ["AltLeft"], frames: Object.fromEntries(INTERACTIVE_TYPES.map(type =>
      [type, { enabled: frameDefaults[type][0], color: frameDefaults[type][1], size: 2 }])) },
    icons: { enabled: false, types: Object.fromEntries(INTERACTIVE_TYPES.map(type => {
      const [enabled, symbol, horizontal, vertical] = iconDefaults[type] ?? [false, "✋", "left", "top"];
      return [type, { enabled, symbol, horizontal, vertical, color: "#FFFFFF", background: "#202830", size: 20 }];
    })) }
  };
}
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const bounded = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const color = (value, fallback) => /^#[a-f0-9]{6}$/i.test(value) ? value.toUpperCase() : fallback;
const symbol = (value, fallback) => {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return globalThis.Intl?.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(cleaned)][0]?.segment ?? fallback : [...cleaned][0] ?? fallback;
};
export function normalizeHighlightKeys(value, fallback = ["AltLeft"]) {
  const keys = Array.isArray(value) ? [...new Set(value.filter(key => typeof key === "string" && /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|(?:Alt|Control|Shift|Meta)(?:Left|Right)|Arrow(?:Up|Down|Left|Right)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(key)))] : [];
  return keys.length && keys.length <= 6 ? keys.sort() : [...fallback];
}
export function normalizeInteractionSettings(value = {}) {
  const result = defaultInteractionSettings(), input = value && typeof value === "object" ? value : {};
  result.highlight.enabled = bool(input.highlight?.enabled, true);
  result.highlight.activation = input.highlight?.activation === "always" ? "always" : "keys";
  result.highlight.keys = normalizeHighlightKeys(input.highlight?.keys);
  result.icons.enabled = bool(input.icons?.enabled, false);
  for (const type of INTERACTIVE_TYPES) {
    const frame = result.highlight.frames[type], source = input.highlight?.frames?.[type];
    frame.enabled = bool(source?.enabled, frame.enabled); frame.color = color(source?.color, frame.color); frame.size = bounded(source?.size, frame.size, 0.5, 30);
    const icon = result.icons.types[type], supplied = input.icons?.types?.[type];
    icon.enabled = bool(supplied?.enabled, icon.enabled); icon.symbol = symbol(supplied?.symbol, icon.symbol);
    icon.color = color(supplied?.color, icon.color); icon.background = color(supplied?.background, icon.background); icon.size = bounded(supplied?.size, icon.size, 8, 96);
    icon.horizontal = ["left", "center", "right"].includes(supplied?.horizontal) ? supplied.horizontal : icon.horizontal;
    icon.vertical = ["top", "center", "bottom"].includes(supplied?.vertical) ? supplied.vertical : icon.vertical;
  }
  return result;
}
export function normalizePlayerInteractionSettings(value = {}) {
  return { activation: ["keys", "always"].includes(value?.activation) ? value.activation : null,
    keys: value?.keys === null || value?.keys === undefined ? null : normalizeHighlightKeys(value.keys) };
}
export function effectiveInteractionSettings(world, player, { premium = false } = {}) {
  const result = normalizeInteractionSettings(world), personal = normalizePlayerInteractionSettings(player);
  if (personal.activation) result.highlight.activation = personal.activation;
  if (personal.keys) result.highlight.keys = personal.keys;
  if (!premium) { result.highlight.enabled = false; result.icons.enabled = false; }
  return result;
}
export const highlightChordMatches = (pressed, keys) => keys.length > 0 && pressed.size === keys.length && keys.every(key => pressed.has(key));
