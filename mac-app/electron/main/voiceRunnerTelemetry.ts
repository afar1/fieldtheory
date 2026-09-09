import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
type State = { locked: boolean | null; sleeping: boolean | null; online: boolean | null };
type Event = 'heartbeat' | 'lock' | 'unlock' | 'sleep' | 'wake' | 'network' | 'connected' | 'disconnected';
type Entry = State & { event: Event; eventId: string; occurredAt: string; workerId: string };
export interface VoiceRunnerTelemetryOptions {
  directory: string;
  identity: () => { owner: string; workerId: string } | null;
  online: () => boolean;
  report: (args: Record<string, unknown>) => Promise<{ ok: boolean }>;
  now?: () => number;
}
/** Bounded account-scoped metadata only; never controls execution or power policy. */
export class VoiceRunnerTelemetry {
  private state: State = { locked: null, sleeping: null, online: null };
  private owner: string | null = null;
  private entries: Entry[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly options: VoiceRunnerTelemetryOptions) {}
  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  refresh(): void { this.tick(); }
  record(event: Exclude<Event, 'heartbeat' | 'network'>): void {
    if (event === 'lock' || event === 'unlock') this.state.locked = event === 'lock';
    if (event === 'sleep' || event === 'wake') this.state.sleeping = event === 'sleep';
    this.enqueue(event);
  }
  private tick(): void {
    const online = this.options.online();
    const changed = this.state.online !== null && this.state.online !== online;
    this.state.online = online;
    this.enqueue(changed ? 'network' : 'heartbeat');
  }
  private file(owner: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) throw new Error('Invalid account');
    return path.join(this.options.directory, `${owner}.json`);
  }
  private persist(): void {
    if (!this.owner) return;
    fs.mkdirSync(this.options.directory, { recursive: true, mode: 0o700 });
    const file = this.file(this.owner);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.entries), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  private enqueue(event: Event): void {
    try {
      const identity = this.options.identity();
      if (!identity) { this.owner = null; this.entries = []; return; }
      if (this.owner !== identity.owner) {
        this.owner = identity.owner;
        this.entries = [];
        try {
          const saved: unknown = JSON.parse(fs.readFileSync(this.file(identity.owner), 'utf8'));
          if (Array.isArray(saved)) this.entries = saved.filter((entry): entry is Entry =>
            entry && ['heartbeat', 'lock', 'unlock', 'sleep', 'wake', 'network', 'connected', 'disconnected'].includes(entry.event)
            && typeof entry.eventId === 'string' && typeof entry.workerId === 'string'
            && typeof entry.occurredAt === 'string' && Number.isFinite(Date.parse(entry.occurredAt))
            && ['locked', 'sleeping', 'online'].every(key => entry[key] === null || typeof entry[key] === 'boolean'))
            .map(({ event, eventId, workerId, occurredAt, locked, sleeping, online }) =>
              ({ event, eventId, workerId, occurredAt, locked, sleeping, online })).slice(-256);
        } catch { /* Missing telemetry never prevents work. */ }
      }
      if (event === 'heartbeat') this.entries = this.entries.filter(entry => entry.event !== 'heartbeat');
      this.entries.push({ ...this.state, event, eventId: randomUUID(), workerId: identity.workerId,
        occurredAt: new Date((this.options.now ?? Date.now)()).toISOString() });
      this.entries = this.entries.slice(-256);
      this.persist();
      void this.flush();
    } catch { /* Optional diagnostics never affect the runner. */ }
  }
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.entries.length) {
        const owner = this.owner;
        if (!owner || this.options.identity()?.owner !== owner) return;
        const entry = this.entries[0];
        const result = await this.options.report({ p_expected_owner: owner, p_worker_id: entry.workerId, p_event: entry.event,
          p_locked: entry.locked, p_sleeping: entry.sleeping, p_online: entry.online,
          p_occurred_at: entry.occurredAt, p_event_id: entry.eventId });
        if (this.owner !== owner || this.options.identity()?.owner !== owner || !result.ok) return;
        this.entries = this.entries.filter(value => value.eventId !== entry.eventId);
        this.persist();
      }
    } catch { /* Retry on the next heartbeat or lifecycle event. */ }
    finally { this.flushing = false; }
  }
}
