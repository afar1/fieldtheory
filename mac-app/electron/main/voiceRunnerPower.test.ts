// @vitest-environment node
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceWorkState } from '../shared/voiceWork';
import { VoiceRunnerPower } from './voiceRunnerPower';

const ready: VoiceWorkState = {
  settings: { enabled: true, workspacePath: '/library' }, status: 'ready',
  codex: { available: true, signedIn: true },
};

function harness(onBattery = false) {
  const monitor = Object.assign(new EventEmitter(), { isOnBatteryPower: () => onBattery });
  const blocker = { start: vi.fn(() => 0), stop: vi.fn() };
  const power = new VoiceRunnerPower(monitor, blocker);
  return { power, monitor, blocker, setBattery(value: boolean) {
    onBattery = value;
    monitor.emit(value ? 'on-battery' : 'on-ac');
  } };
}

describe('Voice runner power', () => {
  it('holds one app-suspension assertion while listening, working, and locked', () => {
    const h = harness();
    h.power.update(ready);
    h.power.update({ ...ready, status: 'working' });
    h.monitor.emit('lock-screen');
    h.monitor.emit('unlock-screen');
    h.power.update({ ...ready, status: 'connecting' });
    h.power.update({ ...ready, status: 'connecting', codex: { available: true, signedIn: null } });
    expect(h.blocker.start).toHaveBeenCalledExactlyOnceWith('prevent-app-suspension');
    expect(h.blocker.stop).not.toHaveBeenCalled();
    h.power.dispose();
    expect(h.blocker.stop).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('releases on battery and reacquires only when plugged in', () => {
    const h = harness(true);
    h.power.update(ready);
    expect(h.blocker.start).not.toHaveBeenCalled();
    h.setBattery(false);
    expect(h.blocker.start).toHaveBeenCalledTimes(1);
    h.setBattery(true);
    expect(h.blocker.stop).toHaveBeenCalledWith(0);
    h.setBattery(false);
    expect(h.blocker.start).toHaveBeenCalledTimes(2);
    h.power.dispose();
  });

  it('releases on disable or sign-out and never holds for an unready account', () => {
    const h = harness();
    h.power.update({ ...ready, codex: { available: true, signedIn: false } });
    expect(h.blocker.start).not.toHaveBeenCalled();
    h.power.update(ready);
    h.power.update({ ...ready, settings: { ...ready.settings, enabled: false } });
    expect(h.blocker.stop).toHaveBeenCalledTimes(1);
    h.power.update(ready);
    h.power.update({ ...ready, status: 'signed_out' });
    expect(h.blocker.stop).toHaveBeenCalledTimes(2);
    h.power.update({ ...ready, status: 'needs_setup' });
    expect(h.blocker.start).toHaveBeenCalledTimes(2);
    h.power.dispose();
  });

  it('honors actual sleep and cleans up event handlers permanently at exit', () => {
    const h = harness();
    h.power.update(ready);
    h.monitor.emit('suspend');
    h.power.update(ready);
    expect(h.blocker.stop).toHaveBeenCalledTimes(1);
    expect(h.blocker.start).toHaveBeenCalledTimes(1);
    h.monitor.emit('resume');
    expect(h.blocker.start).toHaveBeenCalledTimes(2);
    h.power.dispose();
    h.power.dispose();
    h.power.update(ready);
    h.setBattery(false);
    expect(h.monitor.eventNames()).toEqual([]);
    expect(h.blocker.start).toHaveBeenCalledTimes(2);
    expect(h.blocker.stop).toHaveBeenCalledTimes(2);
  });
});
