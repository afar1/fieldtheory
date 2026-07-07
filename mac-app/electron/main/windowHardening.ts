import type { BrowserWindow } from 'electron';

type WindowOpenHandlerResult = { action: 'deny' };

type HardenableWebContents = BrowserWindow['webContents'] & {
  setWindowOpenHandler?: (handler: () => WindowOpenHandlerResult) => void;
};

type HardenableWindow = Pick<BrowserWindow, 'webContents'>;

type HardenWindowOptions = {
  allowedOrigins?: readonly string[];
};

export function hardenWindow(window: HardenableWindow, options: HardenWindowOptions = {}): void {
  const webContents = window.webContents as HardenableWebContents;
  webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedWindowNavigation(url, options)) return;
    event.preventDefault();
  });
}

export function isAllowedWindowNavigation(url: string, options: HardenWindowOptions = {}): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const allowedOrigins = new Set(options.allowedOrigins ?? getDefaultAllowedOrigins());
  return allowedOrigins.has(parsed.origin);
}

function getDefaultAllowedOrigins(): string[] {
  const startUrl = process.env.ELECTRON_START_URL;
  if (!startUrl) return [];

  try {
    return [new URL(startUrl).origin];
  } catch {
    return [];
  }
}
