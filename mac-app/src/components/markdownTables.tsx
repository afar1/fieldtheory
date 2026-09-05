import { EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { parser, Table } from '@lezer/markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const tableParser = parser.configure(Table);
type Cell = { from: number; to: number; text: string };
type MarkdownTable = { from: number; to: number; rows: Cell[][]; align: string[] };

export function parseMarkdownTables(source: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  tableParser.parse(source).iterate({
    enter(node) {
      if (node.name !== 'Table') return;
      // Nested tables need their container's indentation and layout preserved.
      if (node.node.parent?.name !== 'Document') return false;
      const rows: Cell[][] = [];
      let align: string[] = [];
      for (let row = node.node.firstChild; row; row = row.nextSibling) {
        if (row.name === 'TableDelimiter') {
          align = source.slice(row.from, row.to).trim().replace(/^\||\|$/g, '').split('|').map((cell) => {
            const value = cell.trim();
            return value.endsWith(':') ? (value.startsWith(':') ? 'center' : 'right') : 'left';
          });
          continue;
        }
        const delimiters: number[] = [];
        for (let child = row.firstChild; child; child = child.nextSibling) {
          if (child.name === 'TableDelimiter') delimiters.push(child.from);
        }
        const starts = [row.from, ...delimiters.map((position) => position + 1)];
        const ends = [...delimiters, row.to];
        const cells = starts.map((from, index) => {
          const text = source.slice(from, ends[index]);
          const leading = text.length - text.trimStart().length;
          return { from: from + leading, to: from + leading + text.trim().length, text: text.trim() };
        });
        if (delimiters[0] === row.from) cells.shift();
        if (delimiters.at(-1) === row.to - 1) cells.pop();
        rows.push(cells);
      }
      tables.push({ from: node.from, to: node.to, rows, align });
      return false;
    },
  });
  return tables;
}

export const markdownTableRanges = StateField.define<MarkdownTable[]>({
  create: (state) => parseMarkdownTables(state.doc.toString()),
  update: (tables, transaction) => transaction.docChanged ? parseMarkdownTables(transaction.newDoc.toString()) : tables,
});

class MarkdownTableWidget extends WidgetType {
  constructor(readonly table: MarkdownTable, readonly readOnly: boolean) { super(); }
  eq(other: MarkdownTableWidget) { return this.table === other.table && this.readOnly === other.readOnly; }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-markdown-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Table, horizontally scrollable');
    const table = wrapper.appendChild(document.createElement('table'));
    const head = table.appendChild(document.createElement('thead'));
    const body = table.appendChild(document.createElement('tbody'));
    this.table.rows.forEach((row, rowIndex) => {
      const tr = (rowIndex === 0 ? head : body).appendChild(document.createElement('tr'));
      this.table.rows[0].forEach((_, columnIndex) => {
        const cell = row[columnIndex];
        const td = tr.appendChild(document.createElement(rowIndex === 0 ? 'th' : 'td'));
        if (rowIndex === 0) td.setAttribute('scope', 'col');
        td.style.textAlign = this.table.align[columnIndex] || 'left';
        if (!cell) return;
        td.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{cell.text}</ReactMarkdown>);
        if (this.readOnly) return;
        td.tabIndex = 0;
        td.title = 'Double-click or press Enter to edit';
        td.setAttribute('aria-label', `Edit row ${rowIndex + 1}, column ${columnIndex + 1}`);
        const edit = () => {
          if (td.querySelector('textarea')) return;
          const original = td.innerHTML;
          const originalDoc = view.state.doc;
          const input = document.createElement('textarea');
          input.value = cell.text;
          input.setAttribute('aria-label', td.getAttribute('aria-label')!);
          td.replaceChildren(input);
          input.focus();
          let finished = false;
          const finish = (save: boolean) => {
            if (finished) return;
            finished = true;
            // A synchronous external document update may have removed this widget.
            if (save && !view.state.readOnly && view.state.doc === originalDoc) {
              const insert = input.value.replace(/\r?\n/g, ' ').replace(/(\\*)\|/g, (match, slashes: string) => slashes.length % 2 === 0 ? `${slashes}\\|` : match);
              if (insert !== cell.text) {
                view.dispatch({ changes: { from: cell.from, to: cell.to, insert }, userEvent: 'input' });
                return;
              }
            }
            td.innerHTML = original;
          };
          input.addEventListener('blur', () => finish(true));
          input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Escape' || (event.key === 'Enter' && !event.isComposing)) {
              event.preventDefault();
              finish(event.key === 'Enter');
              if (td.isConnected) td.focus();
              else view.focus();
            }
          });
        };
        td.addEventListener('dblclick', edit);
        td.addEventListener('keydown', (event) => {
          if (event.target === td && event.key === 'Enter') { event.preventDefault(); edit(); }
        });
      });
    });
    return wrapper;
  }
  ignoreEvent() { return true; }
}

const tableDecorations = EditorView.decorations.compute([markdownTableRanges, EditorState.readOnly], (state) =>
  Decoration.set(state.field(markdownTableRanges).map((table) => Decoration.replace({
    block: true, widget: new MarkdownTableWidget(table, state.readOnly),
  }).range(table.from, table.to))));

export const markdownTablesExtension = [markdownTableRanges, tableDecorations,
  EditorView.atomicRanges.of((view) => Decoration.set(view.state.field(markdownTableRanges).map((table) =>
    Decoration.replace({}).range(table.from, table.to)))), EditorView.baseTheme({
  '.cm-markdown-table-scroll': {
    width: 'min(120%, calc(100vw - 48px))', marginLeft: 'max(-10%, calc((100% - 100vw + 48px) / 2))', marginTop: '1em', marginBottom: '1.2em',
    overflowX: 'auto', boxSizing: 'border-box', fontSize: '0.94em',
  },
  '.cm-markdown-table-scroll table': { display: 'table', width: '100%', margin: '0', overflow: 'visible', fontSize: 'inherit', borderCollapse: 'collapse', lineHeight: '1.6' },
  '.cm-markdown-table-scroll th, .cm-markdown-table-scroll td': {
    minWidth: '10em', padding: '0.65em 0.8em', verticalAlign: 'top',
    border: '0', borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  },
  '.cm-markdown-table-scroll th': { fontWeight: '600', background: 'transparent' },
  '.cm-markdown-table-scroll p': { margin: '0' },
  '.cm-markdown-table-scroll textarea': {
    width: '100%', minHeight: '4em', boxSizing: 'border-box', font: 'inherit', color: 'inherit',
    background: 'transparent', border: '1px solid currentColor', padding: '0.2em',
  },
  '@media (max-width: 700px)': { '.cm-markdown-table-scroll': { width: '100%', marginLeft: '0' } },
})];
