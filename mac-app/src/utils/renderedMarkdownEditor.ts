import { parseMarkdownFrontmatter } from '../../electron/shared/markdownFrontmatter';

export type RenderedMarkdownTextEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

export type RenderedMarkdownSourceRange = {
  start: number;
  end: number;
};

export type RenderedTextNodeSourceRange = {
  node: Text;
  text: string;
  start: number;
  end: number;
  synthetic?: 'blank-line';
};

export type RenderedCaretGeometry = {
  left: number;
  top: number;
  height: number;
  sourceOffset: number;
  domSourceOffset: number | null;
  approximate: boolean;
  restoreTarget: 'exact' | 'previous-boundary' | 'next-boundary' | 'rendered-offset';
  sourceDistance: number | null;
  targetSourceStart: number | null;
  targetSourceEnd: number | null;
  targetRenderedOffset: number;
};

export type RenderedPointCaret = {
  sourceOffset: number;
  selection: Record<string, unknown>;
};

export type RenderedEditorDebugEntry = {
  timestamp: number;
  stage: string;
  path: string | null;
  contentMode: 'rendered' | 'markdown';
  editingActive: boolean;
  scrollTop: number | null;
  details: Record<string, unknown>;
};

export type RenderedEditorDebugApi = {
  enable: () => void;
  disable: () => void;
  isEnabled: () => boolean;
  state: () => Record<string, unknown>;
  cursor: () => Record<string, unknown>;
  markdownCursor: () => Record<string, unknown>;
  renderedCursor: () => Record<string, unknown>;
  snapshot: () => RenderedEditorDebugEntry[];
  last: () => RenderedEditorDebugEntry | null;
  clear: () => void;
  mark: (label?: string) => RenderedEditorDebugEntry | null;
  root: () => HTMLDivElement | null;
};

