/** Combine change notifications while keeping at most one refresh in flight. */
export class CoalescedRefresh {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private pending = false;

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 100,
  ) {}

  run(): Promise<void> {
    if (this.running) return this.running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    // Defer the callback so running is assigned before it can request another refresh.
    this.running = Promise.resolve().then(async () => {
      do {
        this.pending = false;
        try { await this.refresh(); } catch (error) { this.onError(error); }
      } while (this.pending);
    }).finally(() => {
      this.running = null;
      if (this.pending) this.schedule();
    });
    return this.running;
  }

  schedule(): void {
    this.pending = true;
    if (this.running) return;
    if (this.timer) return;
    this.timer = setTimeout(() => { void this.run(); }, this.delayMs);
  }

  cancelPending(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }
}
