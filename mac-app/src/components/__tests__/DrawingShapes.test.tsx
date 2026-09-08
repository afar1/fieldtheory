import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Draw, DrawSurface, useDrawing, type Tool, type Stroke, toSvg } from '../../vendor/drawesome';
import { shapeEndpoint, shapePath } from '../../vendor/drawesome/engine/shapes';
import { DRAWING_DRAFT_KEY, readDrawingDraft, restoreStrokeIds } from '../../utils/drawing';

const rectangle: Tool = { kind: 'pen', pen: 'pen', color: '#ff0000', size: 3, opacity: .7, shape: { primitive: 'rectangle' } };
function Harness({ tool = rectangle }: { tool?: Tool }) {
  const drawing = useDrawing();
  return <><DrawSurface className="drawing-surface" board={{ w: 100, h: 100 }} tool={tool} drawing={drawing} />
    <button onClick={drawing.undo}>Undo</button><button onClick={drawing.redo}>Redo</button>
    <output aria-label="Strokes">{JSON.stringify(drawing.strokes)}</output></>;
}
const strokes = (): Stroke[] => JSON.parse(screen.getByLabelText('Strokes').textContent!);
const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 300, height: 200 } as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('previews and commits a rectangle in board coordinates, using the release point and one undo entry', () => {
  const { container } = render(<Harness />);
  const surface = container.querySelector('.drawing-surface')!;
  fireEvent.pointerDown(surface, { ...pointer, clientX: 80, clientY: 60 });
  fireEvent.pointerMove(surface, { ...pointer, clientX: 180, clientY: 100 });
  expect(strokes()).toHaveLength(0);
  expect(surface.querySelector('path[stroke="#ff0000"]')?.getAttribute('d')).toBe('M10 20h50v20h-50Z');
  fireEvent.pointerUp(surface, { ...pointer, clientX: 220, clientY: 160 });
  expect(strokes()).toHaveLength(1);
  expect(strokes()[0]).toMatchObject({ points: [[10, 20, .5], [80, 70, .5]], shape: { primitive: 'rectangle' }, color: '#ff0000', size: 3, opacity: .7 });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(strokes()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(strokes()).toHaveLength(1);
});

it('does not save a cancelled shape or an empty click', () => {
  const { container } = render(<Harness />);
  const surface = container.querySelector('.drawing-surface')!;
  fireEvent.pointerDown(surface, { ...pointer, clientX: 80, clientY: 60 });
  fireEvent.pointerMove(surface, { ...pointer, clientX: 180, clientY: 100 });
  fireEvent.pointerCancel(surface, pointer);
  expect(strokes()).toEqual([]);
  fireEvent.pointerDown(surface, { ...pointer, clientX: 80, clientY: 60 });
  fireEvent.pointerUp(surface, { ...pointer, clientX: 80, clientY: 60 });
  expect(strokes()).toEqual([]);
});

it('keeps the chosen shape through a mid-drag tool switch', () => {
  const { container, rerender } = render(<Harness />);
  const surface = container.querySelector('.drawing-surface')!;
  fireEvent.pointerDown(surface, { ...pointer, clientX: 80, clientY: 60 });
  rerender(<Harness tool={{ kind: 'eraser', size: 20 }} />);
  fireEvent.pointerUp(surface, { ...pointer, clientX: 180, clientY: 100 });
  expect(strokes()[0]).toMatchObject({ shape: { primitive: 'rectangle' } });
  expect(strokes()[0].erase).toBeUndefined();
});

it('constrains circles and Shift squares in every drag direction and snaps Shift lines', () => {
  for (const dx of [-60, 60]) for (const dy of [-30, 30]) {
    const end = shapeEndpoint('circle', [100, 100, .5], [100 + dx, 100 + dy, .5], false);
    expect(Math.abs(end[0] - 100)).toBe(60);
    expect(Math.abs(end[1] - 100)).toBe(60);
    expect(shapeEndpoint('rectangle', [100, 100, .5], [100 + dx, 100 + dy, .5], true)).toEqual(end);
  }
  const end = shapeEndpoint('line', [0, 0, .5], [90, 4, .5], true);
  expect(end[1]).toBeCloseTo(0);
  expect(end[0]).toBeCloseTo(Math.hypot(90, 4));
});

it('preserves shapes in drafts and SVG eraser layers, with unfilled centers and the chosen paint', () => {
  const shapes: Stroke[] = (['rectangle', 'line', 'circle'] as const).map((primitive, i) => ({ id: i + 1, pen: 'pen', points: [[10, 10, .5], [80, 80, .5]], color: '#ff0000', size: 3, opacity: .7, shape: { primitive } }));
  localStorage.setItem(DRAWING_DRAFT_KEY, JSON.stringify({ version: 1, engine: 'drawesome', strokes: shapes, board: { w: 100, h: 100 }, paper: '#fff' }));
  const restored = restoreStrokeIds(readDrawingDraft()!.strokes);
  expect(restored.map(s => s.shape)).toEqual(shapes.map(s => s.shape));
  const erased = { ...shapes[0], id: 4, erase: true, shape: undefined };
  const svg = new DOMParser().parseFromString(toSvg([...restored, erased], 100, 100, null), 'image/svg+xml');
  const ink = svg.querySelectorAll('g[mask] > path');
  expect(ink).toHaveLength(3);
  ink.forEach((path, i) => {
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe('#ff0000');
    expect(path.getAttribute('stroke-opacity')).toBe('0.7');
    expect(path.getAttribute('d')).toBe(shapePath(shapes[i].shape!.primitive!, shapes[i].points));
  });
});

it('offers all three shapes and switches through shortcuts without intercepting color-field typing', () => {
  const { container } = render(<Draw shapes board={{ w: 100, h: 100 }} motion="none" />);
  fireEvent.click(screen.getByRole('button', { name: 'Shapes' }));
  for (const name of ['Rectangle', 'Line', 'Circle']) expect(screen.getByRole('button', { name })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Circle' }));
  expect(screen.getByRole('button', { name: 'Shapes' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(window, { key: 'r' });
  expect(screen.getByRole('button', { name: 'Rectangle', hidden: true }).getAttribute('aria-pressed')).toBe('true');
  const input = container.querySelector('input')!;
  fireEvent.keyDown(input, { key: 'l' });
  expect(screen.getByRole('button', { name: 'Rectangle', hidden: true }).getAttribute('aria-pressed')).toBe('true');
});
