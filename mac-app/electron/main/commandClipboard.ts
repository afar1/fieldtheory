import { clipboard, type NativeImage } from 'electron';

export const COMMAND_CLIPBOARD_RESTORE_DELAY_MS = 500;

export type ClipboardFormatSnapshot = {
  format: string;
  buffer: Buffer;
};

export type ClipboardSnapshot = {
  formats: ClipboardFormatSnapshot[];
  text: string;
  image: NativeImage;
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

export function captureClipboardSnapshot(source: CommandClipboard = clipboard): ClipboardSnapshot {
  const formats: ClipboardFormatSnapshot[] = [];
  for (const format of source.availableFormats()) {
    try {
      const buffer = source.readBuffer(format);
      if (buffer.length > 0) formats.push({ format, buffer });
    } catch {
      // Some native formats are readable only by the source app.
    }
  }
  return {
    formats,
    text: source.readText(),
    image: source.readImage(),
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

export function waitForCommandClipboardPasteRead(delayMs = COMMAND_CLIPBOARD_RESTORE_DELAY_MS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
