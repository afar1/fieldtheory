// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceRunnerTelemetry } from './voiceRunnerTelemetry';
const dirs: string[] = [];
const runners: VoiceRunnerTelemetry[] = [];
afterEach(() => { runners.forEach(r => r.stop()); dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })); vi.useRealTimers(); });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-telemetry-')); dirs.push(directory);
  let owner: string | null = 'a'; let online = true;
  const report = vi.fn(async (_args: Record<string, unknown>) => ({ ok: true }));
  const options = { directory, identity: () => owner ? { owner, workerId: owner + '-worker' } : null,
    online: () => online, report };
  const runner = new VoiceRunnerTelemetry(options); runners.push(runner);
  return { runner, options, report, directory, setOwner: (value: string | null) => { owner = value; }, setOnline: (value: boolean) => { online = value; } };
}
it('reports unknown initial lock state then observed lock and sleep timestamps without power changes', async () => {
  const h = harness(); h.runner.start(); await settle();
  expect(h.report.mock.calls[0][0]).toMatchObject({ p_event: 'heartbeat', p_locked: null, p_sleeping: null, p_online: true });
  h.runner.record('lock'); h.runner.record('sleep'); await settle();
  expect(h.report.mock.calls.at(-1)?.[0]).toMatchObject({ p_event: 'sleep', p_locked: true, p_sleeping: true });
  h.runner.record('wake'); h.runner.record('unlock'); await settle();
  expect(h.report.mock.calls.at(-1)?.[0]).toMatchObject({ p_event: 'unlock', p_locked: false, p_sleeping: false });
});
it('retries persisted events with the original timestamp and identity after restart', async () => {
  const h = harness(); h.report.mockRejectedValue(new Error('unavailable')); h.runner.record('lock'); await settle();
  const saved = JSON.parse(fs.readFileSync(path.join(h.directory, 'a.json'), 'utf8'))[0];
  h.report.mockResolvedValue({ ok: true }); const replacement = new VoiceRunnerTelemetry(h.options); runners.push(replacement);
  replacement.start(); await settle();
  expect(h.report.mock.calls.at(-2)?.[0]).toMatchObject({ p_event_id: saved.eventId, p_occurred_at: saved.occurredAt, p_event: 'lock' });
});
it('bounds the offline outbox, coalesces heartbeats, and never sends another account events', async () => {
  const h = harness(); h.report.mockRejectedValue(new Error('no migration')); h.runner.start(); await settle();
  for (let i = 0; i < 300; i++) h.runner.record(i % 2 ? 'lock' : 'unlock');
  await settle();
  expect(JSON.parse(fs.readFileSync(path.join(h.directory, 'a.json'), 'utf8')).length).toBe(256);
  h.setOwner('b'); h.report.mockClear(); h.report.mockResolvedValue({ ok: true }); h.runner.refresh(); await settle();
  expect(h.report.mock.calls.every(([args]) => args.p_worker_id === 'b-worker')).toBe(true);
  h.setOwner(null); h.report.mockClear(); h.runner.record('lock'); h.runner.refresh(); await settle(); expect(h.report).not.toHaveBeenCalled();
});
it('samples network transitions on the heartbeat without claiming remote reachability', async () => {
  vi.useFakeTimers(); const h = harness(); h.runner.start(); await settle(); h.setOnline(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(h.report.mock.calls.at(-1)?.[0]).toMatchObject({ p_event: 'network', p_online: false });
});
