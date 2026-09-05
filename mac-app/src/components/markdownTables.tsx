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

type HorizontalBounds = { left: number; right: number };

/** Keep the table viewport inside every clipping ancestor, including split panes. */
export function tableViewportLayout(content: HorizontalBounds, viewport: HorizontalBounds) {
  const available = Math.max(0, viewport.right - viewport.left);
  const width = Math.min((content.right - content.left) * 1.6, available);
  const centered = (content.left + content.right - width) / 2;
  const left = Math.max(viewport.left, Math.min(centered, viewport.right - width));
  return { width, marginLeft: left - content.left };
}

/** Event-driven measurements only: no polling and no document-wide scroll handling. */
export function observeTableViewport(wrapper: HTMLElement, scroller: HTMLElement, content: HTMLElement) {
  const table = scroller.querySelector('table')!;
  const ancestors: HTMLElement[] = [];
  for (let parent = content.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
  let frame = 0;
  let disposed = false;
  const updateFades = () => {
    wrapper.classList.toggle('can-scroll-left', scroller.scrollLeft > 1);
    wrapper.classList.toggle('can-scroll-right', scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft > 1);
  };
  const measure = () => {
    frame = 0;
    if (disposed || !wrapper.isConnected) return;
    const contentRect = content.getBoundingClientRect();
    if (!contentRect.width) return;
    let left = 0;
    let right = document.documentElement.clientWidth;
    for (const ancestor of ancestors) {
      if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowX)) continue;
      const rect = ancestor.getBoundingClientRect();
      left = Math.max(left, rect.left + ancestor.clientLeft);
      right = Math.min(right, rect.left + ancestor.clientLeft + ancestor.clientWidth);
    }
    // Leave room for the document gutter and avoid touching the pane edges.
    const inset = Math.min(24, Math.max(0, (right - left) / 10));
    const layout = tableViewportLayout(contentRect, { left: left + inset, right: right - inset });
    wrapper.style.width = `${layout.width}px`;
    wrapper.style.marginLeft = `${layout.marginLeft}px`;
    updateFades();
  };
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(schedule);
  for (const element of [content, table, ...ancestors]) observer.observe(element);
  scroller.addEventListener('scroll', updateFades, { passive: true });
  window.addEventListener('resize', schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    scroller.removeEventListener('scroll', updateFades);
    window.removeEventListener('resize', schedule);
  };
}

const tableCleanups = new WeakMap<HTMLElement, () => void>();

class MarkdownTableWidget extends WidgetType {
  constructor(readonly table: MarkdownTable, readonly readOnly: boolean) { super(); }
  eq(other: MarkdownTableWidget) { return this.table === other.table && this.readOnly === other.readOnly; }
  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-markdown-table-viewport';
    const scroller = wrapper.appendChild(document.createElement('div'));
    scroller.className = 'cm-markdown-table-scroll';
    scroller.tabIndex = 0;
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('aria-label', 'Table, scroll horizontally to see all columns');
    scroller.addEventListener('keydown', (event) => {
      if (event.target !== scroller || event.altKey || event.metaKey || event.ctrlKey) return;
      const end = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const positions: Record<string, number> = {
        ArrowLeft: scroller.scrollLeft - 64, ArrowRight: scroller.scrollLeft + 64, Home: 0, End: end,
      };
      if (!(event.key in positions)) return;
      event.preventDefault();
      event.stopPropagation();
      scroller.scrollLeft = Math.max(0, Math.min(end, positions[event.key]));
    });
    const table = scroller.appendChild(document.createElement('table'));
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
        const cellContent = td.appendChild(document.createElement('div'));
        cellContent.className = 'cm-markdown-table-cell';
        cellContent.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{cell.text}</ReactMarkdown>);
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
    tableCleanups.set(wrapper, observeTableViewport(wrapper, scroller, view.contentDOM));
    return wrapper;
  }
  destroy(dom: HTMLElement) { tableCleanups.get(dom)?.(); tableCleanups.delete(dom); }
  ignoreEvent() { return true; }
}

const tableDecorations = EditorView.decorations.compute([markdownTableRanges, EditorState.readOnly], (state) =>
  Decoration.set(state.field(markdownTableRanges).map((table) => Decoration.replace({
    block: true, widget: new MarkdownTableWidget(table, state.readOnly),
  }).range(table.from, table.to))));

export const markdownTablesExtension = [markdownTableRanges, tableDecorations,
  EditorView.atomicRanges.of((view) => Decoration.set(view.state.field(markdownTableRanges).map((table) =>
    Decoration.replace({}).range(table.from, table.to)))), EditorView.baseTheme({
  '.cm-markdown-table-viewport': {
    position: 'relative', width: '100%', minWidth: '0', maxWidth: 'none',
    marginTop: '1em', marginBottom: '1.2em', boxSizing: 'border-box', fontSize: '0.94em',
  },
  '.cm-markdown-table-scroll': {
    width: '100%', minWidth: '0', overflowX: 'auto', overscrollBehaviorX: 'contain',
    // Flex/grid intrinsic sizing must never propagate the table width to prose.
    contain: 'inline-size', paddingBottom: '6px',
  },
  '.cm-markdown-table-scroll:focus-visible': { outline: '2px solid currentColor', outlineOffset: '3px' },
  '.cm-markdown-table-viewport.can-scroll-left .cm-markdown-table-scroll': {
    maskImage: 'linear-gradient(to right, transparent, black 24px)',
  },
  '.cm-markdown-table-viewport.can-scroll-right .cm-markdown-table-scroll': {
    maskImage: 'linear-gradient(to left, transparent, black 24px)',
  },
  '.cm-markdown-table-viewport.can-scroll-left.can-scroll-right .cm-markdown-table-scroll': {
    maskImage: 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)',
  },
  '.cm-markdown-table-scroll table': {
    display: 'table', width: 'max-content', minWidth: '100%', maxWidth: 'none', margin: '0',
    overflow: 'visible', fontSize: 'inherit', borderCollapse: 'collapse', lineHeight: '1.6',
  },
  '.cm-markdown-table-scroll th, .cm-markdown-table-scroll td': {
    whiteSpace: 'normal', overflowWrap: 'anywhere',
    padding: '0.65em 0.8em', verticalAlign: 'top',
    border: '0', borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  },
  '.cm-markdown-table-cell': { width: 'max-content', minWidth: '8em', maxWidth: '28em', whiteSpace: 'normal', overflowWrap: 'anywhere' },
  '.cm-markdown-table-scroll th': { fontWeight: '600', background: 'transparent' },
  '.cm-markdown-table-scroll p': { margin: '0', whiteSpace: 'normal' },
  '.cm-markdown-table-scroll textarea': {
    width: '100%', minHeight: '4em', boxSizing: 'border-box', font: 'inherit', color: 'inherit',
    background: 'transparent', border: '1px solid currentColor', padding: '0.2em',
  },
})];
