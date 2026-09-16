/** One short-lived timer per message channel; no poller or chat-history scan. */
export class TechnicalMessageCleanup {
  constructor({ current, onError = () => {}, delay = 2000, now = Date.now,
    schedule = (callback, ms) => globalThis.setTimeout(callback, ms), cancel = handle => globalThis.clearTimeout(handle) }) {
    Object.assign(this, { current, onError, delay, now, schedule, cancel });
    this.entries = new Map(); this.timer = null; this.disposed = false;
  }
  queue(message) {
    if (this.disposed || !message?.id || typeof message.delete !== "function" || this.entries.has(message.id)) return;
    this.entries.set(message.id, { message, at: this.now() + this.delay });
    this.arm();
  }
  arm() {
    if (this.disposed || this.timer !== null || !this.entries.size) return;
    const delay = Math.max(0, Math.min(...[...this.entries.values()].map(entry => entry.at)) - this.now());
    this.timer = this.schedule(() => {
      this.timer = null;
      for (const [id, entry] of this.entries) if (entry.at <= this.now()) {
        this.entries.delete(id);
        if (this.current()) void Promise.resolve().then(() => entry.message.delete()).catch(error => this.onError(error, id));
      }
      this.arm();
    }, delay);
    this.timer?.unref?.();
  }
  dispose() { this.disposed = true; this.cancel(this.timer); this.timer = null; this.entries.clear(); }
}
