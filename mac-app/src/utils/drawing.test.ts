import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDrawing, nextId, type Stroke } from '../vendor/drawesome';
import { DRAWING_DRAFT_KEY, placeImage, readDrawingDraft, restoreStrokeIds } from './drawing';
const stroke: Stroke = { id: 1, pen: 'pen', color: '#123456', size: 10, opacity: 1, points: [[10, 20, .5], [90, 60, .5]] };
beforeEach(() => localStorage.clear());
describe('drawing integration contracts', () => {
  it('keeps image and ink in one stable board coordinate system', () => {
    expect(placeImage({ dataUrl: 'image', width: 800, height: 400 }, { w: 1000, h: 800 })).toEqual({ dataUrl: 'image', width: 500, height: 250, x: 250, y: 275 });
  });
  it('restores versioned drafts and leaves legacy or unknown data untouched', () => {
    localStorage.setItem('pendingSketch', '{"elements":[{"type":"rectangle"}]}');
    localStorage.setItem(DRAWING_DRAFT_KEY, '{"version":99}');
    expect(readDrawingDraft()).toBeNull();
    expect(localStorage.getItem('pendingSketch')).toContain('rectangle');
    expect(localStorage.getItem(DRAWING_DRAFT_KEY)).toContain('99');
    const draft = { version: 1, engine: 'drawesome', strokes: [stroke], board: { w: 100, h: 100 }, paper: '#fff', timestamp: Date.now() };
    localStorage.setItem(DRAWING_DRAFT_KEY, JSON.stringify(draft));
    expect(readDrawingDraft()).toEqual(draft);
  });
  it('tracks same-count edits, erasing, undo, redo and clear in the actual engine', () => {
    const { result } = renderHook(() => useDrawing([stroke]));
    const edited = { ...stroke, color: '#ff0000' };
    act(() => result.current.commit([edited]));
    expect(result.current.strokes).toEqual([edited]);
    act(() => result.current.undo());
    expect(result.current.strokes).toEqual([stroke]);
    act(() => result.current.redo());
    expect(result.current.strokes).toEqual([edited]);
    const erase = { ...stroke, id: 2, erase: true };
    act(() => result.current.commit([edited, erase]));
    expect(result.current.strokes[1].erase).toBe(true);
    act(() => result.current.clear());
    expect(result.current.strokes).toEqual([]);
    act(() => result.current.undo());
    expect(result.current.strokes).toEqual([edited, erase]);
  });
});

it('restored stroke IDs cannot collide with newly generated upstream IDs', () => {
  const restored = restoreStrokeIds([stroke, { ...stroke, id: 2 }]);
  const added = nextId();
  expect(restored.map(s => s.id)).toEqual([-1, -2]);
  expect(restored.some(s => s.id === added)).toBe(false);
  expect(restored[0].points).toEqual(stroke.points);
  expect(stroke.id).toBe(1);
});
