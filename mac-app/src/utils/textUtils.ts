/**
 * Utility functions for text processing and display.
 */

/**
 * Estimate words per line based on container width.
 * Uses average character width (~7px for 12px font) and average word length (~5 chars + space).
 * This is called once when width changes, not per-item during render.
 */
export function estimateWordsPerLine(containerWidth: number | null): number {
  if (!containerWidth || containerWidth <= 0) {
    return 10; // Reasonable default
  }
  // Account for item padding (~60px: 8px left/right padding on item + 16px on row + some buffer)
  const textWidth = Math.max(containerWidth - 60, 100);
  // Average character width for 12px font is ~7px, average word is ~5 chars + 1 space
  const avgCharWidth = 7;
  const avgWordChars = 6; // 5 letters + 1 space
  const charsPerLine = Math.floor(textWidth / avgCharWidth);
  const wordsPerLine = Math.floor(charsPerLine / avgWordChars);
  return Math.max(wordsPerLine, 5); // At least 5 words per line
}

/**
 * Smart truncation that shows beginning lines and end of text.
 * Uses estimated words-per-line based on container width (no DOM ops during render).
 */
export function smartTruncateText(
  text: string,
  _targetWords: number = 15,
  containerWidth: number | null = null
): {
  firstPart: string;
  lastPart: string;
  needsTruncation: boolean;
  fullText: string;
} {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  const lastPartWords = 5; // Last few words for context

  // If text is very short, no truncation needed
  if (words.length <= 15) {
    return {
      firstPart: trimmed,
      lastPart: '',
      needsTruncation: false,
      fullText: trimmed,
    };
  }

  // Calculate words per line based on container width
  const wordsPerLine = estimateWordsPerLine(containerWidth);
  const wordsFor1Line = wordsPerLine;
  const wordsFor2Lines = wordsPerLine * 2;
  const wordsFor3Lines = wordsPerLine * 3;

  // Determine how many lines we can show while leaving room for last words
  let firstPartWords: number;
  const totalNeeded = wordsFor3Lines + lastPartWords + 2; // Buffer for expand button

  if (words.length >= totalNeeded) {
    // Enough for full 3 lines + last words
    firstPartWords = wordsFor3Lines;
  } else {
    const totalNeeded2 = wordsFor2Lines + lastPartWords + 2;
    if (words.length >= totalNeeded2) {
      // Enough for full 2 lines + last words
      firstPartWords = wordsFor2Lines;
    } else {
      const totalNeeded1 = wordsFor1Line + lastPartWords + 2;
      if (words.length >= totalNeeded1) {
        // Enough for full 1 line + last words
        firstPartWords = wordsFor1Line;
      } else {
        // Not enough to truncate meaningfully
        return {
          firstPart: trimmed,
          lastPart: '',
          needsTruncation: false,
          fullText: trimmed,
        };
      }
    }
  }

  // Get first part and last part
  const firstWords = words.slice(0, firstPartWords);
  const lastWords = words.slice(-lastPartWords);

  return {
    firstPart: firstWords.join(' '),
    lastPart: '...' + lastWords.join(' '),
    needsTruncation: true,
    fullText: trimmed,
  };
}

/**
 * Detect if text contains a valid color value (hex or RGB) and return the color string.
 * Returns null if no valid color is found.
 * Checks if the entire text is a color, or finds the first color value in the text.
 */
export function detectColor(text: string | null): string | null {
  if (!text) return null;

  const trimmed = text.trim();

  // First check if the entire text is a hex color: #RGB, #RRGGBB, #RRGGBBAA
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  if (hexPattern.test(trimmed)) {
    return trimmed;
  }

  // Check if the entire text is RGB/RGBA: rgb(255, 87, 51) or rgba(255, 87, 51, 0.5)
  const rgbPattern = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i;
  if (rgbPattern.test(trimmed)) {
    return trimmed;
  }

  // If not the entire text, search for hex colors within the text
  const hexInTextPattern = /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/;
  const hexMatch = trimmed.match(hexInTextPattern);
  if (hexMatch) {
    return hexMatch[0];
  }

  // Search for RGB/RGBA within the text
  const rgbInTextPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i;
  const rgbInTextMatch = trimmed.match(rgbInTextPattern);
  if (rgbInTextMatch) {
    return rgbInTextMatch[0];
  }

  return null;
}

/**
 * Truncate text preview (legacy - simple truncation).
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Compact transcript text for small UI surfaces.
 * Shows first N words and last N words with an ellipsis in the middle.
 */
export function summarizeTranscriptForIsland(
  text: string,
  leadingWords: number = 5,
  trailingWords: number = leadingWords
): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';

  const words = normalized.split(' ').filter(Boolean);
  const threshold = leadingWords + trailingWords;

  if (words.length <= threshold) {
    return normalized;
  }

  const firstWords = words.slice(0, leadingWords).join(' ');
  const lastWords = words.slice(-trailingWords).join(' ');
  return `${firstWords} ... ${lastWords}`;
}

/**
 * Summarize drawer transcript text with optional leading-context visibility.
 * When leading context is hidden, only the trailing window is shown with an
 * ellipsis prefix once text exceeds the trailing budget.
 */
export function summarizeDrawerTranscript(
  text: string,
  options: {
    leadingWords?: number;
    trailingWords?: number;
    showLeadingContext?: boolean;
  } = {}
): string {
  const leadingWords = Math.max(0, options.leadingWords ?? 3);
  const trailingWords = Math.max(1, options.trailingWords ?? 10);
  const showLeadingContext = options.showLeadingContext ?? true;

  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';

  const words = normalized.split(' ').filter(Boolean);

  if (!showLeadingContext) {
    if (words.length <= trailingWords) {
      return normalized;
    }
    return `... ${words.slice(-trailingWords).join(' ')}`;
  }

  const threshold = leadingWords + trailingWords;
  if (words.length <= threshold || leadingWords === 0) {
    return normalized;
  }

  const firstWords = words.slice(0, leadingWords).join(' ');
  const lastWords = words.slice(-trailingWords).join(' ');
  return `${firstWords} ... ${lastWords}`;
}

