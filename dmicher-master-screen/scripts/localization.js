import { MESSAGE_TRANSLATIONS } from "./message-translations.js";

/** Language selection has no UI or Foundry service dependency; callers may supply it. */
export function languageCode(language = globalThis.game?.i18n?.lang ?? "ru") {
  return String(language).toLowerCase().startsWith("ru") ? "ru" : "en";
}

export const text = (ru, en, language) => languageCode(language) === "ru" ? ru : en;

/** Source-keyed diagnostics retain readable call sites and never execute names or values. */
export function message(source, values = [], language) {
  const template = languageCode(language) === "en" && Object.hasOwn(MESSAGE_TRANSLATIONS, source)
    ? MESSAGE_TRANSLATIONS[source] : source;
  return String(template).replace(/\{(\d+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
