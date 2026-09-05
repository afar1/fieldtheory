import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { createRenderedMarkdownEditorPresentationExtension } from '../MarkdownCodeEditor';
import { markdownTablesExtension, parseMarkdownTables, tableViewportLayout, observeTableViewport } from '../markdownTables';

const source = 'Intro\n\n| Example | Before | After |\n| --- | :---: | ---: |\n| Small bug | **Review** | Fix it |\n| Empty | | a\\|b |\n\nEnd';
let view: EditorView | undefined;
afterEach(() => { view?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(readOnly = false) {
  view = new EditorView({ parent: document.body, state: EditorState.create({
    doc: source, extensions: [history(), markdownTablesExtension, createRenderedMarkdownEditorPresentationExtension(), EditorState.readOnly.of(readOnly)],
  }) });
  return view;
}

describe('native Markdown tables', () => {
  it('parses alignment, empty cells, escaped pipes and exact edit ranges', () => {
    const [table] = parseMarkdownTables(source);
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows[2].map((cell) => cell.text)).toEqual(['Empty', '', 'a\\|b']);
    for (const row of table.rows) for (const cell of row) expect(source.slice(cell.from, cell.to)).toBe(cell.text);
  });
  it('ignores fenced examples and plain pipe-separated prose', () => {
    expect(parseMarkdownTables('```md\n' + source + '\n```')).toEqual([]);
    expect(parseMarkdownTables('A | B\ntext | more')).toEqual([]);
  });
  it('renders semantic rows and inline formatting without changing the document', () => {
    const editor = mount();
    expect(document.querySelectorAll('th')).toHaveLength(3);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.querySelector('strong')?.textContent).toBe('Review');
    expect(document.querySelectorAll('td')[1].style.textAlign).toBe('center');
    expect(editor.state.doc.toString()).toBe(source);
  });
  it('lets keyboard users reach both ends without moving the editor selection', () => {
    const editor = mount(true);
    const scroller = document.querySelector<HTMLElement>('.cm-markdown-table-scroll')!;
    Object.defineProperty(scroller, 'scrollWidth', { value: 1600 });
    Object.defineProperty(scroller, 'clientWidth', { value: 900 });
    const initialSelection = editor.state.selection;
    for (const [key, expected] of [['ArrowRight', 64], ['End', 700], ['ArrowRight', 700], ['Home', 0], ['ArrowLeft', 0]] as const) {
      scroller.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      expect(scroller.scrollLeft).toBe(expected);
      expect(editor.state.selection).toBe(initialSelection);
    }
  });
  it('edits one cell, escapes pipes and preserves undo', () => {
    const editor = mount();
    document.querySelector('td')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('textarea')!;
    input.value = 'A | B';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor.state.doc.toString()).toBe(source.replace('Small bug', 'A \\| B'));
    expect(undo(editor)).toBe(true);
    expect(editor.state.doc.toString()).toBe(source);
  });
  it('keeps the header column count for uneven rows', () => {
    const editor = mount();
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'A | B\n--- | ---\nx\ny | z | extra' } });
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.querySelectorAll('tbody td')).toHaveLength(4);
    expect(document.querySelector('table')!.textContent).not.toContain('extra');
  });
  it('supports keyboard editing, cancellation and read-only tables', () => {
    const editor = mount();
    const cell = document.querySelector('td')!;
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const input = document.querySelector('textarea')!;
    input.value = 'Discard';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(editor.state.doc.toString()).toBe(source);
    editor.destroy();
    document.body.replaceChildren();
    mount(true);
    document.querySelector('td')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(document.querySelector('textarea')).toBeNull();
  });
});


describe('table viewport containment', () => {
  it('uses wider pane space without extending either edge outside the pane', () => {
    expect(tableViewportLayout({ left: 400, right: 1200 }, { left: 24, right: 1576 }))
      .toEqual({ width: 1280, marginLeft: -240 });
    // Split pane / sidebar: respect the actual pane, not 100vw.
    expect(tableViewportLayout({ left: 600, right: 1200 }, { left: 524, right: 1276 }))
      .toEqual({ width: 752, marginLeft: -76 });
    const narrow = tableViewportLayout({ left: 80, right: 420 }, { left: 24, right: 376 });
    expect(narrow.width).toBe(352);
    expect(80 + narrow.marginLeft).toBe(24);
  });

  it('measures clipping ancestors, updates only table fades, and disconnects on removal', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    let resized: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect = disconnect;
    });
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1800);
    const pane = document.body.appendChild(document.createElement('div'));
    pane.style.overflowX = 'hidden';
    pane.style.overflowY = 'auto';
    const content = pane.appendChild(document.createElement('div'));
    const wrapper = content.appendChild(document.createElement('div'));
    const scroller = wrapper.appendChild(document.createElement('div'));
    scroller.appendChild(document.createElement('table'));
    let paneWidth = 1000;
    let viewportWidth = 952;
    Object.defineProperty(pane, 'clientWidth', { get: () => paneWidth });
    Object.defineProperty(scroller, 'clientWidth', { get: () => viewportWidth });
    Object.defineProperty(scroller, 'scrollWidth', { get: () => 1400 });
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ left: 400, right: 1400, width: 1000 } as DOMRect);
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ left: 500, right: 1300, width: 800 } as DOMRect);
    const cleanup = observeTableViewport(wrapper, scroller, content);
    callbacks.shift()!(0);
    expect(wrapper.style.width).toBe('952px');
    expect(wrapper.style.marginLeft).toBe('-76px');
    expect(wrapper.classList.contains('can-scroll-left')).toBe(false);
    expect(wrapper.classList.contains('can-scroll-right')).toBe(true);
    scroller.scrollLeft = 100;
    scroller.dispatchEvent(new Event('scroll'));
    expect(wrapper.classList.contains('can-scroll-left')).toBe(true);
    expect(wrapper.classList.contains('can-scroll-right')).toBe(true);
    scroller.scrollLeft = 448;
    scroller.dispatchEvent(new Event('scroll'));
    expect(wrapper.classList.contains('can-scroll-right')).toBe(false);
    expect(pane.scrollLeft).toBe(0);
    expect(content.style.width).toBe('');
    paneWidth = 600;
    viewportWidth = 552;
    resized();
    callbacks.shift()!(0);
    expect(wrapper.style.width).toBe('552px');
    expect(wrapper.classList.contains('can-scroll-right')).toBe(true);
    viewportWidth = 1400;
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(wrapper.className).toBe('');
    scroller.scrollLeft = 1;
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(wrapper.classList.contains('can-scroll-left')).toBe(false);
    resized();
    expect(callbacks).toHaveLength(0);
  });
});
