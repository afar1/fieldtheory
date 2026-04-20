// Layout-model constants for bookmark text cards.
// Keep in sync with the `.bm-text-*` CSS block in `BookmarksCanvas.tsx` —
// `estimateTextCardHeight` reproduces that CSS in math so we can position
// thousands of cards without layout-flushing the DOM for each one.

export const BODY_LINE_HEIGHT = 14 * 1.45;
export const QUOTED_LINE_HEIGHT = 13 * 1.4;
export const HANDLE_BAND = 16;           // 12px font + small leading
export const QUOTED_HANDLE_BAND = 15;    // 11px font + small leading
export const CARD_PAD = 22;
export const CARD_GAP = 10;
export const QUOTED_PAD_V = 10;
export const QUOTED_PAD_H = 12;
export const QUOTED_MARGIN_TOP = 10;
export const QUOTED_GAP = 4;

/** Average glyph width for the body font (-apple-system 14px, proportional).
 * Calibrated against canvas measureText on a sample of English tweets; real
 * widths drift ±10% depending on glyph mix. The drift costs at most one
 * extra wrapped line (~20px) per card — absorbed by masonry gaps. */
export const AVG_CHAR_WIDTH_BODY = 7.5;
export const AVG_CHAR_WIDTH_QUOTED = 7.0;

/** Bucket size for the cache key — widths within the same bucket share a
 * cached height, which costs at most ~1 wrapped line of positional drift. */
export const WIDTH_BUCKET = 16;

export function wrapLines(text: string, avgCharWidth: number, maxWidth: number): number {
  if (!text) return 0;
  if (maxWidth <= 0) return 1;
  let lines = 0;
  for (const line of text.split('\n')) {
    if (line.length === 0) { lines += 1; continue; }
    lines += Math.max(1, Math.ceil((line.length * avgCharWidth) / maxWidth));
  }
  return lines;
}

export interface BookmarkHeightInput {
  id: string;
  text: string;
  quotedTweet?: { text: string };
}

const heightCache = new Map<string, number>();

export function estimateTextCardHeight(bm: BookmarkHeightInput, width: number): number {
  const bucketWidth = Math.round(width / WIDTH_BUCKET) * WIDTH_BUCKET;
  const key = `${bm.id}:${bucketWidth}`;
  const cached = heightCache.get(key);
  if (cached !== undefined) return cached;

  const bodyMax = bucketWidth - CARD_PAD * 2;
  let h = CARD_PAD * 2 + HANDLE_BAND;
  if (bm.text) {
    h += CARD_GAP + wrapLines(bm.text, AVG_CHAR_WIDTH_BODY, bodyMax) * BODY_LINE_HEIGHT;
  }
  if (bm.quotedTweet) {
    const quotedMax = bodyMax - QUOTED_PAD_H * 2;
    h += QUOTED_MARGIN_TOP + QUOTED_PAD_V * 2 + QUOTED_HANDLE_BAND + QUOTED_GAP
      + wrapLines(bm.quotedTweet.text, AVG_CHAR_WIDTH_QUOTED, quotedMax) * QUOTED_LINE_HEIGHT;
  }

  const rounded = Math.round(h);
  heightCache.set(key, rounded);
  return rounded;
}

/** Test-only — reset the module-scoped cache between specs. */
export function _resetHeightCacheForTests(): void {
  heightCache.clear();
}
