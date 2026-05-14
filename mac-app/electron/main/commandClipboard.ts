import { clipboard, type NativeImage } from 'electron';

export const COMMAND_CLIPBOARD_RESTORE_DELAY_MS = 1500;

const COMMAND_FILE_TEXT_CONTENT_TARGET_BUNDLE_IDS = new Set([
  'net.whatsapp.whatsapp',
  'com.tinyspeck.slackmacgap',
]);

export type ClipboardFormatSnapshot = {
  format: string;
  buffer: Buffer;
};

export type ClipboardSnapshot = {
  formats: ClipboardFormatSnapshot[];
  text: string;
  image: NativeImage;
};

export type CommandClipboardPayloadSnapshot = {
  formats: ClipboardFormatSnapshot[];
  availableFormats: string[];
  text: string;
};

export type CommandClipboard = {
  availableFormats: () => string[];
  readBuffer: (format: string) => Buffer;
  readText: () => string;
  readImage: () => NativeImage;
  clear: () => void;
  writeBuffer: (format: string, buffer: Buffer) => void;
  writeText: (text: string) => void;
  writeImage: (image: NativeImage) => void;
};

export class CommandClipboardRestoreCoordinator {
  private generation = 0;
  private snapshot: ClipboardSnapshot | null = null;

  begin(snapshot: ClipboardSnapshot): { generation: number; snapshot: ClipboardSnapshot } {
    if (!this.snapshot) this.snapshot = snapshot;
    this.generation += 1;
    return { generation: this.generation, snapshot: this.snapshot };
  }

  canRestore(generation: number): boolean {
    return this.snapshot !== null && generation === this.generation;
  }

  finish(generation: number): void {
    if (this.canRestore(generation)) this.snapshot = null;
  }
}

function readClipboardFormats(source: CommandClipboard, formats: string[]): ClipboardFormatSnapshot[] {
  const snapshots: ClipboardFormatSnapshot[] = [];
  for (const format of formats) {
    try {
      const buffer = source.readBuffer(format);
      if (buffer.length > 0) snapshots.push({ format, buffer });
    } catch {
      // Some native formats are readable only by the source app.
    }
  }
  return snapshots;
}

export function captureClipboardSnapshot(source: CommandClipboard = clipboard): ClipboardSnapshot {
  return {
    formats: readClipboardFormats(source, source.availableFormats()),
    text: source.readText(),
    image: source.readImage(),
  };
}

export function captureCommandClipboardPayload(source: CommandClipboard = clipboard): CommandClipboardPayloadSnapshot {
  const availableFormats = source.availableFormats();
  return {
    formats: readClipboardFormats(source, availableFormats),
    availableFormats,
    text: source.readText(),
  };
}

export function restoreClipboardSnapshot(snapshot: ClipboardSnapshot, target: CommandClipboard = clipboard): void {
  target.clear();
  let restoredAnyFormat = false;
  for (const { format, buffer } of snapshot.formats) {
    try {
      target.writeBuffer(format, buffer);
      restoredAnyFormat = true;
    } catch {
      // Best effort: keep restoring the remaining formats.
    }
  }
  if (!restoredAnyFormat) {
    if (snapshot.text) target.writeText(snapshot.text);
    if (!snapshot.image.isEmpty()) target.writeImage(snapshot.image);
  }
}

export function clipboardMatchesCommandPayload(
  payload: CommandClipboardPayloadSnapshot,
  source: CommandClipboard = clipboard,
): boolean {
  if (source.readText() !== payload.text) return false;

  const expectedFormats = [...payload.availableFormats].sort();
  const currentFormats = [...source.availableFormats()].sort();
  if (
    expectedFormats.length !== currentFormats.length ||
    expectedFormats.some((format, index) => format !== currentFormats[index])
  ) {
    return false;
  }

  for (const { format, buffer } of payload.formats) {
    try {
      if (!source.readBuffer(format).equals(buffer)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function waitForCommandClipboardPasteRead(delayMs = COMMAND_CLIPBOARD_RESTORE_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export function shouldPasteCommandFileContentsAsText(bundleId: string | null | undefined): boolean {
  if (!bundleId) return false;
  return COMMAND_FILE_TEXT_CONTENT_TARGET_BUNDLE_IDS.has(bundleId.toLowerCase());
}
