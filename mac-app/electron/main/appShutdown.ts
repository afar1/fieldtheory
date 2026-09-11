export interface ShutdownTask {
  name: string;
  run: () => void | Promise<unknown>;
}

export interface ShutdownEvent {
  name: string;
  status: 'started' | 'completed' | 'failed' | 'timed-out';
  elapsedMs: number;
  error?: string;
}

export class AppShutdown {
  private pending: Promise<void> | null = null;
  complete = false;

  constructor(
    private readonly tasks: ShutdownTask[],
    private readonly report: (event: ShutdownEvent) => void,
    private readonly timeoutMs = 5_000,
  ) {}

  get started(): boolean { return this.pending !== null; }

  run(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(async () => {
      await Promise.all(this.tasks.map(task => this.runTask(task)));
      this.complete = true;
    });
    return this.pending;
  }

  private reportSafely(event: ShutdownEvent): void {
    try { this.report(event); } catch { /* Logging must not interrupt cleanup. */ }
  }

  private runTask(task: ShutdownTask): Promise<void> {
    const startedAt = Date.now();
    this.reportSafely({ name: task.name, status: 'started', elapsedMs: 0 });
    return new Promise(resolve => {
      let settled = false;
      const finish = (status: ShutdownEvent['status'], error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.reportSafely({
          name: task.name,
          status,
          elapsedMs: Date.now() - startedAt,
          ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
        });
        resolve();
      };
      const timer = setTimeout(() => finish('timed-out'), this.timeoutMs);
      try {
        Promise.resolve(task.run()).then(() => finish('completed'), error => finish('failed', error));
      } catch (error) {
        finish('failed', error);
      }
    });
  }
}
