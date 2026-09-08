import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Stroke } from '../../vendor/drawesome';
const mocks = vi.hoisted(() => ({ strokes: [] as Stroke[], change: null as null | ((strokes: Stroke[]) => void), exportDrawing: vi.fn() }));
vi.mock('../../vendor/drawesome', async () => {
  const React = await import('react');
  return { Draw: React.forwardRef((props: any, ref) => {
    mocks.change = props.onChange;
    React.useImperativeHandle(ref, () => ({ getStrokes: () => mocks.strokes }));
    return <div>Drawing surface</div>;
  }) };
});
vi.mock('../../utils/drawing', async importOriginal => ({ ...await importOriginal<typeof import('../../utils/drawing')>(), exportDrawing: mocks.exportDrawing }));
vi.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { isDark: false } }) }));
import SketchView from '../SketchView';
const stroke: Stroke = { id: 1, pen: 'pen', color: '#000000', size: 5, opacity: 1, points: [[5, 5, .5]] };
beforeEach(() => {
  localStorage.clear();
  mocks.strokes = [];
  mocks.exportDrawing.mockResolvedValue({dataUrl:'data:image/png;base64,test',width:200,height:100});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({width:1000,height:800} as DOMRect);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('confirm', vi.fn(() => false));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function change(strokes: Stroke[]) { act(() => { mocks.strokes = strokes; mocks.change?.(strokes); }); fireEvent(window, new Event('beforeunload'));  }
it('persists same-count edits and eraser state, and undo to empty clears dirty state', () => {
  const dirty = vi.fn();
  render(<SketchView onSave={vi.fn()} onClose={vi.fn()} onHasChangesChange={dirty} />);
  change([stroke]);
  change([{...stroke, color:'#ff0000'}]);
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).toContain('#ff0000');
  change([stroke,{...stroke,id:2,erase:true}]);
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).toContain('"erase":true');
  change([]);
  expect(dirty).toHaveBeenLastCalledWith(false);
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).toBeNull();
});
it('retains the draft when the Library save callback reports failure', async () => {
  render(<SketchView onSave={async () => false} onClose={vi.fn()} />);
  change([stroke]);
  await act(async () => fireEvent.click(screen.getByRole('button',{name:'Save'})));
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).toContain('"pen"');
});
it('passes PNG dimensions and copy intent, clearing only the new draft after success', async () => {
  localStorage.setItem('pendingSketch','{"elements":[{"type":"text"}]}');
  const save = vi.fn();
  render(<SketchView onSave={save} onClose={vi.fn()} />);
  change([stroke]);
  await act(async () => fireEvent.click(screen.getByRole('button',{name:'Save & Copy'})));
  expect(save).toHaveBeenCalledWith({dataUrl:'data:image/png;base64,test',width:200,height:100},true);
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).toBeNull();
  expect(localStorage.getItem('pendingSketch')).toContain('text');
});
it('honors a cancelled Escape discard without losing draft or closing', () => {
  const close = vi.fn();
  render(<SketchView onSave={vi.fn()} onClose={close} />);
  change([stroke]);
  fireEvent.keyDown(window,{key:'Escape'});
  expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem('pendingSketch.drawesome.v1')).not.toBeNull();
});
it('normalizes a history PNG payload before exporting annotations', async () => {
  render(<SketchView existingSketch={{id:9,imageData:'aGlzdG9yeQ==',width:400,height:200}} onSave={vi.fn()} onClose={vi.fn()} />);
  change([stroke]);
  await act(async () => fireEvent.click(screen.getByRole('button',{name:'Save'})));
  expect(mocks.exportDrawing).toHaveBeenLastCalledWith([stroke],{w:1000,h:800},'#ffffff',{
    dataUrl:'data:image/png;base64,aGlzdG9yeQ==',width:400,height:200,x:300,y:300,
  },expect.any(Number));
});
