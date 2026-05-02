/**
 * Shared utilities for inserting inline [figure N] references into transcript text.
 * Used by both TranscriberManager (standard recording) and HotMicManager.
 */

export interface FigureSegment {
  text: string;
  endMs: number;
}

export interface FigureMeta {
  figureLabel: string;
  capturedAtMs: number;
}

/**
 * Strip existing [figure X] references from text.
 */
export function stripFigureReferences(text: string): string {
  if (!text) return '';
  return text
    .replace(/\s*\[Figure\s+[A-Za-z0-9]+\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Insert [figure N] references inline into transcript text based on segment timing.
 *
 * Each screenshot is placed after the segment that was active when the screenshot
 * was captured (using endMs timing). If no segments are available, all figure
 * references are appended at the end.
 */
export function insertFigureReferencesInline(
  text: string,
  segments: FigureSegment[],
  screenshots: FigureMeta[]
): string {
  if (screenshots.length === 0) {
    return text;
  }

  const normalizedText = stripFigureReferences(text);
  const sortedScreenshots = [...screenshots].sort(
    (a, b) => a.capturedAtMs - b.capturedAtMs
  );

  const cleanSegments = segments
    .map((seg) => ({ text: stripFigureReferences(seg.text), endMs: Math.max(0, seg.endMs) }))
    .filter((seg) => seg.text.length > 0);

  // No segment timing — fall back to appending at the end.
  if (cleanSegments.length === 0) {
    const refs = sortedScreenshots.map(meta => `[figure ${meta.figureLabel}]`).join(' ');
    return [normalizedText, refs].filter(Boolean).join(' ').trim();
  }

  // Map each screenshot to the segment whose endMs is >= the screenshot's capturedAtMs.
  const segmentFigures: Map<number, string[]> = new Map();
  for (const screenshot of sortedScreenshots) {
    let segmentIndex = cleanSegments.findIndex((seg) => screenshot.capturedAtMs <= seg.endMs);
    if (segmentIndex < 0) {
      segmentIndex = cleanSegments.length - 1;
    }
    const figures = segmentFigures.get(segmentIndex) ?? [];
    figures.push(screenshot.figureLabel);
    segmentFigures.set(segmentIndex, figures);
  }

  const result = cleanSegments.map((segment, index) => {
    const figures = segmentFigures.get(index);
    if (!figures || figures.length === 0) return segment.text;
    const refs = figures.map((label) => `[figure ${label}]`).join(' ');
    return `${segment.text} ${refs}`;
  });

  return result.join(' ').trim();
}
