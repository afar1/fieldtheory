import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface VoiceFrame { readonly url: string }
interface VoiceContents {
  readonly mainFrame: VoiceFrame;
  isDestroyed(): boolean;
  getURL(): string;
}
interface VoiceWindow {
  readonly webContents: VoiceContents;
  isDestroyed(): boolean;
}
interface VoiceInvokeEvent {
  readonly sender: VoiceContents;
  readonly senderFrame: VoiceFrame | null;
}
export interface VoiceWorkEntry {
  appPath: string;
  startUrl?: string;
}

function entryUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['file:', 'http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

/** The Settings entry document, not merely another page on the same origin. */
export function isVoiceWorkWindowTrusted(window: VoiceWindow | null, entry: VoiceWorkEntry): window is VoiceWindow {
  try {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
    const expected = entryUrl(entry.startUrl || pathToFileURL(path.join(entry.appPath, 'dist', 'index.html')).href);
    return expected !== null && entryUrl(window.webContents.getURL()) === expected
      && entryUrl(window.webContents.mainFrame.url) === expected;
  } catch { return false; }
}

/** WebContents identity and frame identity must both match the current main window. */
export function assertVoiceWorkSender(event: VoiceInvokeEvent, window: VoiceWindow | null, entry: VoiceWorkEntry): void {
  if (!isVoiceWorkWindowTrusted(window, entry) || event.sender !== window.webContents
    || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Voice requests are only available from Field Theory Settings.');
  }
}