/**
 * Split compact drawer text into leading/trailing render parts.
 * Input is expected to be the output of summarizeDrawerTranscript().
 */
export function splitDrawerTranscriptForRender(
  compactText: string,
  showLeadingContext: boolean
): {
  leadingText: string;
  trailingWords: string[];
  hasHiddenPrefix: boolean;
} {
  const tokens = compactText.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { leadingText: '', trailingWords: [], hasHiddenPrefix: false };
  }

  const ellipsisIndex = tokens.indexOf('...');
  if (ellipsisIndex >= 0) {
    const leadingTokens = tokens.slice(0, ellipsisIndex);
    const trailingWords = tokens.slice(ellipsisIndex + 1);
    return {
      leadingText: showLeadingContext ? leadingTokens.join(' ') : '',
      trailingWords,
      hasHiddenPrefix: !showLeadingContext && trailingWords.length > 0,
    };
  }

  return {
    leadingText: '',
    trailingWords: tokens,
    hasHiddenPrefix: false,
  };
}

/**
 * Count how many words were appended at the end of the transcript between
 * two updates, capped for UI animation.
 */
export function countAppendedWords(
  previousText: string,
  nextText: string,
  maxAnimatedWords: number = 3
): number {
  const maxWords = Math.max(0, Math.floor(maxAnimatedWords));
  if (maxWords === 0) return 0;

  const prevWords = previousText.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const nextWords = nextText.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);

  if (nextWords.length <= prevWords.length) {
    return 0;
  }

  let prefixLen = 0;
  const compareLen = Math.min(prevWords.length, nextWords.length);
  while (prefixLen < compareLen && prevWords[prefixLen] === nextWords[prefixLen]) {
    prefixLen += 1;
  }

  const appended = prefixLen === prevWords.length
    ? nextWords.length - prevWords.length
    : nextWords.length;

  return Math.min(maxWords, appended);
}

/**
 * Compute visual emphasis for a word in a one-line carousel strip.
 * Center words appear brighter/larger/sharper than edge words.
 */
export function getCarouselWordVisual(
  index: number,
  totalWords: number,
  options: {
    minOpacity?: number;
    maxOpacity?: number;
    minScale?: number;
    maxBlurPx?: number;
    focusPosition?: number;
    rightBiasWeight?: number;
  } = {}
): { opacity: number; scale: number; blurPx: number } {
  const count = Math.max(1, Math.floor(totalWords));
  const slot = Math.max(0, Math.min(count - 1, Math.floor(index)));

  const minOpacity = Math.max(0, Math.min(1, options.minOpacity ?? 0.24));
  const maxOpacity = Math.max(minOpacity, Math.min(1, options.maxOpacity ?? 0.92));
  const minScale = Math.max(0.5, Math.min(1, options.minScale ?? 0.9));
  const maxBlurPx = Math.max(0, options.maxBlurPx ?? 1.05);
  const focusPosition = Math.max(0, Math.min(1, options.focusPosition ?? 0.72));
  const rightBiasWeight = Math.max(0, Math.min(1, options.rightBiasWeight ?? 0.28));

  if (count === 1) {
    return { opacity: maxOpacity, scale: 1, blurPx: 0 };
  }

  const normalizedPos = slot / (count - 1);
  const maxDistance = Math.max(focusPosition, 1 - focusPosition, 0.001);
  const distance = Math.abs(normalizedPos - focusPosition);
  const focusEmphasis = Math.max(0, Math.min(1, 1 - (distance / maxDistance)));
  const emphasis = Math.max(
    0,
    Math.min(1, (focusEmphasis * (1 - rightBiasWeight)) + (normalizedPos * rightBiasWeight))
  );

  const opacity = minOpacity + ((maxOpacity - minOpacity) * emphasis);
  const scale = minScale + ((1 - minScale) * emphasis);
  const blurPx = maxBlurPx * (1 - emphasis);

  return {
    opacity: Number(opacity.toFixed(3)),
    scale: Number(scale.toFixed(3)),
    blurPx: Number(blurPx.toFixed(3)),
  };
}

/**
 * Summarize transcript text for history rows.
 * Keeps as much leading context as possible within the max line budget, then
 * appends an inline ellipsis and the final trailing words.
 */
export function summarizeTranscriptForHistory(
  text: string,
  wordsPerLine: number = 10,
  trailingWords: number = 5,
  maxLines: number = 3
): string {
  const sentenceCase = (value: string): string => {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';

  const words = normalized.split(' ').filter(Boolean);
  const safeWordsPerLine = Math.max(1, Math.floor(wordsPerLine));
  const safeTrailingWords = Math.max(1, Math.floor(trailingWords));
  const safeMaxLines = Math.max(1, Math.floor(maxLines));
  const maxVisibleWords = safeWordsPerLine * safeMaxLines;
  const truncateThreshold = maxVisibleWords;

  if (words.length <= truncateThreshold) {
    return sentenceCase(normalized);
  }

  // Keep enough room for "... " and trailing words while maximizing leading context.
  const leadingWordBudget = Math.max(
    safeWordsPerLine,
    maxVisibleWords - safeTrailingWords - 1
  );
  const firstWords = words.slice(0, leadingWordBudget).join(' ');
  const lastWords = words.slice(-safeTrailingWords).join(' ');
  return sentenceCase(`${firstWords} ... ${lastWords}`);
}
