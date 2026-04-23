export type MarkdownUrlPasteKind = 'link' | 'embed' | 'raw';

export type MarkdownUrlPasteEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
  insertedStart: number;
  insertedEnd: number;
  url: string;
  label: string;
  kind: MarkdownUrlPasteKind;
};

export const MARKDOWN_URL_PASTE_OPTIONS: Array<{ kind: MarkdownUrlPasteKind; label: string; title: string }> = [
  { kind: 'link', label: 'link', title: 'Use a markdown link with selected label text' },
  { kind: 'embed', label: 'embed', title: 'Use markdown image embed syntax' },
  { kind: 'raw', label: 'raw', title: 'Keep the plain URL' },
];

function normalizePastedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return candidate;
  } catch {
    return null;
  }
}

function getDefaultMarkdownUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '') || 'link';
  } catch {
    return 'link';
  }
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function formatMarkdownLinkDestination(url: string): string {
  return `<${url.replace(/>/g, '%3E')}>`;
}

export function getDefaultMarkdownUrlPasteKind(
  url: string,
  selectedText: string,
): MarkdownUrlPasteKind {
  if (selectedText.trim()) return 'link';
  return /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(url) ? 'embed' : 'link';
}

function getMarkdownUrlPasteInsertion(
  url: string,
  label: string,
  kind: MarkdownUrlPasteKind,
): { text: string; selectionStartOffset: number; selectionEndOffset: number } {
  if (kind === 'raw') {
    return { text: url, selectionStartOffset: url.length, selectionEndOffset: url.length };
  }

  const safeLabel = escapeMarkdownLinkLabel(label || getDefaultMarkdownUrlLabel(url));
  const destination = formatMarkdownLinkDestination(url);
  const prefix = kind === 'embed' ? '![' : '[';
  const text = `${prefix}${safeLabel}](${destination})`;
  const selectionStartOffset = prefix.length;
  return {
    text,
    selectionStartOffset,
    selectionEndOffset: selectionStartOffset + safeLabel.length,
  };
}

export function getMarkdownUrlPasteEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  pastedText: string,
  kind?: MarkdownUrlPasteKind,
): MarkdownUrlPasteEdit | null {
  const url = normalizePastedUrl(pastedText);
  if (!url) return null;

  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selectedText = value.slice(start, end);
  const label = selectedText.trim() && !selectedText.includes('\n')
    ? selectedText
    : getDefaultMarkdownUrlLabel(url);
  const nextKind = kind ?? getDefaultMarkdownUrlPasteKind(url, selectedText);
  const insertion = getMarkdownUrlPasteInsertion(url, label, nextKind);
  const nextValue = `${value.slice(0, start)}${insertion.text}${value.slice(end)}`;

  return {
    nextValue,
    selectionStart: start + insertion.selectionStartOffset,
    selectionEnd: start + insertion.selectionEndOffset,
    insertedStart: start,
    insertedEnd: start + insertion.text.length,
    url,
    label,
    kind: nextKind,
  };
}

export function getMarkdownUrlPasteReplacement(
  value: string,
  pasteEdit: MarkdownUrlPasteEdit,
  kind: MarkdownUrlPasteKind,
): MarkdownUrlPasteEdit {
  const insertion = getMarkdownUrlPasteInsertion(pasteEdit.url, pasteEdit.label, kind);
  const nextValue = `${value.slice(0, pasteEdit.insertedStart)}${insertion.text}${value.slice(pasteEdit.insertedEnd)}`;

  return {
    ...pasteEdit,
    nextValue,
    selectionStart: pasteEdit.insertedStart + insertion.selectionStartOffset,
    selectionEnd: pasteEdit.insertedStart + insertion.selectionEndOffset,
    insertedEnd: pasteEdit.insertedStart + insertion.text.length,
    kind,
  };
}
