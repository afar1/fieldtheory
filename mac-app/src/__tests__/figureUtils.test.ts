import { describe, it, expect } from 'vitest';
import { stripFigureReferences, insertFigureReferencesInline } from '../../electron/main/figureUtils';
import type { FigureSegment, FigureMeta } from '../../electron/main/figureUtils';

describe('stripFigureReferences', () => {
  it('returns empty string for falsy input', () => {
    expect(stripFigureReferences('')).toBe('');
  });

  it('removes single figure reference', () => {
    expect(stripFigureReferences('hello [Figure 1] world')).toBe('hello world');
  });

  it('removes multiple figure references', () => {
    expect(stripFigureReferences('hello [Figure 1] world [Figure 2] end')).toBe('hello world end');
  });

  it('handles alphanumeric labels', () => {
    expect(stripFigureReferences('text [Figure abc123] more')).toBe('text more');
  });

  it('is case insensitive', () => {
    expect(stripFigureReferences('text [figure 1] [FIGURE 2] end')).toBe('text end');
  });

  it('collapses extra whitespace', () => {
    expect(stripFigureReferences('hello   [Figure 1]   world')).toBe('hello world');
  });

  it('returns text unchanged when no figures present', () => {
    expect(stripFigureReferences('just some plain text')).toBe('just some plain text');
  });
});

describe('insertFigureReferencesInline', () => {
  it('returns text unchanged when no screenshots', () => {
    expect(insertFigureReferencesInline('hello world', [], [])).toBe('hello world');
  });

  it('appends all figures at end when no segments available', () => {
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 1000 },
      { figureLabel: '2', capturedAtMs: 2000 },
    ];
    expect(insertFigureReferencesInline('hello world', [], screenshots))
      .toBe('hello world [Figure 1] [Figure 2]');
  });

  it('places figure after the segment active during capture', () => {
    const segments: FigureSegment[] = [
      { text: 'first segment', endMs: 3000 },
      { text: 'second segment', endMs: 6000 },
      { text: 'third segment', endMs: 9000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 2000 }, // during first segment
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first segment [Figure 1] second segment third segment');
  });

  it('places figure in second segment based on timing', () => {
    const segments: FigureSegment[] = [
      { text: 'first segment', endMs: 3000 },
      { text: 'second segment', endMs: 6000 },
      { text: 'third segment', endMs: 9000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 4500 }, // during second segment
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first segment second segment [Figure 1] third segment');
  });

  it('places multiple figures in different segments', () => {
    const segments: FigureSegment[] = [
      { text: 'first segment', endMs: 3000 },
      { text: 'second segment', endMs: 6000 },
      { text: 'third segment', endMs: 9000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 1000 }, // first segment
      { figureLabel: '2', capturedAtMs: 5000 }, // second segment
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first segment [Figure 1] second segment [Figure 2] third segment');
  });

  it('groups multiple figures in same segment', () => {
    const segments: FigureSegment[] = [
      { text: 'first segment', endMs: 5000 },
      { text: 'second segment', endMs: 10000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 1000 },
      { figureLabel: '2', capturedAtMs: 3000 },
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first segment [Figure 1] [Figure 2] second segment');
  });

  it('attaches late screenshot to last segment', () => {
    const segments: FigureSegment[] = [
      { text: 'first', endMs: 3000 },
      { text: 'second', endMs: 6000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 99000 }, // way after all segments
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first second [Figure 1]');
  });

  it('strips pre-existing figure references from text and segments', () => {
    const segments: FigureSegment[] = [
      { text: 'first [Figure 1] segment', endMs: 3000 },
      { text: 'second segment', endMs: 6000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 2000 },
    ];
    expect(insertFigureReferencesInline('original [Figure 1] text', segments, screenshots))
      .toBe('first segment [Figure 1] second segment');
  });

  it('sorts screenshots by capture time regardless of input order', () => {
    const segments: FigureSegment[] = [
      { text: 'first', endMs: 3000 },
      { text: 'second', endMs: 6000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '2', capturedAtMs: 5000 },
      { figureLabel: '1', capturedAtMs: 1000 },
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('first [Figure 1] second [Figure 2]');
  });

  it('filters out empty segments', () => {
    const segments: FigureSegment[] = [
      { text: '', endMs: 1000 },
      { text: 'real segment', endMs: 5000 },
      { text: '  ', endMs: 8000 },
    ];
    const screenshots: FigureMeta[] = [
      { figureLabel: '1', capturedAtMs: 3000 },
    ];
    expect(insertFigureReferencesInline('ignored', segments, screenshots))
      .toBe('real segment [Figure 1]');
  });
});