export const RENDERED_EDITOR_DEBUG_STORAGE_KEY = 'fieldtheory-rendered-editor-debug';
export const RENDERED_EDITOR_DEBUG_ENTRY_LIMIT = 80;
export const RENDERED_BLANK_LINE_ATTR = 'data-ft-rendered-blank-line';
export const RENDERED_TRAILING_SPACE_ATTR = 'data-ft-rendered-trailing-space';
const MARKDOWN_SOURCE_SYNTAX_CHAR = /[*_`#>\[\]()]/;
const RENDERED_BLANK_LINE_PLACEHOLDER = '\u00A0';
const RENDERED_BLANK_LINE_PLACEHOLDER_PATTERN = /^\u00A0+$/;

export function getRenderedBeforeInputData(input: {
  data?: string | null;
  dataTransferText?: string | null;
  fallbackKey?: string | null;
}): string | null {
  if (input.data) return input.data;
  if (input.dataTransferText) return input.dataTransferText;
  return input.fallbackKey && input.fallbackKey.length === 1 ? input.fallbackKey : null;
}

export function getRenderedBeforeInputType(input: {
  inputType?: string | null;
  data?: string | null;
  key?: string | null;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string | null {
  if (input.inputType) return input.inputType;
  if (input.key === 'Backspace') {
    if (input.metaKey) return 'deleteHardLineBackward';
    if (input.altKey) return 'deleteWordBackward';
    return 'deleteContentBackward';
  }
  if (input.key === 'Delete') {
    if (input.metaKey) return 'deleteHardLineForward';
    if (input.altKey) return 'deleteWordForward';
    return 'deleteContentForward';
  }
  if (input.key === 'Enter') return input.shiftKey ? 'insertLineBreak' : 'insertParagraph';
  if (input.key && input.key.length === 1) return 'insertText';
  if (input.data !== null && input.data !== undefined) {
    return input.data === '\n' ? 'insertParagraph' : 'insertText';
  }
  return null;
}

export function isGeneratedRenderedWhitespaceText(text: unknown): boolean {
  return typeof text === 'string'
    && (RENDERED_BLANK_LINE_PLACEHOLDER_PATTERN.test(text) || /^[\r\n]+$/.test(text));
}

export function isRenderedDeleteInputType(inputType: string | null): boolean {
  return !!inputType && inputType.startsWith('delete');
}

export function shouldUseRenderedSourceCaretFallback(selection: Record<string, unknown>): boolean {
  if (selection.exists !== true) return false;
  if (selection.rangeCount === 0) return true;
  return selection.rangeCount === 1
    && selection.isCollapsed === true
    && (
      selection.startNodeType !== 3
      || selection.endNodeType !== 3
      || isGeneratedRenderedWhitespaceText(selection.startText)
      || isGeneratedRenderedWhitespaceText(selection.endText)
    );
}

export function shouldHandleRenderedKeyDownEdit(input: {
  inputType: string | null,
  selection: Record<string, unknown> | null,
  metaKey?: boolean,
  ctrlKey?: boolean,
  altKey?: boolean,
  isComposing?: boolean,
}): boolean {
  if (!input.inputType || !input.selection || input.isComposing) return false;
  if (input.inputType === 'insertText') {
    return false;
  }
  if (isRenderedDeleteInputType(input.inputType)) {
    return !input.ctrlKey;
  }
  return !input.metaKey && !input.ctrlKey && !input.altKey;
}

export function shouldUseRenderedNativeTextInsertion(input: {
  inputType: string | null;
  data?: string | null;
  selection: Record<string, unknown> | null;
}): boolean {
  const { inputType, data, selection } = input;
  if (inputType !== 'insertText' || typeof data !== 'string' || data.length !== 1) return false;
  if (data === '\r' || data === '\n' || isMarkdownSourceSyntaxChar(data)) return false;
  return selection?.exists === true
    && selection.inRoot === true
    && selection.rangeCount === 1
    && selection.isCollapsed === true
    && selection.sameNode === true
    && selection.startNodeType === 3
    && selection.endNodeType === 3
    && !isGeneratedRenderedWhitespaceText(selection.startText)
    && !isGeneratedRenderedWhitespaceText(selection.endText);
}

function isEditableRenderedTextNode(node: Node): boolean {
  const text = node.textContent ?? '';
  if (!text) return false;
  const parent = node.parentElement;
  if (parent?.closest(`[${RENDERED_BLANK_LINE_ATTR}="true"]`)) {
    return RENDERED_BLANK_LINE_PLACEHOLDER_PATTERN.test(text)
      && !parent.closest('script, style, mark, [contenteditable="false"]');
  }
  if (isGeneratedRenderedWhitespaceText(text) && !parent?.closest(`[${RENDERED_TRAILING_SPACE_ATTR}="true"]`)) return false;
  return !!parent && !parent.closest('script, style, mark, [contenteditable="false"]');
}

function isMarkdownSourceSyntaxChar(char: string | undefined): boolean {
  return !!char && MARKDOWN_SOURCE_SYNTAX_CHAR.test(char);
}

function getLineDeleteBackwardStart(value: string, minimumStart: number, sourceStart: number): number {
  const previousLineBreak = value.lastIndexOf('\n', Math.max(minimumStart, sourceStart - 1));
  return Math.max(minimumStart, previousLineBreak + 1);
}

function getLineDeleteForwardEnd(value: string, maximumEnd: number, sourceEnd: number): number {
  const nextLineBreak = value.indexOf('\n', sourceEnd);
  return nextLineBreak >= 0 ? Math.min(maximumEnd, nextLineBreak) : maximumEnd;
}

function getRenderedMarkdownSource(markdown: string): { body: string; bodyStart: number } {
  const parsed = parseMarkdownFrontmatter(markdown);
  if (parsed.raw === null) return { body: markdown, bodyStart: 0 };
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!frontmatter) return { body: markdown, bodyStart: 0 };
  let offset = frontmatter[0].length;
  while (markdown[offset] === '\n') offset += 1;
  return {
    body: parsed.body,
    bodyStart: Math.min(offset, markdown.length),
  };
}

function isNormalizedCarrotListLine(line: string): boolean {
  return line.trimStart().startsWith('- \u2060');
}

function getRenderedMarkdownBlankLineSourceRanges(markdown: string): RenderedMarkdownSourceRange[] {
  const { body, bodyStart } = getRenderedMarkdownSource(markdown);
  const ranges: RenderedMarkdownSourceRange[] = [];
  const lines = body.split('\n');
  let offset = 0;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineStart = offset;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      offset += line.length + 1;
      continue;
    }

    if (
      !inFence
      && line.trim() === ''
      && !isNormalizedCarrotListLine(lines[index - 1] ?? '')
      && !isNormalizedCarrotListLine(lines[index + 1] ?? '')
    ) {
      ranges.push({
        start: bodyStart + lineStart,
        end: bodyStart + lineStart + line.length,
      });
    }

    offset += line.length + 1;
  }

  return ranges;
}

function getRenderedMarkdownTextInputEditForSourceRange(
  markdown: string,
  sourceRange: { start: number; end: number },
  renderedTextLength: number,
  renderedSelectionStart: number,
  renderedSelectionEnd: number,
  inputType: string,
  data?: string | null,
): RenderedMarkdownTextEdit | null {
  const { bodyStart } = getRenderedMarkdownSource(markdown);
  const renderedStart = Math.max(0, Math.min(renderedSelectionStart, renderedTextLength));
  const renderedEnd = Math.max(renderedStart, Math.min(renderedSelectionEnd, renderedTextLength));
  let sourceStart = sourceRange.start + renderedStart;
  let sourceEnd = sourceRange.start + renderedEnd;
  let insert = '';

  if (inputType === 'insertText') {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'insertCompositionText') {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'insertReplacementText') {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'insertParagraph') {
    insert = '\n';
  } else if (inputType === 'insertLineBreak') {
    insert = '\n';
  } else if (inputType === 'insertFromPaste') {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'insertFromDrop') {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'deleteContentBackward') {
    if (sourceStart === sourceEnd) {
      if (renderedStart <= 0) {
        if (sourceStart <= bodyStart || markdown[sourceStart - 1] !== '\n') return null;
        sourceStart -= 1;
      } else {
        sourceStart -= 1;
      }
    }
  } else if (inputType === 'deleteWordBackward') {
    if (sourceStart === sourceEnd) {
      if (renderedStart <= 0) return null;
      sourceStart = getWordDeleteBackwardStart(markdown, sourceRange.start, sourceStart);
    }
  } else if (inputType === 'deleteHardLineBackward' || inputType === 'deleteSoftLineBackward') {
    if (sourceStart === sourceEnd) {
      const nextStart = getLineDeleteBackwardStart(markdown, sourceRange.start, sourceStart);
      if (nextStart < sourceStart) {
        sourceStart = nextStart;
      } else {
        if (sourceStart <= sourceRange.start) return null;
        sourceStart -= 1;
      }
    }
  } else if (inputType === 'deleteContentForward') {
    if (sourceStart === sourceEnd) {
      if (renderedStart >= renderedTextLength) return null;
      sourceEnd += 1;
    }
  } else if (inputType === 'deleteWordForward') {
    if (sourceStart === sourceEnd) {
      if (renderedStart >= renderedTextLength) return null;
      while (sourceEnd < sourceRange.end && /\s/.test(markdown[sourceEnd] ?? '')) sourceEnd += 1;
      while (sourceEnd < sourceRange.end && !/\s/.test(markdown[sourceEnd] ?? '')) sourceEnd += 1;
    }
  } else if (inputType === 'deleteHardLineForward' || inputType === 'deleteSoftLineForward') {
    if (sourceStart === sourceEnd) {
      const nextEnd = getLineDeleteForwardEnd(markdown, sourceRange.end, sourceEnd);
      if (nextEnd > sourceEnd) {
        sourceEnd = nextEnd;
      } else {
        if (sourceEnd >= sourceRange.end) return null;
        sourceEnd += 1;
      }
    }
  } else if (inputType === 'deleteByCut' || inputType === 'deleteContent') {
    if (sourceStart === sourceEnd) return null;
  } else {
    return null;
  }

  const nextValue = `${markdown.slice(0, sourceStart)}${insert}${markdown.slice(sourceEnd)}`;
  const selection = sourceStart + insert.length;
  return {
    nextValue,
    selectionStart: selection,
    selectionEnd: selection,
  };
}

export function getRenderedMarkdownTextNodeSourceRanges(root: HTMLElement, markdown: string): RenderedTextNodeSourceRange[] {
  const { body, bodyStart } = getRenderedMarkdownSource(markdown);
  const blankLineRanges = getRenderedMarkdownBlankLineSourceRanges(markdown);
  let blankLineRangeIndex = 0;
  const ranges: RenderedTextNodeSourceRange[] = [];
  let searchFrom = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isEditableRenderedTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const text = textNode.textContent ?? '';
    const blankLine = textNode.parentElement?.closest(`[${RENDERED_BLANK_LINE_ATTR}="true"]`);
    if (blankLine) {
      const blankLineRange = blankLineRanges[blankLineRangeIndex];
      blankLineRangeIndex += 1;
      if (blankLineRange) {
        ranges.push({
          node: textNode,
          text,
          start: blankLineRange.start,
          end: blankLineRange.end,
          synthetic: 'blank-line',
        });
      }
      node = walker.nextNode();
      continue;
    }
    const sourceText = text.replace(/\u00A0/g, ' ');
    let sourceIndex = body.indexOf(sourceText, searchFrom);
    if (sourceIndex < 0) {
      sourceIndex = body.indexOf(sourceText);
    }
    if (sourceIndex >= 0) {
      ranges.push({
        node: textNode,
        text,
        start: bodyStart + sourceIndex,
        end: bodyStart + sourceIndex + sourceText.length,
      });
      searchFrom = sourceIndex + sourceText.length;
    }
    node = walker.nextNode();
  }
  return ranges;
}

function getEditableRenderedTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return isEditableRenderedTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

type RenderedSelectionBoundary = {
  offset: number;
  textRange: RenderedTextNodeSourceRange | null;
  textOffset: number | null;
};

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function getRenderedBlankLineSourceOffset(
  textRange: RenderedTextNodeSourceRange,
  renderedOffset: number,
): number {
  const sourceLength = Math.max(0, textRange.end - textRange.start);
  return textRange.start + Math.max(0, Math.min(renderedOffset, textRange.text.length, sourceLength));
}

export function resolveMarkdownCaretOffsetFromRenderedTextNode(
  root: HTMLElement,
  markdown: string,
  node: Text,
  renderedOffset: number,
): number | null {
  const sourceRange = getRenderedMarkdownTextNodeSourceRanges(root, markdown)
    .find((candidate) => candidate.node === node);
  if (!sourceRange) return null;
  if (sourceRange.synthetic === 'blank-line') return getRenderedBlankLineSourceOffset(sourceRange, renderedOffset);
  return sourceRange.start + Math.max(0, Math.min(renderedOffset, sourceRange.text.length));
}

function findTextRangeForNode(
  ranges: RenderedTextNodeSourceRange[],
  node: Node,
): RenderedTextNodeSourceRange | null {
  return ranges.find((candidate) => candidate.node === node) ?? null;
}

function firstTextRangeInNode(
  ranges: RenderedTextNodeSourceRange[],
  node: Node,
): RenderedTextNodeSourceRange | null {
  return ranges.find((candidate) => node.contains(candidate.node)) ?? null;
}

function lastTextRangeInNode(
  ranges: RenderedTextNodeSourceRange[],
  node: Node,
): RenderedTextNodeSourceRange | null {
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const candidate = ranges[index];
    if (node.contains(candidate.node)) return candidate;
  }
  return null;
}

function resolveElementBoundary(
  ranges: RenderedTextNodeSourceRange[],
  container: Element,
  offset: number,
  edge: 'start' | 'end',
): RenderedSelectionBoundary | null {
  const children = Array.from(container.childNodes);
  if (edge === 'start') {
    for (let index = offset; index < children.length; index += 1) {
      const textRange = firstTextRangeInNode(ranges, children[index]);
      if (textRange) return { offset: textRange.start, textRange, textOffset: 0 };
    }
    const previous = lastTextRangeInNode(ranges, container);
    return previous ? { offset: previous.end, textRange: previous, textOffset: previous.text.length } : null;
  }

  for (let index = offset - 1; index >= 0; index -= 1) {
    const textRange = lastTextRangeInNode(ranges, children[index]);
    if (textRange) return { offset: textRange.end, textRange, textOffset: textRange.text.length };
  }
  const next = firstTextRangeInNode(ranges, container);
  return next ? { offset: next.start, textRange: next, textOffset: 0 } : null;
}

function resolveRenderedSelectionBoundary(
  ranges: RenderedTextNodeSourceRange[],
  container: Node,
  offset: number,
  edge: 'start' | 'end',
): RenderedSelectionBoundary | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const textRange = findTextRangeForNode(ranges, container);
    if (!textRange) return null;
    if (textRange.synthetic === 'blank-line') {
      const sourceOffset = getRenderedBlankLineSourceOffset(textRange, offset);
      return {
        offset: sourceOffset,
        textRange,
        textOffset: sourceOffset - textRange.start,
      };
    }
    const textOffset = Math.max(0, Math.min(offset, textRange.text.length));
    return {
      offset: textRange.start + textOffset,
      textRange,
      textOffset,
    };
  }

  if (container instanceof Element) {
    return resolveElementBoundary(ranges, container, offset, edge);
  }

  return null;
}

function getRenderedTextOffsetFromTextNode(
  root: HTMLElement,
  node: Text,
  offset: number,
): number | null {
  let renderedOffset = 0;
  for (const textNode of getEditableRenderedTextNodes(root)) {
    const textLength = textNode.textContent?.length ?? 0;
    if (textNode === node) {
      return renderedOffset + Math.max(0, Math.min(offset, textLength));
    }
    renderedOffset += textLength;
  }
  return null;
}

function getRenderedTextOffsetFromElementBoundary(
  root: HTMLElement,
  container: Element,
  offset: number,
): number | null {
  let renderedOffset = 0;
  const boundary = Array.from(container.childNodes)[offset] ?? null;
  for (const textNode of getEditableRenderedTextNodes(root)) {
    if (boundary && boundary.contains(textNode)) return renderedOffset;
    if (container === root && boundary && (boundary.compareDocumentPosition(textNode) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      return renderedOffset;
    }
    if (container.contains(textNode)) {
      const childNodes = Array.from(container.childNodes);
      const childIndex = childNodes.findIndex((child) => child.contains(textNode));
      if (childIndex >= offset) return renderedOffset;
    }
    renderedOffset += textNode.textContent?.length ?? 0;
  }
  return renderedOffset;
}

function mapRenderedTextOffsetToMarkdownOffset(markdown: string, renderedOffset: number): number | null {
  const { body, bodyStart } = getRenderedMarkdownSource(markdown);
  const target = Math.max(0, renderedOffset);
  let renderedCount = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (isMarkdownSourceSyntaxChar(body[index])) {
      if (renderedCount === target && index > 0 && !isMarkdownSourceSyntaxChar(body[index - 1])) {
        return bodyStart + index;
      }
      continue;
    }
    if (renderedCount === target) return bodyStart + index;
    renderedCount += 1;
  }
  return target <= renderedCount ? bodyStart + body.length : null;
}

function mapMarkdownOffsetToRenderedTextOffset(markdown: string, sourceOffset: number): number {
  const { body, bodyStart } = getRenderedMarkdownSource(markdown);
  const bodyOffset = Math.max(0, Math.min(sourceOffset - bodyStart, body.length));
  let renderedCount = 0;
  for (let index = 0; index < bodyOffset; index += 1) {
    if (!isMarkdownSourceSyntaxChar(body[index])) {
      renderedCount += 1;
    }
  }
  return renderedCount;
}

function getRenderedTextNodeAtRenderedOffset(
  root: HTMLElement,
  renderedOffset: number,
): { node: Text; offset: number } | null {
  const textNodes = getEditableRenderedTextNodes(root);
  let remaining = Math.max(0, renderedOffset);
  for (const node of textNodes) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  const last = textNodes[textNodes.length - 1];
  return last ? { node: last, offset: last.textContent?.length ?? 0 } : null;
}

function resolveRenderedSelectionBoundaryFallback(
  root: HTMLElement,
  markdown: string,
  container: Node,
  offset: number,
): RenderedSelectionBoundary | null {
  let renderedOffset: number | null = null;
  if (container.nodeType === Node.TEXT_NODE) {
    renderedOffset = getRenderedTextOffsetFromTextNode(root, container as Text, offset);
  } else if (container instanceof Element) {
    renderedOffset = getRenderedTextOffsetFromElementBoundary(root, container, offset);
  }
  if (renderedOffset === null) return null;
  const sourceOffset = mapRenderedTextOffsetToMarkdownOffset(markdown, renderedOffset);
  return sourceOffset === null ? null : { offset: sourceOffset, textRange: null, textOffset: null };
}

function getWordDeleteBackwardStart(value: string, bodyStart: number, sourceStart: number): number {
  let index = sourceStart;
  const startedAfterWhitespace = /\s/.test(value[index - 1] ?? '');
  const shouldRemovePreviousSeparator = startedAfterWhitespace && !/\S/.test(value[sourceStart] ?? '');
  while (index > bodyStart && /\s/.test(value[index - 1] ?? '')) index -= 1;
  while (index > bodyStart && !/\s/.test(value[index - 1] ?? '')) index -= 1;
  if (shouldRemovePreviousSeparator) {
    while (index > bodyStart && /\s/.test(value[index - 1] ?? '')) index -= 1;
  }
  return index;
}

function getWordDeleteForwardEnd(value: string, sourceEnd: number): number {
  let index = sourceEnd;
  while (index < value.length && /\s/.test(value[index] ?? '')) index += 1;
  while (index < value.length && !/\s/.test(value[index] ?? '')) index += 1;
  return index;
}

function getRenderedMarkdownTextInputEditForSourceSelection(
  markdown: string,
  sourceStartInput: number,
  sourceEndInput: number,
  inputType: string,
  data?: string | null,
): RenderedMarkdownTextEdit | null {
  const { bodyStart } = getRenderedMarkdownSource(markdown);
  let sourceStart = Math.max(bodyStart, Math.min(sourceStartInput, markdown.length));
  let sourceEnd = Math.max(bodyStart, Math.min(sourceEndInput, markdown.length));
  if (sourceEnd < sourceStart) [sourceStart, sourceEnd] = [sourceEnd, sourceStart];
  let insert = '';

  if (
    inputType === 'insertText'
    || inputType === 'insertCompositionText'
    || inputType === 'insertReplacementText'
    || inputType === 'insertFromPaste'
    || inputType === 'insertFromDrop'
  ) {
    if (!data) return null;
    insert = data;
  } else if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
    insert = '\n';
  } else if (inputType === 'deleteContentBackward') {
    if (sourceStart === sourceEnd) {
      if (sourceStart <= bodyStart) return null;
      sourceStart -= 1;
    }
  } else if (inputType === 'deleteWordBackward') {
    if (sourceStart === sourceEnd) {
      const nextStart = getWordDeleteBackwardStart(markdown, bodyStart, sourceStart);
      if (nextStart === sourceStart) return null;
      sourceStart = nextStart;
    }
  } else if (inputType === 'deleteHardLineBackward' || inputType === 'deleteSoftLineBackward') {
    if (sourceStart === sourceEnd) {
      const nextStart = getLineDeleteBackwardStart(markdown, bodyStart, sourceStart);
      if (nextStart < sourceStart) {
        sourceStart = nextStart;
      } else {
        if (sourceStart <= bodyStart) return null;
        sourceStart -= 1;
      }
    }
  } else if (inputType === 'deleteContentForward') {
    if (sourceStart === sourceEnd) {
      if (sourceEnd >= markdown.length) return null;
      sourceEnd += 1;
    }
  } else if (inputType === 'deleteWordForward') {
    if (sourceStart === sourceEnd) {
      const nextEnd = getWordDeleteForwardEnd(markdown, sourceEnd);
      if (nextEnd === sourceEnd) return null;
      sourceEnd = nextEnd;
    }
  } else if (inputType === 'deleteHardLineForward' || inputType === 'deleteSoftLineForward') {
    if (sourceStart === sourceEnd) {
      const nextEnd = getLineDeleteForwardEnd(markdown, markdown.length, sourceEnd);
      if (nextEnd > sourceEnd) {
        sourceEnd = nextEnd;
      } else {
        if (sourceEnd >= markdown.length) return null;
        sourceEnd += 1;
      }
    }
  } else if (inputType === 'deleteByCut' || inputType === 'deleteContent') {
    if (sourceStart === sourceEnd) return null;
  } else {
    return null;
  }

  const nextValue = `${markdown.slice(0, sourceStart)}${insert}${markdown.slice(sourceEnd)}`;
  const selection = sourceStart + insert.length;
  return {
    nextValue,
    selectionStart: selection,
    selectionEnd: selection,
  };
}

export function getRenderedMarkdownInputEditAtSourceOffset(
  markdown: string,
  sourceOffset: number,
  inputType: string,
  data?: string | null,
): RenderedMarkdownTextEdit | null {
  return getRenderedMarkdownTextInputEditForSourceSelection(
    markdown,
    sourceOffset,
    sourceOffset,
    inputType,
    data,
  );
}

function shouldUseSourceSelectionForCollapsedTextRangeEdit(
  inputType: string,
  textRange: RenderedTextNodeSourceRange,
  textOffset: number,
): boolean {
  if (textRange.synthetic === 'blank-line') return true;
  if (inputType === 'deleteWordBackward') {
    const previousText = textRange.text.slice(0, textOffset).replace(/\u00A0/g, ' ');
    return previousText.length > 0 && previousText.trim() === '';
  }
  if (inputType === 'deleteWordForward') {
    const nextText = textRange.text.slice(textOffset).replace(/\u00A0/g, ' ');
    return nextText.length > 0 && nextText.trim() === '';
  }
  return false;
}

export function getRenderedMarkdownInputEditFromSelection(
  markdown: string,
  root: HTMLElement,
  selection: Selection | null,
  inputType: string,
  data?: string | null,
): RenderedMarkdownTextEdit | null {
  const range = getRenderedMarkdownRangeFromSelection(markdown, root, selection);
  if (!range) return null;

  if (range.collapsedTextRange && range.collapsedTextOffset !== null) {
    if (shouldUseSourceSelectionForCollapsedTextRangeEdit(
      inputType,
      range.collapsedTextRange,
      range.collapsedTextOffset,
    )) {
      return getRenderedMarkdownTextInputEditForSourceSelection(
        markdown,
        range.start,
        range.end,
        inputType,
        data,
      );
    }
    return getRenderedMarkdownTextInputEditForSourceRange(
      markdown,
      range.collapsedTextRange,
      range.collapsedTextRange.text.length,
      range.collapsedTextOffset,
      range.collapsedTextOffset,
      inputType,
      data,
    );
  }

  return getRenderedMarkdownTextInputEditForSourceSelection(
    markdown,
    range.start,
    range.end,
    inputType,
    data,
  );
}

export function getRenderedMarkdownRangeFromSelection(
  markdown: string,
  root: HTMLElement,
  selection: Selection | null,
): (RenderedMarkdownSourceRange & {
  collapsedTextRange: RenderedTextNodeSourceRange | null;
  collapsedTextOffset: number | null;
}) | null {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const ranges = getRenderedMarkdownTextNodeSourceRanges(root, markdown);
  const start = resolveRenderedSelectionBoundary(ranges, range.startContainer, range.startOffset, 'start')
    ?? resolveRenderedSelectionBoundaryFallback(root, markdown, range.startContainer, range.startOffset);
  const end = resolveRenderedSelectionBoundary(ranges, range.endContainer, range.endOffset, 'end')
    ?? resolveRenderedSelectionBoundaryFallback(root, markdown, range.endContainer, range.endOffset);
  if (!start || !end) return null;

  if (range.collapsed && start.textRange && start.textOffset !== null) {
    return {
      start: start.offset,
      end: start.offset,
      collapsedTextRange: start.textRange,
      collapsedTextOffset: start.textOffset,
    };
  }

  return {
    start: start.offset,
    end: end.offset,
    collapsedTextRange: null,
    collapsedTextOffset: null,
  };
}

export function setRenderedMarkdownSelectionFromPoint(
  root: HTMLElement,
  markdown: string,
  clientX: number,
  clientY: number,
): RenderedPointCaret | null {
  const doc = root.ownerDocument as CaretPointDocument;
  let range: Range | null = null;
  const position = doc.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    range = doc.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
  } else {
    range = doc.caretRangeFromPoint?.(clientX, clientY)?.cloneRange() ?? null;
    range?.collapse(true);
  }
  if (!range || !root.contains(range.commonAncestorContainer)) return null;

  const selection = doc.getSelection();
  if (!selection) return null;
  selection.removeAllRanges();
  selection.addRange(range);

  const sourceRange = getRenderedMarkdownRangeFromSelection(markdown, root, selection);
  if (!sourceRange || sourceRange.start !== sourceRange.end) return null;
  return {
    sourceOffset: sourceRange.start,
    selection: getRenderedSelectionDebug(root),
  };
}

export function getRenderedSelectionDebug(root: HTMLElement): Record<string, unknown> {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return { exists: false };
  if (selection.rangeCount === 0) {
    return {
      exists: true,
      rangeCount: 0,
      isCollapsed: selection.isCollapsed,
      selectedTextLength: selection.toString().length,
    };
  }
  const range = selection.getRangeAt(0);
  return {
    exists: true,
    rangeCount: selection.rangeCount,
    isCollapsed: selection.isCollapsed,
    selectedTextLength: selection.toString().length,
    inRoot: root.contains(range.commonAncestorContainer),
    startNodeType: range.startContainer.nodeType,
    endNodeType: range.endContainer.nodeType,
    sameNode: range.startContainer === range.endContainer,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    startText: range.startContainer.nodeType === Node.TEXT_NODE
      ? (range.startContainer.textContent ?? '').slice(0, 80)
      : null,
    endText: range.endContainer.nodeType === Node.TEXT_NODE
      ? (range.endContainer.textContent ?? '').slice(0, 80)
      : null,
    caretRect: getRangeCaretDebugRect(root, range),
  };
}

export function getElementDebugSummary(element: Element | null): Record<string, unknown> | null {
  if (!element) return null;
  return {
    tagName: element.tagName,
    id: element.id || null,
    className: typeof element.className === 'string' ? element.className : null,
    role: element.getAttribute('role'),
    ariaLabel: element.getAttribute('aria-label'),
    tabIndex: element instanceof HTMLElement ? element.tabIndex : null,
    isContentEditable: element instanceof HTMLElement ? element.isContentEditable : null,
  };
}

export function getRectDebugSummary(rect: DOMRect | undefined): Record<string, number> | null {
  if (!rect) return null;
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function getRangeCaretDebugRect(root: HTMLElement, range: Range): Record<string, unknown> | null {
  const rect = range.getBoundingClientRect();
  const visibleRect = rect.width > 0 || rect.height > 0
    ? rect
    : Array.from(range.getClientRects()).find((clientRect) => clientRect.width > 0 || clientRect.height > 0);
  if (!visibleRect) return null;
  const rootRect = root.getBoundingClientRect();
  return {
    viewport: getRectDebugSummary(visibleRect),
    root: {
      left: Math.round(visibleRect.left - rootRect.left),
      top: Math.round(visibleRect.top - rootRect.top),
      width: Math.round(visibleRect.width),
      height: Math.round(visibleRect.height),
    },
  };
}

function getRenderedCaretRect(range: Range, node: Text, renderedOffset: number): DOMRect {
  const collapsedRect = range.getBoundingClientRect();
  if (collapsedRect.height > 0 || collapsedRect.width > 0) return collapsedRect;

  const measureRange = range.cloneRange();
  if (renderedOffset < node.length) {
    measureRange.setStart(node, renderedOffset);
    measureRange.setEnd(node, renderedOffset + 1);
    return measureRange.getBoundingClientRect();
  }
  if (renderedOffset > 0) {
    measureRange.setStart(node, renderedOffset - 1);
    measureRange.setEnd(node, renderedOffset);
    const rect = measureRange.getBoundingClientRect();
    return new DOMRect(rect.right, rect.top, 0, rect.height);
  }
  return node.parentElement?.getBoundingClientRect() ?? collapsedRect;
}

type RenderedSelectionRestoreTarget = {
  sourceRange: RenderedTextNodeSourceRange | null;
  renderedOffset: number;
  domSourceOffset: number | null;
  restoreTarget: RenderedCaretGeometry['restoreTarget'];
  sourceDistance: number | null;
};

function chooseRenderedSelectionRestoreTarget(
  ranges: RenderedTextNodeSourceRange[],
  offset: number,
): RenderedSelectionRestoreTarget | null {
  const exactRange = ranges.find((candidate) => offset >= candidate.start && offset <= candidate.end);
  if (exactRange) {
    const renderedOffset = Math.max(0, Math.min(offset - exactRange.start, exactRange.node.length));
    return {
      sourceRange: exactRange,
      renderedOffset,
      domSourceOffset: exactRange.start + renderedOffset,
      restoreTarget: 'exact',
      sourceDistance: 0,
    };
  }

  const previous = ranges.slice().reverse().find((candidate) => offset > candidate.end) ?? null;
  const next = ranges.find((candidate) => offset < candidate.start) ?? null;
  if (previous && next) {
    const previousDistance = offset - previous.end;
    const nextDistance = next.start - offset;
    if (previousDistance <= nextDistance) {
      return {
        sourceRange: previous,
        renderedOffset: previous.text.length,
        domSourceOffset: previous.end,
        restoreTarget: 'previous-boundary',
        sourceDistance: previousDistance,
      };
    }
    return {
      sourceRange: next,
      renderedOffset: 0,
      domSourceOffset: next.start,
      restoreTarget: 'next-boundary',
      sourceDistance: nextDistance,
    };
  }

  if (previous) {
    return {
      sourceRange: previous,
      renderedOffset: previous.text.length,
      domSourceOffset: previous.end,
      restoreTarget: 'previous-boundary',
      sourceDistance: offset - previous.end,
    };
  }

  if (next) {
    return {
      sourceRange: next,
      renderedOffset: 0,
      domSourceOffset: next.start,
      restoreTarget: 'next-boundary',
      sourceDistance: next.start - offset,
    };
  }
  return null;
}

export function setRenderedMarkdownSelectionAtOffset(
  root: HTMLElement,
  markdown: string,
  offset: number,
): RenderedCaretGeometry | null {
  const ranges = getRenderedMarkdownTextNodeSourceRanges(root, markdown);
  let restoreTarget = chooseRenderedSelectionRestoreTarget(ranges, offset);
  let node = restoreTarget?.sourceRange?.node ?? null;
  if (!restoreTarget) {
    const renderedOffset = mapMarkdownOffsetToRenderedTextOffset(markdown, offset);
    const fallbackPosition = getRenderedTextNodeAtRenderedOffset(root, renderedOffset);
    if (!fallbackPosition) return null;
    restoreTarget = {
      sourceRange: null,
      renderedOffset: fallbackPosition.offset,
      domSourceOffset: mapRenderedTextOffsetToMarkdownOffset(markdown, renderedOffset),
      restoreTarget: 'rendered-offset',
      sourceDistance: null,
    };
    node = fallbackPosition.node;
  }
  if (!node) return null;
  const renderedOffset = restoreTarget.renderedOffset;
  const domSourceOffset = restoreTarget.domSourceOffset;
  const range = root.ownerDocument.createRange();
  range.setStart(node, renderedOffset);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  if (!selection) return null;
  selection.removeAllRanges();
  selection.addRange(range);
  const rootRect = root.getBoundingClientRect();
  const caretRect = getRenderedCaretRect(range, node, renderedOffset);
  const fallbackHeight = parseFloat(root.ownerDocument.defaultView?.getComputedStyle(node.parentElement ?? root).lineHeight ?? '') || 18;
  return {
    left: Math.max(0, caretRect.left - rootRect.left),
    top: Math.max(0, caretRect.top - rootRect.top),
    height: Math.max(12, caretRect.height || fallbackHeight),
    sourceOffset: offset,
    domSourceOffset,
    approximate: restoreTarget.restoreTarget !== 'exact' || domSourceOffset !== offset,
    restoreTarget: restoreTarget.restoreTarget,
    sourceDistance: restoreTarget.sourceDistance,
    targetSourceStart: restoreTarget.sourceRange?.start ?? null,
    targetSourceEnd: restoreTarget.sourceRange?.end ?? null,
    targetRenderedOffset: renderedOffset,
  };
}

export function getTrustedRenderedCaretSourceOffset(
  caretGeometry: Pick<RenderedCaretGeometry, 'approximate' | 'domSourceOffset'> | null,
  requestedSourceOffset: number,
): number {
  if (
    caretGeometry?.approximate
    && typeof caretGeometry.domSourceOffset === 'number'
    && Number.isFinite(caretGeometry.domSourceOffset)
  ) {
    return caretGeometry.domSourceOffset;
  }
  return requestedSourceOffset;
}
