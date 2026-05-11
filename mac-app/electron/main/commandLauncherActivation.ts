export type CommandLauncherTargetApp = {
  bundleId: string;
  name: string;
};

export type CommandLauncherFrontmostApp = {
  bundleId?: string | null;
  name?: string | null;
};

type WaitForTargetAppFrontmostOptions = {
  targetApp: CommandLauncherTargetApp;
  getFrontmostApp: () => CommandLauncherFrontmostApp | null | undefined;
  tracePrefix: string;
  appendTrace?: (event: string, details?: Record<string, unknown>) => void;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

export const COMMAND_LAUNCHER_TARGET_ACTIVATION_TIMEOUT_MS = 750;
export const COMMAND_LAUNCHER_TARGET_ACTIVATION_POLL_MS = 25;

function sameBundleId(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function waitForTargetAppFrontmost({
  targetApp,
  getFrontmostApp,
  tracePrefix,
  appendTrace,
  timeoutMs = COMMAND_LAUNCHER_TARGET_ACTIVATION_TIMEOUT_MS,
  pollMs = COMMAND_LAUNCHER_TARGET_ACTIVATION_POLL_MS,
  now = () => Date.now(),
  sleep = defaultSleep,
}: WaitForTargetAppFrontmostOptions): Promise<boolean> {
  const startedAt = now();
  let attempts = 0;
  let frontmostApp: CommandLauncherFrontmostApp | null | undefined = null;

  while (true) {
    frontmostApp = getFrontmostApp();
    const elapsedMs = now() - startedAt;
    if (sameBundleId(frontmostApp?.bundleId, targetApp.bundleId)) {
      appendTrace?.(`${tracePrefix}-target-frontmost`, {
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        frontmostBundleId: frontmostApp?.bundleId ?? null,
        frontmostName: frontmostApp?.name ?? null,
        elapsedMs,
        attempts,
      });
      return true;
    }

    if (elapsedMs >= timeoutMs) {
      appendTrace?.(`${tracePrefix}-target-frontmost-timeout`, {
        targetBundleId: targetApp.bundleId,
        targetName: targetApp.name,
        frontmostBundleId: frontmostApp?.bundleId ?? null,
        frontmostName: frontmostApp?.name ?? null,
        elapsedMs,
        attempts,
      });
      return false;
    }

    attempts += 1;
    await sleep(Math.min(pollMs, timeoutMs - elapsedMs));
  }
}
