/** A client-only outline follows the real canvas viewport, including dock resizing. */
export class ConstructorIndicator {
  sync(active) {
    const document = globalThis.document, board = document?.getElementById?.("board");
    if (!active || !board) return this.dispose();
    if (this.board === board && this.element?.isConnected) return this.position();
    this.dispose();
    this.board = board;
    this.element = document.createElement("div");
    this.element.className = "ms-constructor-indicator";
    this.element.setAttribute("aria-hidden", "true");
    document.body.append(this.element);
    const View = document.defaultView;
    if (View.ResizeObserver) { this.observer = new View.ResizeObserver(() => this.position()); this.observer.observe(board); }
    this.resize = () => this.position();
    this.view = View; View.addEventListener("resize", this.resize);
    this.position();
  }
  position() {
    if (!this.element || !this.board) return;
    const rect = this.board.getBoundingClientRect();
    Object.assign(this.element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  dispose() {
    this.observer?.disconnect(); this.view?.removeEventListener("resize", this.resize);
    this.element?.remove(); this.element = this.board = this.observer = this.view = this.resize = null;
  }
}
