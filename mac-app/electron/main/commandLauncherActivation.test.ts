import { describe, expect, it, vi } from 'vitest';
import { waitForTargetAppFrontmost } from './commandLauncherActivation';

describe('waitForTargetAppFrontmost', () => {
  it('returns immediately when the target app is already frontmost', async () => {
    const appendTrace = vi.fn();
    const sleep = vi.fn(async () => undefined);

    await expect(waitForTargetAppFrontmost({
      targetApp: { bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' },
      getFrontmostApp: () => ({ bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' }),
      tracePrefix: 'invoke-command-native-type',
      appendTrace,
      sleep,
    })).resolves.toBe(true);

    expect(sleep).not.toHaveBeenCalled();
    expect(appendTrace).toHaveBeenCalledWith('invoke-command-native-type-target-frontmost', expect.objectContaining({
      targetBundleId: 'com.mitchellh.ghostty',
      frontmostBundleId: 'com.mitchellh.ghostty',
      attempts: 0,
    }));
  });

  it('waits until macOS has actually moved focus to the target app', async () => {
    let now = 1000;
    const appendTrace = vi.fn();
    const frontmostApps = [
      { bundleId: 'com.github.Electron', name: 'Field Theory' },
      { bundleId: 'com.github.Electron', name: 'Field Theory' },
      { bundleId: 'net.whatsapp.WhatsApp', name: 'WhatsApp' },
    ];
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await expect(waitForTargetAppFrontmost({
      targetApp: { bundleId: 'net.whatsapp.whatsapp', name: 'WhatsApp' },
      getFrontmostApp: () => frontmostApps.shift(),
      tracePrefix: 'invoke-command-native-type',
      appendTrace,
      now: () => now,
      sleep,
    })).resolves.toBe(true);

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(appendTrace).toHaveBeenCalledWith('invoke-command-native-type-target-frontmost', expect.objectContaining({
      targetBundleId: 'net.whatsapp.whatsapp',
      frontmostBundleId: 'net.whatsapp.WhatsApp',
      attempts: 2,
    }));
  });

  it('returns false when the target app never becomes frontmost', async () => {
    let now = 1000;
    const appendTrace = vi.fn();
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await expect(waitForTargetAppFrontmost({
      targetApp: { bundleId: 'com.mitchellh.ghostty', name: 'Ghostty' },
      getFrontmostApp: () => ({ bundleId: 'com.github.Electron', name: 'Field Theory' }),
      tracePrefix: 'activate-and-paste',
      appendTrace,
      timeoutMs: 50,
      pollMs: 25,
      now: () => now,
      sleep,
    })).resolves.toBe(false);

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(appendTrace).toHaveBeenCalledWith('activate-and-paste-target-frontmost-timeout', expect.objectContaining({
      targetBundleId: 'com.mitchellh.ghostty',
      frontmostBundleId: 'com.github.Electron',
      attempts: 2,
    }));
  });
});
