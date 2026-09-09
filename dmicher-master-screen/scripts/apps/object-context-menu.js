import { themedClasses } from "../ui.js";

/** The same transient menu serves constructor tools and permitted player actions. */
export class ObjectContextMenu {
  open(items, { x = 0, y = 0 } = {}) {
    this.close();
    if (!items.length) return false;
    const document = globalThis.document, view = document.defaultView;
    this.previousFocus = document.activeElement;
    const menu = document.createElement("div");
    menu.className = themedClasses("ms-object-menu").join(" ");
    menu.setAttribute("role", "menu");
    const events = new view.AbortController(); this.events = events; this.element = menu;
    const options = { signal: events.signal };
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = item.label;
      button.addEventListener("click", () => {
        this.close();
        void Promise.resolve().then(item.action).catch((error) => {
          console.error("dmicher-master-screen | Context action", error);
          globalThis.ui?.notifications?.error(error.message);
        });
      }, options);
      menu.append(button);
    }
    menu.addEventListener("pointerdown", (event) => event.stopPropagation(), options);
    menu.addEventListener("keydown", (event) => {
      const buttons = [...menu.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[target]?.focus();
      }
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); this.close(); }
    }, options);
    document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) this.close(); }, options);
    view.addEventListener("resize", () => this.close(), options);
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, view.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, view.innerHeight - rect.height - 4))}px`;
    menu.querySelector("button")?.focus();
    return true;
  }
  close() {
    this.events?.abort(); this.element?.remove(); this.events = this.element = null;
    this.previousFocus?.focus?.({ preventScroll: true }); this.previousFocus = null;
  }
}
