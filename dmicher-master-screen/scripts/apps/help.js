import { text as t } from "../localization.js";
import { themedClasses } from "../ui.js";
import { generics } from "../generics.js";
import { getScreenHelpContent } from "../help-content.js";

export const HelpApplication = generics.help.createHelpApplication({
  id: "dmicher-master-screen-help", classes: themedClasses("ms-help"),
  title: () => t("Справка · Ширма мастера", "Help · Master screen"),
  getContent: getScreenHelpContent, initialPageId: "start"
});
