import { text } from "../localization.js";
import { generics } from "../generics.js";
import { EMOJI_GROUPS } from "./emoji-catalog.js";

export const EMOJI_COLUMNS = generics.components.UNICODE_PICKER_COLUMNS;

export function emojiPickerOptions(language) {
  const localized = value => text(value.ru, value.en, language);
  return {
    labels: {
      dialog: text("Выбрать эмоцию", "Choose emotion", language),
      groups: text("Группы символов", "Symbol groups", language)
    },
    groups: EMOJI_GROUPS.map(group => ({
      id: group.id,
      icon: group.icon,
      label: localized(group.label),
      items: group.items.map(item => ({ symbol: item.symbol, label: localized(item) }))
    }))
  };
}

/** Screen owns the curated catalog; Generics owns picker behavior and layout. */
export function openEmojiPicker(anchor, options = {}) {
  return generics.components.openUnicodePicker(anchor, { ...emojiPickerOptions(options.language), ...options });
}
