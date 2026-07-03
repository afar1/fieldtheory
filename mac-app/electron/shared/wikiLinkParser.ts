export type RawMarkdownLinkHit =
  | {
      kind: 'wikilink';
      rawTarget: string;
      href: null;
      start: number;
      end: number;
      displayStart: number;
      displayEnd: number;
      displayText: string;
    }
  | {
      kind: 'markdown-link' | 'autolink' | 'bare-url';
      rawTarget: null;
      href: string;
      start: number;
      end: number;
      displayStart: number;
      displayEnd: number;
      displayText: string;
    };

function trimBareHref(href: string): string {
  return href.replace(/[.,;:!?]+$/g, '');
}

function getTrimmedRange(start: number, raw: string): { start: number; end: number; text: string } {
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const text = raw.trim();
  return {
    start: start + leading,
    end: start + leading + text.length,
    text,
  };
}

export function getRawMarkdownLinkHits(markdown: string): RawMarkdownLinkHit[] {
  const hits: RawMarkdownLinkHit[] = [];

  for (const match of markdown.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const targetStart = start + 2;
    const targetRange = getTrimmedRange(targetStart, match[1]);
    const alias = match[2];
    const displayRange = alias === undefined
      ? targetRange
      : getTrimmedRange(targetStart + match[1].length + 1, alias);
    const displayText = displayRange.text || targetRange.text;
    const displayStart = displayRange.text ? displayRange.start : targetRange.start;
    hits.push({
      kind: 'wikilink',
      rawTarget: match[1],
      href: null,
      start,
      end: start + match[0].length,
      displayStart,
      displayEnd: displayStart + displayText.length,
      displayText,
    });
  }

  for (const match of markdown.matchAll(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const href = match[2].trim() || match[1].trim();
    const labelStart = start + (match[0].startsWith('!') ? 2 : 1);
    const labelRange = getTrimmedRange(labelStart, match[1]);
    hits.push({
      kind: 'markdown-link',
      rawTarget: null,
      href,
      start,
      end: start + match[0].length,
      displayStart: labelRange.start,
      displayEnd: labelRange.end,
      displayText: labelRange.text,
    });
  }

  for (const match of markdown.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]+)>/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    hits.push({
      kind: 'autolink',
      rawTarget: null,
      href: match[1],
      start,
      end: start + match[0].length,
      displayStart: start + 1,
      displayEnd: start + 1 + match[1].length,
      displayText: match[1],
    });
  }

  for (const match of markdown.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s<>()]+/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const href = trimBareHref(match[0]);
    hits.push({
      kind: 'bare-url',
      rawTarget: null,
      href,
      start,
      end: start + href.length,
      displayStart: start,
      displayEnd: start + href.length,
      displayText: href,
    });
  }

  return hits;
}
