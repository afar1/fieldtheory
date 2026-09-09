import type { PowerSaveBlocker } from 'electron';
import type { VoiceWorkState } from '../shared/voiceWork';

interface PowerEvents {
  isOnBatteryPower(): boolean;
  on(event: 'on-ac' | 'on-battery' | 'suspend' | 'resume', listener: () => void): unknown;
  removeListener(event: 'on-ac' | 'on-battery' | 'suspend' | 'resume', listener: () => void): unknown;
}

/** Keep the host reachable on AC without preventing screen lock or display sleep. */
export class VoiceRunnerPower {
  private assertion: number | null = null;
  private enabled = false;
  private suspended = false;
  private disposed = false;

  constructor(
    private readonly monitor: PowerEvents,
    private readonly blocker: Pick<PowerSaveBlocker, 'start' | 'stop'>,
  ) {
    monitor.on('on-ac', this.reconcile);
    monitor.on('on-battery', this.reconcile);
    monitor.on('suspend', this.suspend);
    monitor.on('resume', this.resume);
  }

  update(state: VoiceWorkState): void {
    this.enabled = state.settings.enabled && state.status !== 'signed_out' && state.status !== 'needs_setup'
      && state.codex.available && state.codex.signedIn !== false;
    this.reconcile();
  }

  dispose(): void {
    this.disposed = true;
    this.monitor.removeListener('on-ac', this.reconcile);
    this.monitor.removeListener('on-battery', this.reconcile);
    this.monitor.removeListener('suspend', this.suspend);
    this.monitor.removeListener('resume', this.resume);
    this.reconcile();
  }

  private suspend = (): void => { this.suspended = true; this.reconcile(); };
  private resume = (): void => { this.suspended = false; this.reconcile(); };

  private reconcile = (): void => {
    const keepAwake = !this.disposed && !this.suspended && this.enabled && !this.monitor.isOnBatteryPower();
    if (keepAwake && this.assertion === null) {
      this.assertion = this.blocker.start('prevent-app-suspension');
    } else if (!keepAwake && this.assertion !== null) {
      this.blocker.stop(this.assertion);
      this.assertion = null;
    }
  };
}
