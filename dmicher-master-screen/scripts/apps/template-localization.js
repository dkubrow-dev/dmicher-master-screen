import { text } from "../localization.js";

/** Only static operational copy is translated; normal Handlebars escaping remains active. */
export function registerTemplateLocalization(handlebars) {
  handlebars.registerHelper("dmicherScreenText", (ru, en) => text(ru, en));
}
