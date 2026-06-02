import * as plist from 'plist';

type ClipboardImage = {
  isEmpty: () => boolean;
};

export type TerminalPasteClipboard = {
  readText: () => string;
  readImage: () => ClipboardImage;
  read: (format: string) => string;
  readBuffer: (format: string) => Buffer;
};

export type TerminalPasteImageExporter = {
  exportCurrentClipboardImageToCache: () => Promise<string | null>;
};

export function parseMacClipboardFilePaths(buffer: Buffer): string[] {
  if (buffer.length === 0) return [];
  try {
    const parsed = plist.parse(buffer.toString('utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

export function parseClipboardFileUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'file:') return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

export function formatTerminalFilePaths(paths: string[]): string {
  return paths.filter(Boolean).join('\n');
}

export async function readCodexTerminalPasteText(input: {
  clipboard: TerminalPasteClipboard;
  imageExporter?: TerminalPasteImageExporter | null;
}): Promise<string> {
  const text = input.clipboard.readText();
  if (text) return text;

  const macFilePaths = parseMacClipboardFilePaths(input.clipboard.readBuffer('NSFilenamesPboardType'));
  if (macFilePaths.length > 0) return formatTerminalFilePaths(macFilePaths);

  const fileUrlPath = parseClipboardFileUrl(input.clipboard.read('public.file-url'));
  if (fileUrlPath) return fileUrlPath;

  const image = input.clipboard.readImage();
  if (!image.isEmpty()) {
    const imagePath = await input.imageExporter?.exportCurrentClipboardImageToCache();
    return imagePath ?? '';
  }

  return '';
}
