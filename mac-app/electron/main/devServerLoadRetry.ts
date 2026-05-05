import type { BrowserWindow } from 'electron';

const DEV_SERVER_CONNECTION_REFUSED = -102;
const DEV_SERVER_LOAD_ABORTED = -2;
const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

type RetryLogger = {
  warn: (msg: string, ...args: unknown[]) => void;
};

export function devServerPageUrl(startUrl: string, page: string): string {
  const baseUrl = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
  return `${baseUrl}${page}`;
}

export function isDevServerConnectionRefused(errorCode: number): boolean {
  return errorCode === DEV_SERVER_CONNECTION_REFUSED;
}

export function isDevServerLoadAborted(error: unknown): boolean {
  const details = error as { errno?: unknown; code?: unknown } | null;
  return details?.errno === DEV_SERVER_LOAD_ABORTED || details?.code === 'ERR_FAILED';
}

export function shouldRetryDevServerLoad(input: {
  startUrl?: string;
  errorCode: number;
  validatedURL?: string;
  expectedURL: string;
  retryIndex: number;
  retryDelays: readonly number[];
}): boolean {
  if (!input.startUrl) return false;
  if (!isDevServerConnectionRefused(input.errorCode)) return false;
  if (input.retryIndex >= input.retryDelays.length) return false;
  return !input.validatedURL || input.validatedURL === input.expectedURL;
}

export function loadDevServerURLWithRetry(
  win: BrowserWindow,
  startUrl: string,
  page: string,
  options: {
    label: string;
    logger: RetryLogger;
    retryDelays?: readonly number[];
  },
): void {
  const expectedURL = devServerPageUrl(startUrl, page);
  const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS_MS;
  let retryIndex = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const load = () => {
    if (win.isDestroyed()) return;
    void win.loadURL(expectedURL).catch((error) => {
      if (win.isDestroyed()) return;
      if (isDevServerLoadAborted(error)) return;
      options.logger.warn(`[${options.label}] Failed to request ${expectedURL}:`, error);
    });
  };

  const clearRetryTimer = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  win.webContents.on('did-finish-load', () => {
    retryIndex = 0;
    clearRetryTimer();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (!shouldRetryDevServerLoad({
      startUrl,
      errorCode,
      validatedURL,
      expectedURL,
      retryIndex,
      retryDelays,
    })) {
      return;
    }

    const delay = retryDelays[retryIndex];
    retryIndex += 1;
    clearRetryTimer();
    options.logger.warn(
      `[${options.label}] Dev server refused ${validatedURL || expectedURL}; retrying in ${delay}ms`,
      errorDescription,
    );
    retryTimer = setTimeout(load, delay);
  });

  win.once('closed', clearRetryTimer);
  load();
}
