/**
 * ClipboardList Utilities
 * 
 * Shared utility functions for formatting, truncation, and text processing.
 * Used by the ClipboardList component and its wrappers.
 */

import type { BaseClipboardItem } from './types';

/**
 * Format timestamp to relative time (e.g., "2 minutes ago").
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Format file size for images.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Simple text truncation (legacy).
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Estimate words per line based on container width.
 * Uses average character width (~7px for 12px font) and average word length (~5 chars + space).
 * Called once when width changes, not per-item during render.
 */
export function estimateWordsPerLine(containerWidth: number | null): number {
  if (!containerWidth || containerWidth <= 0) {
    return 10; // Reasonable default
  }
  // Account for item padding (~60px: 8px left/right padding on item + 16px on row + buffer).
  const textWidth = Math.max(containerWidth - 60, 100);
  // Average character width for 12px font is ~7px, average word is ~5 chars + 1 space.
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

  // If text is very short, no truncation needed.
  if (words.length <= 15) {
    return {
      firstPart: trimmed,
      lastPart: '',
      needsTruncation: false,
      fullText: trimmed,
    };
  }

  // Calculate words per line based on container width.
  const wordsPerLine = estimateWordsPerLine(containerWidth);
  const wordsFor1Line = wordsPerLine;
  const wordsFor2Lines = wordsPerLine * 2;
  const wordsFor3Lines = wordsPerLine * 3;

  // Determine how many lines we can show while leaving room for last words.
  let firstPartWords: number;
  const totalNeeded = wordsFor3Lines + lastPartWords + 2; // Buffer for expand button

  if (words.length >= totalNeeded) {
    // Enough for full 3 lines + last words.
    firstPartWords = wordsFor3Lines;
  } else {
    const totalNeeded2 = wordsFor2Lines + lastPartWords + 2;
    if (words.length >= totalNeeded2) {
      // Enough for full 2 lines + last words.
      firstPartWords = wordsFor2Lines;
    } else {
      const totalNeeded1 = wordsFor1Line + lastPartWords + 2;
      if (words.length >= totalNeeded1) {
        // Enough for full 1 line + last words.
        firstPartWords = wordsFor1Line;
      } else {
        // Not enough to truncate meaningfully.
        return {
          firstPart: trimmed,
          lastPart: '',
          needsTruncation: false,
          fullText: trimmed,
        };
      }
    }
  }

  // Get first part and last part.
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
 * Combine text content from stack items into a single paragraph.
 * Works with any item type that extends BaseClipboardItem.
 */
export function combineStackText<T extends BaseClipboardItem>(items: T[]): string {
  const textParts: string[] = [];
  for (const item of items) {
    if ((item.type === 'text' || item.type === 'transcript') && item.content) {
      textParts.push(item.content.trim());
    }
  }
  return textParts.join('\n\n');
}

/**
 * Detect if text contains a valid color value (hex or RGB) and return the color string.
 * Returns null if no valid color is found.
 * Checks if the entire text is a color, or finds the first color value in the text.
 */
export function detectColor(text: string | null): string | null {
  if (!text) return null;

  const trimmed = text.trim();

  // First check if the entire text is a hex color: #RGB, #RRGGBB, #RRGGBBAA.
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  if (hexPattern.test(trimmed)) {
    return trimmed;
  }

  // Check if the entire text is RGB/RGBA: rgb(255, 87, 51) or rgba(255, 87, 51, 0.5).
  const rgbPattern = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i;
  if (rgbPattern.test(trimmed)) {
    return trimmed;
  }

  // If not the entire text, search for hex colors within the text.
  const hexInTextPattern = /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/;
  const hexMatch = trimmed.match(hexInTextPattern);
  if (hexMatch) {
    return hexMatch[0];
  }

  // Search for RGB/RGBA within the text.
  const rgbInTextPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/i;
  const rgbInTextMatch = trimmed.match(rgbInTextPattern);
  if (rgbInTextMatch) {
    return rgbInTextMatch[0];
  }

  return null;
}

/**
 * Get the image URL for an item.
 * Shared items may have imageUrl (signed URL), local items only have imageData.
 */
export function getImageUrl<T extends BaseClipboardItem>(item: T): string | null {
  // Prefer signed URL (for shared items with storage bucket).
  if (item.imageUrl) {
    return item.imageUrl;
  }
  // Fall back to base64 data URL.
  if (item.imageData) {
    return `data:image/png;base64,${item.imageData}`;
  }
  return null;
}
