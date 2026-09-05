import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { createRenderedMarkdownEditorPresentationExtension } from '../MarkdownCodeEditor';
import { markdownTablesExtension, parseMarkdownTables } from '../markdownTables';

const source = 'Intro\n\n| Example | Before | After |\n| --- | :---: | ---: |\n| Small bug | **Review** | Fix it |\n| Empty | | a\\|b |\n\nEnd';
let view: EditorView | undefined;
afterEach(() => { view?.destroy(); document.body.replaceChildren(); });
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
