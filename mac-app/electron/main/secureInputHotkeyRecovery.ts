export interface SecureInputHotkeyStatus {
  active: boolean | null;
  lastCheckedAt: string | null;
  lastRecoveredAt: string | null;
  lastRecoveryReason: string | null;
}

interface SecureInputHotkeyRecoveryOptions {
  getSecureInputStatus: () => Promise<boolean | null>;
  restartHotkeys: (reason: string) => boolean;
}

export class SecureInputHotkeyRecovery {
  private readonly getSecureInputStatus: () => Promise<boolean | null>;
  private readonly restartHotkeys: (reason: string) => boolean;
  private status: SecureInputHotkeyStatus = {
    active: null,
    lastCheckedAt: null,
    lastRecoveredAt: null,
    lastRecoveryReason: null,
  };
  private checkInFlight: Promise<SecureInputHotkeyStatus> | null = null;
  private recoveryPending = false;

  constructor(options: SecureInputHotkeyRecoveryOptions) {
    this.getSecureInputStatus = options.getSecureInputStatus;
    this.restartHotkeys = options.restartHotkeys;
  }

  getStatus(): SecureInputHotkeyStatus {
    return { ...this.status };
  }

  check(): Promise<SecureInputHotkeyStatus> {
    if (this.checkInFlight) return this.checkInFlight;

    this.checkInFlight = this.runCheck().finally(() => {
      this.checkInFlight = null;
    });
    return this.checkInFlight;
  }

  async restartWhenAvailable(reason: string): Promise<{ success: boolean; secureInputActive: boolean | null }> {
    const active = await this.getSecureInputStatus();
    this.status.active = active;
    this.status.lastCheckedAt = new Date().toISOString();

    if (active !== false) {
      return { success: false, secureInputActive: active };
    }

    return { success: this.recover(reason), secureInputActive: false };
  }

  private async runCheck(): Promise<SecureInputHotkeyStatus> {
    const previous = this.status.active;
    const active = await this.getSecureInputStatus();
    this.status.active = active;
    this.status.lastCheckedAt = new Date().toISOString();

    if (previous === true && active === false) {
      this.recoveryPending = true;
    }

    if (active === false && this.recoveryPending) {
      this.recoveryPending = !this.recover('secure-input-released');
    }

    return this.getStatus();
  }

  private recover(reason: string): boolean {
    if (!this.restartHotkeys(reason)) {
      return false;
    }
    this.status.lastRecoveredAt = new Date().toISOString();
    this.status.lastRecoveryReason = reason;
    return true;
  }
}
