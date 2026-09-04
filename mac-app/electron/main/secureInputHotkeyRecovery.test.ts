import { describe, expect, it, vi } from 'vitest';
import { SecureInputHotkeyRecovery } from './secureInputHotkeyRecovery';

describe('SecureInputHotkeyRecovery', () => {
  it('restarts hotkeys once when Secure Input is released', async () => {
    const getSecureInputStatus = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const restartHotkeys = vi.fn(() => true);
    const recovery = new SecureInputHotkeyRecovery({ getSecureInputStatus, restartHotkeys });

    await recovery.check();
    await recovery.check();
    await recovery.check();

    expect(restartHotkeys).toHaveBeenCalledTimes(1);
    expect(restartHotkeys).toHaveBeenCalledWith('secure-input-released');
    expect(recovery.getStatus()).toMatchObject({
      active: false,
      lastRecoveryReason: 'secure-input-released',
    });
  });

  it('does not restart while Secure Input remains active', async () => {
    const restartHotkeys = vi.fn(() => true);
    const recovery = new SecureInputHotkeyRecovery({
      getSecureInputStatus: vi.fn().mockResolvedValue(true),
      restartHotkeys,
    });

    const result = await recovery.restartWhenAvailable('manual');

    expect(result).toEqual({ success: false, secureInputActive: true });
    expect(restartHotkeys).not.toHaveBeenCalled();
  });

  it('coalesces overlapping checks', async () => {
    let resolveStatus!: (active: boolean) => void;
    const getSecureInputStatus = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveStatus = resolve;
    }));
    const recovery = new SecureInputHotkeyRecovery({
      getSecureInputStatus,
      restartHotkeys: vi.fn(() => true),
    });

    const first = recovery.check();
    const second = recovery.check();
    resolveStatus(false);
    await Promise.all([first, second]);

    expect(getSecureInputStatus).toHaveBeenCalledTimes(1);
  });

  it('retries a failed rebuild while Secure Input remains inactive', async () => {
    const getSecureInputStatus = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const restartHotkeys = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const recovery = new SecureInputHotkeyRecovery({ getSecureInputStatus, restartHotkeys });

    await recovery.check();
    await recovery.check();
    expect(recovery.getStatus().lastRecoveredAt).toBeNull();
    await recovery.check();

    expect(restartHotkeys).toHaveBeenCalledTimes(2);
    expect(recovery.getStatus().lastRecoveryReason).toBe('secure-input-released');
  });
});
