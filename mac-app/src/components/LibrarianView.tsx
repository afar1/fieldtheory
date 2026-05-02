// =============================================================================
// LibrarianView - reading and writing experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { Children, cloneElement, isValidElement, useEffect, useState, useRef, useCallback, useMemo, Fragment, memo, type ReactElement, type ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import { fonts } from '../design/tokens';
import ContentToolbar from './ContentToolbar';
import FieldTheoryProse from './FieldTheoryProse';
import ImmersiveToggle from './ImmersiveToggle';
import AgentKickoffModal from './AgentKickoffModal';
import LibrarianSetupWizard from './LibrarianSetupWizard';
import WikiSidebar, {
  BOOKMARKS_ITEM_ID,
  dispatchLocalWikiAdded,
  dispatchLocalWikiDeleted,
  dispatchLocalWikiRenamed,
  type LibraryCreateLocation,
  type UnifiedItem,
  type WikiCreationController,
} from './WikiSidebar';
import BookmarksPane from './BookmarksPane';
import { prefetchBookmarks } from '../services/bookmarksCache';
import { FEATURE_NARRATION_ENABLED } from '../featureFlags';
import {
  LIBRARIAN_KEYBOARD_SHORTCUTS,
  RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT,
  TEXT_CURSOR_BLINK_CHANGED_EVENT,
  isCommandDeleteShortcut,
  isCommandFindShortcut,
  isImmersiveToggleShortcut,
  isKeyboardShortcutsHelpShortcut,
  isMarkdownModeToggleShortcut,
  isMarkdownTaskShortcut,
  isMarkdownTaskToggleShortcut,
  isSearchFocusShortcut,
  isSidebarToggleShortcut,
  restoreRenderedEditClickMode,
  restoreTextCursorBlink,
  shouldEnterEditOnClick,
  type RenderedEditClickMode,
} from '../utils/editorShortcuts';
import {
  getMarkdownTodoState,
  parseMarkdownFrontmatter,
  setMarkdownTodoState as setFrontmatterMarkdownTodoState,
  type MarkdownTodoState,
} from '../../electron/shared/markdownFrontmatter';
export type { MarkdownTodoState };
import {
  LIBRARIAN_LINE_HEIGHT_OPTIONS,
  LIBRARIAN_TYPOGRAPHY_PRESETS,
  isLibrarianLineHeightId,
  isLibrarianTypographyPresetId,
  persistLibrarianLineHeight,
  persistLibrarianTypographyPreset,
  resolveLibrarianLineHeight,
  resolveLibrarianParagraphSpacing,
  restoreLibrarianLineHeight,
  restoreLibrarianTypographyPreset,
  type LibrarianLineHeightId,
  type LibrarianTypographyPresetId,
} from '../utils/librarianTypography';
import {
  MARKDOWN_URL_PASTE_OPTIONS,
  getMarkdownUrlPasteEdit,
  getMarkdownUrlPasteReplacement,
  type MarkdownUrlPasteEdit,
  type MarkdownUrlPasteKind,
} from '../utils/markdownUrlPaste';
import { getMarkdownTaskShortcutEdit, getMarkdownTaskToggleEdit } from '../utils/markdownTasks';
import { getDocumentSaveVersion, isDocumentSaveConflict, isDocumentSaveOk } from '../utils/documentSaveConflicts';
import { formatLocalImageMarkdown, formatPastedLocalImageMarkdown } from '../utils/clipboardMarkdown';
import MarkdownCodeEditor, {
  type MarkdownCodeEditorHandle,
  type MarkdownCodeEditorSelectionSnapshot,
} from './MarkdownCodeEditor';
import ScrollDiagnosticsHUD from './ScrollDiagnosticsHUD';
import { useScrollFpsSampler } from '../hooks/useScrollFpsSampler';
import '../utils/scrollDiagnostics.bootstrap';
import {
  buildWikiIndex,
  classifyLinkHref,
  getActiveMarkdownWikiLinkCompletion,
  getMarkdownEditorLinkActionAtOffset,
  getMarkdownLinkedDocuments,
  getMarkdownWikiLinkAutoCloseEdit,
  getMarkdownWikiLinkCompletionReplacement,
  getWikiLinkTargetKey,
  isUnresolvedWikiHref,
  normalizeWikiRelPath,
  transformWikiLinks,
  type LinkAction,
  type MarkdownLinkedDocument,
  type MarkdownLinkRelationDocument,
  type MarkdownWikiLinkCompletion,
  type WikiIndexInput,
  type WikiLinkTarget,
} from '../utils/wikiLinks';

type FieldTheoryMarkdownTarget = {
  kind: 'wiki' | 'artifact' | 'command' | 'external';
  path: string;
  contentMode?: 'rendered' | 'markdown';
};

export type LibrarianSelectedItemType = 'wiki' | 'artifact' | 'bookmarks' | 'external' | null;
const COPY_PATH_FEEDBACK_MS = 1600;

function libraryRenameTraceEnabled(): boolean {
  try {
    return localStorage.getItem('fieldtheory.libraryRenameTrace') === 'true';
  } catch {
    return false;
  }
}

function traceLibraryRename(stage: string, event: LibraryRenameEvent, extra: Record<string, unknown> = {}): void {
  const data = {
    traceId: event.traceId,
    source: event.source,
    oldRelPath: event.oldRelPath,
    newRelPath: event.newRelPath,
    oldAbsPath: event.oldAbsPath,
    newAbsPath: event.newAbsPath,
    ipcAgeMs: event.emittedAt ? Date.now() - event.emittedAt : null,
    ...extra,
  };
  if (libraryRenameTraceEnabled()) console.debug('[LibraryRenameTrace]', stage, data);
}

function getRenamedWikiAbsPath(oldAbsPath: string, oldRelPath: string, newRelPath: string): string {
  const extensionMatch = oldAbsPath.match(/(\.[^/.]+)$/);
  const extension = extensionMatch?.[1] ?? '.md';
  const oldSuffix = `${oldRelPath}${extension}`;
  if (oldAbsPath.endsWith(oldSuffix)) {
    return `${oldAbsPath.slice(0, -oldSuffix.length)}${newRelPath}${extension}`;
  }
  const separatorIndex = oldAbsPath.lastIndexOf('/');
  const dir = separatorIndex >= 0 ? oldAbsPath.slice(0, separatorIndex + 1) : '';
  return `${dir}${newRelPath.split('/').pop() ?? newRelPath}${extension}`;
}

function readingFromWikiPage(page: WikiPage): Reading {
  return {
    path: page.absPath,
    title: page.title,
    content: page.content,
    context: null,
    readingTime: null,
    modelSignature: null,
    createdAt: page.lastUpdated,
    mtime: page.lastUpdated,
    todoState: page.todoState,
    documentVersion: page.documentVersion,
  };
}

function readingFromExternalMarkdownFile(file: ExternalMarkdownFile): Reading {
  const title = file.name.replace(/\.(md|markdown|mdx)$/i, '');
  return {
    path: file.path,
    title,
    content: file.content,
    context: null,
    readingTime: null,
    modelSignature: null,
    createdAt: file.mtime,
    mtime: file.mtime,
    documentVersion: file.documentVersion,
  };
}

export function deletedLibraryItemMatchesSelection(
  item: Pick<UnifiedItem, 'id' | 'type' | 'relPath' | 'absPath'>,
  selection: {
    selectedItemId: string | null;
    selectedItemType: LibrarianSelectedItemType;
    wikiSelectedRelPath: string | null;
    selectedPath: string | null;
  },
): boolean {
  if (item.id === selection.selectedItemId) return true;
  if (item.type === 'wiki') {
    return selection.selectedItemType === 'wiki' && item.relPath === selection.wikiSelectedRelPath;
  }
  if (item.type === 'artifact') {
    return selection.selectedItemType === 'artifact' && item.absPath === selection.selectedPath;
  }
  return false;
}

export function getFrontmatterTodoState(meta: Record<string, string>): MarkdownTodoState | null {
  return getMarkdownTodoState(meta);
}

/** Strip YAML frontmatter from wiki page content for display.
 *  Returns the body (everything after the closing ---) and parsed
 *  metadata key-values for a small tag bar. */
export function splitFrontmatter(content: string): { body: string; meta: Record<string, string>; todoState: MarkdownTodoState | null } {
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.raw === null || !parsed.raw.trim()) return { body: content, meta: {}, todoState: null };
  return { body: parsed.body, meta: parsed.meta, todoState: getFrontmatterTodoState(parsed.meta) };
}

export function getNextMarkdownTodoState(current: MarkdownTodoState | null): MarkdownTodoState | null {
  if (current === null) return 'open';
  if (current === 'open') return 'done';
  return null;
}

export function getPreviousMarkdownTodoState(current: MarkdownTodoState | null): MarkdownTodoState | null {
  if (current === null) return 'done';
  if (current === 'done') return 'open';
  return null;
}

export function setMarkdownTodoState(content: string, nextState: MarkdownTodoState | null): string {
  return setFrontmatterMarkdownTodoState(content, nextState);
}

export function cycleMarkdownTodoState(content: string, direction: 'forward' | 'backward' = 'forward'): { content: string; state: MarkdownTodoState | null } {
  const currentState = splitFrontmatter(content).todoState;
  const state = direction === 'backward' ? getPreviousMarkdownTodoState(currentState) : getNextMarkdownTodoState(currentState);
  return { content: setMarkdownTodoState(content, state), state };
}

export function rebaseMarkdownTodoStateChange(
  previousContent: string,
  targetContent: string,
  diskContent: string,
): { content: string; state: MarkdownTodoState | null } | null {
  const targetState = splitFrontmatter(targetContent).todoState;
  if (targetContent !== setMarkdownTodoState(previousContent, targetState)) return null;
  if (targetState === splitFrontmatter(previousContent).todoState) return null;
  return {
    content: setMarkdownTodoState(diskContent, targetState),
    state: targetState,
  };
}

export function shouldHandleMarkdownTodoTabShortcut(input: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  selectedItemType: LibrarianSelectedItemType;
}): boolean {
  return input.key === 'Tab'
    && !input.metaKey
    && !input.ctrlKey
    && !input.altKey
    && (input.selectedItemType === 'wiki' || input.selectedItemType === 'external');
}

export function isLibrarianDocumentFocusChromeActive(input: {
  canUseFocusImmersive: boolean;
  isFullScreen: boolean;
  sidebarCollapsed: boolean;
  focusImmersive: boolean;
  isFocusedWritingMode: boolean;
  writingChromeHidden: boolean;
}): boolean {
  return input.canUseFocusImmersive
    && !input.isFullScreen
    && input.sidebarCollapsed
    && (input.focusImmersive || (input.isFocusedWritingMode && input.writingChromeHidden));
}

export function isBookmarksCanvasChromeActive(input: {
  active: boolean;
  selectedItemType: LibrarianSelectedItemType;
  isFullScreen: boolean;
  bookmarksCanvasActive: boolean;
}): boolean {
  return input.active
    && input.selectedItemType === 'bookmarks'
    && input.isFullScreen
    && input.bookmarksCanvasActive;
}

export function isTextEntryInputType(type: string | null | undefined): boolean {
  const normalized = (type ?? 'text').toLowerCase();
  return normalized === 'text'
    || normalized === 'search'
    || normalized === 'email'
    || normalized === 'url'
    || normalized === 'tel'
    || normalized === 'password'
    || normalized === 'number'
    || normalized === 'date'
    || normalized === 'datetime-local'
    || normalized === 'month'
    || normalized === 'week'
    || normalized === 'time';
}

const PRESERVED_BLANK_MARKDOWN_LINE = '\u00A0';
const FILE_FIND_MARK_ATTR = 'data-ft-file-find-mark';
const LIBRARIAN_DOCUMENT_TOOLBAR_ROW_HEIGHT_PX = 42;
const LIBRARIAN_MARKDOWN_CONTENT_TOP_PADDING_PX = 22;
const LIBRARIAN_RENDERED_CONTENT_TOP_PADDING_PX = 28;
const LIBRARIAN_FULLSCREEN_RENDERED_CONTENT_TOP_PADDING_PX = 16;
const LIBRARIAN_CONTENT_BOTTOM_PADDING_PX = 0;
const RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED = false;
const LIBRARIAN_AGENT_KICKOFF_ENABLED = false;
export const LIBRARIAN_UNORDERED_LIST_MARKER_STORAGE_KEY = 'librarian-unordered-list-marker';
export const LIBRARIAN_TODO_MARKER_STORAGE_KEY = 'librarian-todo-marker';
export const CARROT_LIST_MARKER = '›';
const CARROT_LIST_SENTINEL = '\u2060';

export type LibrarianUnorderedListMarker = 'dash' | 'carrot';
export type LibrarianTodoMarker = 'circle' | 'square';

export function isLibrarianUnorderedListMarker(value: unknown): value is LibrarianUnorderedListMarker {
  return value === 'dash' || value === 'carrot';
}

export function restoreLibrarianUnorderedListMarker(
  storage: Pick<Storage, 'getItem'>,
): LibrarianUnorderedListMarker {
  const saved = storage.getItem(LIBRARIAN_UNORDERED_LIST_MARKER_STORAGE_KEY);
  return isLibrarianUnorderedListMarker(saved) ? saved : 'dash';
}

export function persistLibrarianUnorderedListMarker(
  storage: Pick<Storage, 'setItem'>,
  marker: LibrarianUnorderedListMarker,
): void {
  storage.setItem(LIBRARIAN_UNORDERED_LIST_MARKER_STORAGE_KEY, marker);
}

export function isLibrarianTodoMarker(value: unknown): value is LibrarianTodoMarker {
  return value === 'circle' || value === 'square';
}

export function restoreLibrarianTodoMarker(
  storage: Pick<Storage, 'getItem'>,
): LibrarianTodoMarker {
  const saved = storage.getItem(LIBRARIAN_TODO_MARKER_STORAGE_KEY);
  return isLibrarianTodoMarker(saved) ? saved : 'circle';
}

export function persistLibrarianTodoMarker(
  storage: Pick<Storage, 'setItem'>,
  marker: LibrarianTodoMarker,
): void {
  storage.setItem(LIBRARIAN_TODO_MARKER_STORAGE_KEY, marker);
}

type MarkdownTextEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

type MarkdownUndoSnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function parseCarrotListLine(line: string): { indent: string; markers: string; text: string } | null {
  const match = line.match(/^(\s*)(›+)(?:[ \t](.*)|[ \t]*)$/);
  if (!match) return null;
  return {
    indent: match[1],
    markers: match[2],
    text: match[3] ?? '',
  };
}

function isNormalizedCarrotListLine(line: string): boolean {
  return line.trimStart().startsWith(`- ${CARROT_LIST_SENTINEL}`);
}

export function preserveMarkdownBlankLines(content: string): string {
  if (!content || !content.trim()) return content;

  const output: string[] = [];
  const lines = content.split('\n');
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      output.push(line);
      inFence = !inFence;
      continue;
    }

    if (!inFence && line.trim() === '') {
      if (isNormalizedCarrotListLine(lines[index - 1] ?? '') || isNormalizedCarrotListLine(lines[index + 1] ?? '')) {
        output.push(line);
        continue;
      }
      output.push('', PRESERVED_BLANK_MARKDOWN_LINE, '');
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

export function removeEmptyMarkdownCommentPlaceholders(content: string): string {
  if (!content) return content;
  let inFence = false;
  return content
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return !inFence && /^[ \t]*<!--\s*-->[ \t]*$/.test(line) ? '' : line;
    })
    .join('\n');
}

export function normalizeMarkdownTodoLines(content: string): string {
  if (!content) return content;

  const output: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      output.push(line);
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      const task = line.match(/^(\s*)\[( |x|X)?\]\s+(.+)$/);
      if (task) {
        const marker = task[2]?.toLowerCase() === 'x' ? 'x' : ' ';
        output.push(`${task[1]}- [${marker}] ${task[3]}`);
        continue;
      }
    }

    output.push(line);
  }

  return output.join('\n');
}

export function normalizeMarkdownCarrotLists(content: string): string {
  if (!content) return content;

  const output: string[] = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      output.push(line);
      inFence = !inFence;
      continue;
    }

    const carrot = !inFence ? parseCarrotListLine(line) : null;
    if (!carrot) {
      output.push(line);
      continue;
    }

    const depthIndent = '  '.repeat(Math.max(0, carrot.markers.length - 1));
    output.push(`${carrot.indent}${depthIndent}- ${CARROT_LIST_SENTINEL}${carrot.text}`);
  }

  return output.join('\n');
}

export function getMarkdownBodySelectionRange(value: string): { start: number; end: number } | null {
  if (!value.startsWith('# ')) return null;
  const firstLineEnd = value.indexOf('\n');
  if (firstLineEnd < 0) return null;
  let bodyStart = firstLineEnd + 1;
  if (value[bodyStart] === '\n') bodyStart += 1;
  return { start: Math.min(bodyStart, value.length), end: value.length };
}

function getSelectedLineBounds(value: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const searchFrom = selectionEnd > selectionStart ? selectionEnd - 1 : selectionEnd;
  const nextNewline = value.indexOf('\n', searchFrom);
  return {
    start,
    end: nextNewline === -1 ? value.length : nextNewline,
  };
}

export function getCarrotListEnterEdit(value: string, selectionStart: number, selectionEnd: number): MarkdownTextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', selectionStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const carrot = parseCarrotListLine(line);
  if (!carrot) return null;

  if (carrot.text.trim().length === 0) {
    const nextValue = `${value.slice(0, lineStart)}${value.slice(lineEnd)}`;
    return {
      nextValue,
      selectionStart: lineStart,
      selectionEnd: lineStart,
    };
  }

  const insertion = `\n${carrot.indent}${carrot.markers} `;
  const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
  const nextSelection = selectionStart + insertion.length;
  return {
    nextValue,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}

export function getMarkdownListEnterEdit(value: string, selectionStart: number, selectionEnd: number): MarkdownTextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', selectionStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);

  const bareTask = line.match(/^(\s*)(\[(?: |x|X)?\])\s*(.*)$/);
  if (bareTask) {
    if (bareTask[3].trim().length === 0) {
      return {
        nextValue: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
        selectionStart: lineStart,
        selectionEnd: lineStart,
      };
    }
    const nextMarker = bareTask[2] === '[ ]' ? '[ ]' : '[]';
    const insertion = `\n${bareTask[1]}${nextMarker} `;
    const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
    const nextSelection = selectionStart + insertion.length;
    return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
  }

  const task = line.match(/^(\s*)[-*+]\s+\[(?: |x|X)\]\s*(.*)$/);
  if (task) {
    if (task[2].trim().length === 0) {
      return {
        nextValue: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
        selectionStart: lineStart,
        selectionEnd: lineStart,
      };
    }
    const insertion = `\n${task[1]}- [ ] `;
    const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
    const nextSelection = selectionStart + insertion.length;
    return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
  }

  const unordered = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (!unordered) return null;
  if (unordered[3].trim().length === 0) {
    return {
      nextValue: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
      selectionStart: lineStart,
      selectionEnd: lineStart,
    };
  }

  const insertion = `\n${unordered[1]}${unordered[2]} `;
  const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
  const nextSelection = selectionStart + insertion.length;
  return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
}

export function getCarrotListTabEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 'in' | 'out',
): MarkdownTextEdit | null {
  const { start: lineStart, end: lineEnd } = getSelectedLineBounds(value, selectionStart, selectionEnd);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const selectionIsBlock = selectionStart !== selectionEnd;
  let changed = false;
  let handled = false;
  let collapsedDelta = 0;
  let blockOffset = 0;

  const transformed = lines.map((line, index) => {
    const carrot = parseCarrotListLine(line);
    if (!carrot) {
      blockOffset += line.length + (index < lines.length - 1 ? 1 : 0);
      return line;
    }
    handled = true;

    const markerStart = lineStart + blockOffset + carrot.indent.length;
    const markerEnd = markerStart + carrot.markers.length;
    blockOffset += line.length + (index < lines.length - 1 ? 1 : 0);

    if (direction === 'in') {
      changed = true;
      if (!selectionIsBlock && selectionStart > markerStart) collapsedDelta = 1;
      return `${carrot.indent}${carrot.markers}${CARROT_LIST_MARKER} ${carrot.text}`;
    }

    if (carrot.markers.length === 1) return line;
    changed = true;
    if (!selectionIsBlock && selectionStart > markerStart) {
      collapsedDelta = selectionStart > markerEnd ? -1 : 0;
    }
    return `${carrot.indent}${carrot.markers.slice(1)} ${carrot.text}`;
  });

  if (!handled) return null;
  if (!changed) {
    return { nextValue: value, selectionStart, selectionEnd };
  }

  const nextBlock = transformed.join('\n');
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
  if (selectionIsBlock) {
    return {
      nextValue,
      selectionStart: lineStart,
      selectionEnd: lineStart + nextBlock.length,
    };
  }

  const nextSelection = Math.max(lineStart, selectionStart + collapsedDelta);
  return {
    nextValue,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
}

export function getMarkdownListToggleEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: 'ordered' | 'unordered',
  unorderedMarker: LibrarianUnorderedListMarker = 'dash',
): MarkdownTextEdit | null {
  const { start: lineStart, end: lineEnd } = getSelectedLineBounds(value, selectionStart, selectionEnd);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');

  const orderedRe = /^(\s*)(\d+)\.\s/;
  const unorderedRe = /^(\s*)[-*+]\s/;
  const carrotRe = /^(\s*)›+\s/;

  const nonBlank = lines.filter((line) => line.trim().length > 0);
  const allMarked = nonBlank.length > 0 && nonBlank.every((line) => (
    kind === 'ordered' ? orderedRe.test(line) : (unorderedRe.test(line) || carrotRe.test(line))
  ));

  let counter = 1;
  const transformed = lines.map((line) => {
    if (line.trim().length === 0) return line;
    const orderedMatch = line.match(orderedRe);
    const unorderedMatch = line.match(unorderedRe);
    const carrotMatch = line.match(carrotRe);
    const stripped = orderedMatch
      ? line.slice(orderedMatch[0].length)
      : unorderedMatch
      ? line.slice(unorderedMatch[0].length)
      : carrotMatch
      ? line.slice(carrotMatch[0].length)
      : line;
    if (allMarked) return stripped;
    if (kind === 'ordered') return `${counter++}. ${stripped}`;
    return unorderedMarker === 'carrot' ? `${CARROT_LIST_MARKER} ${stripped}` : `- ${stripped}`;
  });

  const nextBlock = transformed.join('\n');
  if (nextBlock === block) return null;
  return {
    nextValue: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}

export type RenderedMarkdownFormatAction = 'bold' | 'italic' | 'code' | 'link' | 'unordered-list';

function getMarkdownBodyStartOffset(markdown: string): number {
  if (parseMarkdownFrontmatter(markdown).raw === null) return 0;
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!frontmatter) return 0;
  let offset = frontmatter[0].length;
  while (markdown[offset] === '\n') offset += 1;
  return Math.min(offset, markdown.length);
}

export function resolveMarkdownSelectionRangeFromRenderedText(
  markdown: string,
  selectedText: string,
): { start: number; end: number } | null {
  const needle = selectedText.trim();
  if (!needle) return null;
  const body = splitFrontmatter(markdown).body;
  const bodyStart = getMarkdownBodyStartOffset(markdown);
  const first = body.indexOf(needle);
  if (first < 0) return null;
  if (body.indexOf(needle, first + needle.length) >= 0) return null;
  return {
    start: bodyStart + first,
    end: bodyStart + first + needle.length,
  };
}

export function getRenderedMarkdownSelectionToolbarState(
  markdown: string,
  selectedText: string,
  rect: Pick<DOMRect, 'top' | 'left' | 'width'>,
): { start: number; end: number; top: number; left: number } | null {
  const mapped = resolveMarkdownSelectionRangeFromRenderedText(markdown, selectedText);
  if (!mapped) return null;
  return {
    ...mapped,
    top: Math.max(8, rect.top - 36),
    left: Math.max(8, rect.left + rect.width / 2),
  };
}

function hasInlineWrapperAroundSelection(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string,
): boolean {
  if (value.slice(start - open.length, start) !== open || value.slice(end, end + close.length) !== close) {
    return false;
  }
  if (open === '*') {
    const beforeCount = countRepeatedBefore(value, start, '*');
    const afterCount = countRepeatedAfter(value, end, '*');
    return beforeCount !== 2 && afterCount !== 2;
  }
  return true;
}

function selectedTextHasInlineWrapper(selected: string, open: string, close: string): boolean {
  if (!selected.startsWith(open) || !selected.endsWith(close)) return false;
  if (selected.length <= open.length + close.length) return false;
  if (open === '*') {
    const leadingCount = countRepeatedAfter(selected, 0, '*');
    const trailingCount = countRepeatedBefore(selected, selected.length, '*');
    return leadingCount !== 2 && trailingCount !== 2;
  }
  return true;
}

function countRepeatedBefore(value: string, offset: number, char: string): number {
  let count = 0;
  for (let index = offset - 1; index >= 0 && value[index] === char; index -= 1) count += 1;
  return count;
}

function countRepeatedAfter(value: string, offset: number, char: string): number {
  let count = 0;
  for (let index = offset; index < value.length && value[index] === char; index += 1) count += 1;
  return count;
}

function getRenderedMarkdownInlineToggleEdit(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string,
): MarkdownTextEdit {
  const selected = value.slice(start, end);
  if (hasInlineWrapperAroundSelection(value, start, end, open, close)) {
    const nextStart = start - open.length;
    const nextEnd = end - open.length;
    return {
      nextValue: `${value.slice(0, nextStart)}${selected}${value.slice(end + close.length)}`,
      selectionStart: nextStart,
      selectionEnd: nextEnd,
    };
  }

  if (selectedTextHasInlineWrapper(selected, open, close)) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return {
      nextValue: `${value.slice(0, start)}${inner}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }

  return {
    nextValue: `${value.slice(0, start)}${open}${selected}${close}${value.slice(end)}`,
    selectionStart: start + open.length,
    selectionEnd: start + open.length + selected.length,
  };
}

function findRenderedMarkdownLinkClose(value: string, labelEnd: number): number {
  if (value.slice(labelEnd, labelEnd + 2) !== '](') return -1;
  const close = value.indexOf(')', labelEnd + 2);
  const newline = value.indexOf('\n', labelEnd + 2);
  if (close < 0 || (newline >= 0 && newline < close)) return -1;
  return close;
}

function getRenderedMarkdownLinkToggleEdit(value: string, start: number, end: number): MarkdownTextEdit {
  const selected = value.slice(start, end);
  if (value[start - 1] === '[') {
    const close = findRenderedMarkdownLinkClose(value, end);
    if (close >= 0) {
      return {
        nextValue: `${value.slice(0, start - 1)}${selected}${value.slice(close + 1)}`,
        selectionStart: start - 1,
        selectionEnd: start - 1 + selected.length,
      };
    }
  }

  const selectedLink = selected.match(/^\[([^\]\n]+)\]\([^\n)]*\)$/);
  if (selectedLink) {
    return {
      nextValue: `${value.slice(0, start)}${selectedLink[1]}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + selectedLink[1].length,
    };
  }

  const replacement = `[${selected}]()`;
  const cursor = start + selected.length + 3;
  return {
    nextValue: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function getRenderedMarkdownSelectionFormatEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: RenderedMarkdownFormatAction,
): MarkdownTextEdit | null {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  if (start === end) return null;

  if (action === 'unordered-list') {
    return getMarkdownListToggleEdit(value, start, end, 'unordered', 'dash');
  }

  const wrappers: Record<Exclude<RenderedMarkdownFormatAction, 'link' | 'unordered-list'>, [string, string]> = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    code: ['`', '`'],
  };

  if (action === 'link') {
    return getRenderedMarkdownLinkToggleEdit(value, start, end);
  }

  const [open, close] = wrappers[action];
  return getRenderedMarkdownInlineToggleEdit(value, start, end, open, close);
}

export function getRenderedMarkdownClickBehavior(input: {
  target: EventTarget | null;
  detail?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}, mode: RenderedEditClickMode = 'click'): 'source' | null {
  if (typeof input.detail === 'number' && input.detail > 1) return null;
  if (input.altKey || input.ctrlKey || input.shiftKey) return null;
  if (!shouldEnterEditOnClick(input, mode)) return null;
  return 'source';
}

export function toggleMarkdownTaskLine(content: string, text: string, checked: boolean): string {
  const target = text.trim();
  if (!target) return content;

  const lines = content.split('\n');
  const nextMarker = checked ? 'x' : ' ';
  const nextLines = [...lines];
  const taskPattern = /^(\s*)(-\s+)?\[( |x|X)?\]\s+(.+)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(taskPattern);
    if (!match || match[4].trim() !== target) continue;
    nextLines[index] = `${match[1]}${match[2] ?? ''}[${nextMarker}] ${match[4]}`;
    return nextLines.join('\n');
  }

  return content;
}

export type MarkdownTaskLine = {
  lineIndex: number;
  text: string;
  checked: boolean;
};

const MARKDOWN_TASK_LINE_PATTERN = /^(\s*)(?:([-*+])\s+)?\[( |x|X)?\]\s+(.+)$/;

export function getMarkdownTaskLines(content: string): MarkdownTaskLine[] {
  const tasks: MarkdownTaskLine[] = [];
  let inFence = false;
  content.split('\n').forEach((line, lineIndex) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = line.match(MARKDOWN_TASK_LINE_PATTERN);
    if (!match) return;
    tasks.push({
      lineIndex,
      text: match[4].trim(),
      checked: match[3]?.toLowerCase() === 'x',
    });
  });
  return tasks;
}

export function toggleMarkdownTaskLineAtIndex(content: string, lineIndex: number, checked: boolean): string {
  const lines = content.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return content;

  const match = line.match(MARKDOWN_TASK_LINE_PATTERN);
  if (!match) return content;

  const nextMarker = checked ? 'x' : ' ';
  lines[lineIndex] = `${match[1]}${match[2] ? `${match[2]} ` : ''}[${nextMarker}] ${match[4]}`;
  return lines.join('\n');
}

function getMarkdownTaskStateByText(content: string): Map<string, boolean> {
  const states = new Map<string, boolean>();
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*(?:[-*+]\s*)?\[( |x|X)?\]\s+(.+?)\s*$/);
    if (!match) continue;
    states.set(match[2].trim(), match[1]?.toLowerCase() === 'x');
  }
  return states;
}

export function getNewlyCheckedMarkdownTasks(previousContent: string, nextContent: string): string[] {
  const previous = getMarkdownTaskStateByText(previousContent);
  const next = getMarkdownTaskStateByText(nextContent);
  const newlyChecked: string[] = [];

  next.forEach((checked, text) => {
    if (checked && previous.get(text) === false) {
      newlyChecked.push(text);
    }
  });

  return newlyChecked;
}

export function findNextMarkdownMatch(content: string, query: string, fromIndex: number = 0): { start: number; end: number } | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const haystack = content.toLowerCase();
  const startFrom = Math.max(0, Math.min(fromIndex, haystack.length));
  const forward = haystack.indexOf(needle, startFrom);
  const wrapped = forward >= 0 ? forward : haystack.indexOf(needle, 0);
  return wrapped >= 0 ? { start: wrapped, end: wrapped + needle.length } : null;
}

export function resolveMarkdownCaretOffsetFromRenderedText(
  markdown: string,
  renderedText: string,
  renderedOffset: number,
): number | null {
  if (!renderedText) return null;
  const body = splitFrontmatter(markdown).body;
  const bodyStart = getMarkdownBodyStartOffset(markdown);
  const clampedOffset = Math.max(0, Math.min(renderedOffset, renderedText.length));
  const sourceIndex = body.indexOf(renderedText);
  if (sourceIndex >= 0) return bodyStart + sourceIndex + clampedOffset;

  const before = renderedText.slice(0, clampedOffset);
  if (!before) return null;
  const beforeIndex = body.indexOf(before);
  if (beforeIndex >= 0) return bodyStart + beforeIndex + before.length;

  let renderedCount = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (/[*_`#>\[\]()!-]/.test(body[index])) continue;
    renderedCount += 1;
    if (renderedCount >= clampedOffset) return bodyStart + index + 1;
  }
  return null;
}

function clearFileFindMarks(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll(`mark[${FILE_FIND_MARK_ATTR}]`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

export function highlightFileFindMatches(root: HTMLElement, query: string): void {
  clearFileFindMarks(root);
  const needle = query.trim();
  if (!needle) return;
  const needleLower = needle.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script, style, mark')) return NodeFilter.FILTER_REJECT;
      return (node.textContent ?? '').toLowerCase().includes(needleLower)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const textLower = text.toLowerCase();
    const fragment = document.createDocumentFragment();
    let index = 0;
    let matchIndex = textLower.indexOf(needleLower);
    while (matchIndex >= 0) {
      if (matchIndex > index) fragment.appendChild(document.createTextNode(text.slice(index, matchIndex)));
      const mark = document.createElement('mark');
      mark.setAttribute(FILE_FIND_MARK_ATTR, '1');
      mark.textContent = text.slice(matchIndex, matchIndex + needle.length);
      mark.style.backgroundColor = '#facc15';
      mark.style.color = '#111827';
      mark.style.borderRadius = '2px';
      mark.style.padding = '0 1px';
      fragment.appendChild(mark);
      index = matchIndex + needle.length;
      matchIndex = textLower.indexOf(needleLower, index);
    }
    if (index < text.length) fragment.appendChild(document.createTextNode(text.slice(index)));
    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

function clipboardDataHasImage(data: DataTransfer): boolean {
  if (Array.from(data.files).some((file) => file.type.startsWith('image/'))) {
    return true;
  }
  return Array.from(data.items).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

export function shouldInsertClipboardImagePathForPaste(input: { pastedText: string; hasImage: boolean }): boolean {
  return input.hasImage;
}

export const LIBRARIAN_SELECTION_STORAGE_KEY = 'librarian-last-selection';
export const LIBRARIAN_IMMERSIVE_STORAGE_KEY = 'librarian-immersive';
export const LIBRARIAN_EDITOR_SESSION_STORAGE_KEY = 'librarian-editor-session';

export type LibrarianStoredSelection =
  | { type: 'wiki'; relPath: string }
  | { type: 'artifact'; path: string }
  | { type: 'bookmarks' };

export type LibrarianEditorSession = {
  itemType: 'wiki' | 'artifact' | 'external';
  itemPath: string;
  contentMode: 'rendered' | 'markdown';
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

export type LibrarianNavigationEntry = {
  itemType: 'wiki' | 'artifact' | 'external';
  itemPath: string;
};

export type LibrarianNavigationHistory = {
  entries: LibrarianNavigationEntry[];
  index: number;
};

export const EMPTY_LIBRARIAN_NAVIGATION_HISTORY: LibrarianNavigationHistory = {
  entries: [],
  index: -1,
};

const LIBRARIAN_NAVIGATION_HISTORY_LIMIT = 50;

function sameLibrarianNavigationEntry(
  a: LibrarianNavigationEntry | null,
  b: LibrarianNavigationEntry | null,
): boolean {
  return !!a && !!b && a.itemType === b.itemType && a.itemPath === b.itemPath;
}

export function pushLibrarianNavigationEntry(
  history: LibrarianNavigationHistory,
  entry: LibrarianNavigationEntry,
  limit: number = LIBRARIAN_NAVIGATION_HISTORY_LIMIT,
): LibrarianNavigationHistory {
  if (sameLibrarianNavigationEntry(history.entries[history.index] ?? null, entry)) {
    return history;
  }

  const entries = [...history.entries.slice(0, history.index + 1), entry];
  const overflow = Math.max(0, entries.length - Math.max(1, limit));
  const cappedEntries = overflow > 0 ? entries.slice(overflow) : entries;
  return {
    entries: cappedEntries,
    index: cappedEntries.length - 1,
  };
}

export function moveLibrarianNavigationHistory(
  history: LibrarianNavigationHistory,
  delta: -1 | 1,
): { history: LibrarianNavigationHistory; entry: LibrarianNavigationEntry } | null {
  const nextIndex = history.index + delta;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return null;
  return {
    history: {
      entries: history.entries,
      index: nextIndex,
    },
    entry: history.entries[nextIndex],
  };
}

export function replaceLibrarianNavigationEntry(
  history: LibrarianNavigationHistory,
  from: LibrarianNavigationEntry,
  to: LibrarianNavigationEntry,
): LibrarianNavigationHistory {
  const entries = history.entries.map((entry) => (
    sameLibrarianNavigationEntry(entry, from) ? to : entry
  ));
  return { ...history, entries };
}

export function restoreLibrarianSelection(storage: Pick<Storage, 'getItem'>): LibrarianStoredSelection | null {
  const raw = storage.getItem(LIBRARIAN_SELECTION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'wiki' && typeof parsed.relPath === 'string' && parsed.relPath.trim()) {
      return {
        type: 'wiki',
        relPath: normalizeWikiRelPath(parsed.relPath),
      };
    }
    if (parsed?.type === 'artifact' && typeof parsed.path === 'string' && parsed.path.trim()) {
      return {
        type: 'artifact',
        path: parsed.path.trim(),
      };
    }
    if (parsed?.type === 'bookmarks') {
      return { type: 'bookmarks' };
    }
  } catch {
    return null;
  }

  return null;
}

export function persistLibrarianSelection(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  selection: LibrarianStoredSelection | null
): void {
  if (!selection) {
    storage.removeItem(LIBRARIAN_SELECTION_STORAGE_KEY);
    return;
  }

  storage.setItem(LIBRARIAN_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

export function restoreLibrarianEditorSession(storage: Pick<Storage, 'getItem'>): LibrarianEditorSession | null {
  const raw = storage.getItem(LIBRARIAN_EDITOR_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      (parsed?.itemType === 'wiki' || parsed?.itemType === 'artifact' || parsed?.itemType === 'external') &&
      typeof parsed.itemPath === 'string' &&
      (parsed.contentMode === 'rendered' || parsed.contentMode === 'markdown')
    ) {
      return {
        itemType: parsed.itemType,
        itemPath: parsed.itemPath,
        contentMode: parsed.contentMode,
        selectionStart: Number.isFinite(parsed.selectionStart) ? Math.max(0, parsed.selectionStart) : 0,
        selectionEnd: Number.isFinite(parsed.selectionEnd) ? Math.max(0, parsed.selectionEnd) : 0,
        scrollTop: Number.isFinite(parsed.scrollTop) ? Math.max(0, parsed.scrollTop) : 0,
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function persistLibrarianEditorSession(
  storage: Pick<Storage, 'setItem'>,
  session: LibrarianEditorSession
): void {
  storage.setItem(LIBRARIAN_EDITOR_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function editorSessionMatchesSelection(
  session: LibrarianEditorSession | null,
  selection: LibrarianStoredSelection | null
): boolean {
  if (!session || !selection) return false;
  if (selection.type === 'wiki') return session.itemType === 'wiki' && session.itemPath === selection.relPath;
  if (selection.type === 'artifact') return session.itemType === 'artifact' && session.itemPath === selection.path;
  return false;
}

export function resolveWikiCreateFolder(
  requestedFolderName: string,
  selectedItemType: 'wiki' | 'artifact' | 'bookmarks' | 'external' | null,
  wikiSelectedRelPath: string | null
): string {
  if (requestedFolderName && requestedFolderName !== 'artifacts') {
    return requestedFolderName;
  }

  if (selectedItemType === 'wiki' && wikiSelectedRelPath?.includes('/')) {
    return wikiSelectedRelPath.split('/')[0];
  }

  return 'entries';
}

export function formatBreadcrumb(
  itemType: 'wiki' | 'external',
  reading: { path: string; title: string } | null,
  wikiRelPath?: string | null,
): string {
  if (!reading) return '';
  if (itemType === 'wiki') {
    const parts = normalizeWikiRelPath(wikiRelPath ?? '').split('/').filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Library';
  }
  const parts = reading.path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : 'External';
}

function clampScrollRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

type MarkdownWikiLinkCompletionState = MarkdownWikiLinkCompletion & {
  top: number;
  left: number;
};

export type MarkdownWikiLinkSuggestion = {
  title: string;
  detail: string;
  kind: 'wiki' | 'artifact' | 'command';
};

function isTwitterLikeWikiLinkSuggestion(item: MarkdownWikiLinkSuggestion): boolean {
  return item.title.trim().startsWith('@') || /(^|\/)@[\w]{1,15}(?:\/|$)/.test(item.detail);
}

export function rankMarkdownWikiLinkSuggestions(
  items: MarkdownWikiLinkSuggestion[],
  query: string,
  limit = 8,
): MarkdownWikiLinkSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items
    .map((item) => {
      const title = item.title.toLowerCase();
      const detail = item.detail.toLowerCase();
      const titleIndex = normalizedQuery ? title.indexOf(normalizedQuery) : 0;
      const detailIndex = normalizedQuery ? detail.indexOf(normalizedQuery) : 0;
      if (normalizedQuery && titleIndex < 0 && detailIndex < 0) return null;
      const matchScore = !normalizedQuery
        ? 4
        : title === normalizedQuery
          ? 0
          : title.startsWith(normalizedQuery)
            ? 1
            : titleIndex >= 0
              ? 2
              : 3;
      const usernamePenalty = isTwitterLikeWikiLinkSuggestion(item) ? 4 : 0;
      return { item, score: matchScore + usernamePenalty };
    })
    .filter((entry): entry is { item: MarkdownWikiLinkSuggestion; score: number } => !!entry)
    .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function getMarkdownWikiLinkCompletionState(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
  position: { top: number; left: number } | null,
): MarkdownWikiLinkCompletionState | null {
  if (!position) return null;
  const completion = getActiveMarkdownWikiLinkCompletion(markdown, selectionStart, selectionEnd);
  return completion ? { ...completion, ...position } : null;
}

export function getScrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return 0;
  return clampScrollRatio(scrollTop / maxScrollTop);
}

export function getScrollTopForRatio(scrollHeight: number, clientHeight: number, ratio: number): number {
  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return 0;
  return maxScrollTop * clampScrollRatio(ratio);
}

export function getMarkdownEditorEdgeFades(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { top: boolean; bottom: boolean } {
  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 1) return { top: false, bottom: false };
  const clampedScrollTop = Math.min(maxScrollTop, Math.max(0, scrollTop));
  return {
    top: clampedScrollTop > 1,
    bottom: false,
  };
}

export function shouldRevealFocusChrome(
  cursorClientY: number,
  paneClientTop: number,
  revealDistancePx = 96,
): boolean {
  if (!Number.isFinite(cursorClientY) || !Number.isFinite(paneClientTop)) return false;
  return cursorClientY >= paneClientTop && cursorClientY <= paneClientTop + Math.max(0, revealDistancePx);
}

export function getLibrarianContentTopPadding(input: {
  contentMode: 'rendered' | 'markdown';
  focusChromeActive: boolean;
  isFullScreen: boolean;
}): number {
  const normalTopPadding = input.contentMode === 'markdown'
    ? LIBRARIAN_MARKDOWN_CONTENT_TOP_PADDING_PX
    : input.isFullScreen
      ? LIBRARIAN_FULLSCREEN_RENDERED_CONTENT_TOP_PADDING_PX
      : LIBRARIAN_RENDERED_CONTENT_TOP_PADDING_PX;

  return input.focusChromeActive
    ? normalTopPadding + LIBRARIAN_DOCUMENT_TOOLBAR_ROW_HEIGHT_PX
    : normalTopPadding;
}

interface LibrarianViewProps {
  active?: boolean;
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
  onFocusChromeActiveChange?: (active: boolean, visualVisible?: boolean) => void;
  onBookmarksCanvasActiveChange?: (active: boolean) => void;
  onBookmarksCanvasToolbarTopChange?: (top: number | null) => void;
  onSelectedItemTypeChange?: (type: LibrarianSelectedItemType) => void;
  initialReadingPath?: string | null; // Auto-select this reading on mount (for auto-open)
  initialOpenTarget?: FieldTheoryMarkdownTarget | null;
  initialFullScreen?: boolean; // Start in legacy fullscreen/immersive mode when supported.
  onInitialReadingConsumed?: () => void; // Called after initial reading is consumed
  onInitialOpenTargetConsumed?: () => void;
  // Path of an artifact the librarian just auto-popped. While the user is
  // still on this artifact, Escape can close the popup-style window. Call
  // onAutoPopArtifactSuperseded when the user navigates away from it.
  autoPopArtifactPath?: string | null;
  onAutoPopArtifactSuperseded?: () => void;
  onOpenCommandPath?: (path: string) => void;
  onFocusChromeShortcut?: () => void;
  onActiveFileUpdatedChange?: (file: { path: string; title: string; mtime: number } | null) => void;
  preserveCurrentSizeKey?: boolean;
  // Sidebar collapse state is owned by ClipboardHistory so the footer
  // toggle can drive it regardless of which view is active.
  sidebarCollapsed: boolean;
}

function isArtifactModelSignatureText(text: string): boolean {
  return /^(Model|Signed by):\s+.+$/i.test(text.trim());
}

type MarkdownRenderNode = {
  type?: string;
  value?: unknown;
  children?: unknown;
  properties?: {
    className?: unknown;
  };
};

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

type RenderedTextPoint = {
  text: string;
  offset: number;
};

function extractMarkdownText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const renderNode = node as MarkdownRenderNode;
  if (renderNode.type === 'text' && typeof renderNode.value === 'string') return renderNode.value;
  if (Array.isArray(renderNode.children)) return renderNode.children.map(extractMarkdownText).join('');
  return '';
}

function isRenderedTaskListItem(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const className = (node as MarkdownRenderNode).properties?.className;
  if (Array.isArray(className)) return className.includes('task-list-item');
  return className === 'task-list-item';
}

function stripLeadingCarrotListSentinel(children: ReactNode): ReactNode {
  let stripped = false;

  const stripNode = (node: ReactNode): ReactNode => {
    if (stripped) return node;
    if (typeof node === 'string') {
      if (!node.startsWith(CARROT_LIST_SENTINEL)) return node;
      stripped = true;
      return node.slice(CARROT_LIST_SENTINEL.length);
    }
    if (Array.isArray(node)) {
      return Children.map(node, stripNode);
    }
    if (isValidElement<{ children?: ReactNode }>(node)) {
      const childProps = node.props as { children?: ReactNode };
      if (childProps.children === undefined) return node;
      return cloneElement(
        node as ReactElement<{ children?: ReactNode }>,
        undefined,
        stripNode(childProps.children),
      );
    }
    return node;
  };

  return Children.map(children, stripNode);
}

function splitTaskListItemChildren(children: ReactNode): { checkbox: ReactNode | null; content: ReactNode[] } {
  const nodes = Children.toArray(children);
  const checkboxIndex = nodes.findIndex((child) =>
    isValidElement(child) && typeof child.type === 'string' && child.type === 'input',
  );
  if (checkboxIndex < 0) return { checkbox: null, content: nodes };
  const checkbox = nodes[checkboxIndex];
  const content = nodes.filter((_, index) => index !== checkboxIndex);
  return { checkbox, content };
}

const WIKI_LINK_DIRECTION_MARKER: Record<MarkdownLinkedDocument['direction'], string> = {
  outbound: '→',
  inbound: '←',
  bidirectional: '↔',
};

const WIKI_LINK_DIRECTION_LABEL: Record<MarkdownLinkedDocument['direction'], string> = {
  outbound: 'This document links out',
  inbound: 'Links back to this document',
  bidirectional: 'Linked both ways',
};

const WIKI_LINK_TARGET_LABEL: Record<WikiLinkTarget['kind'], string> = {
  wiki: 'Wiki',
  artifact: 'Artifact',
  command: 'Command',
};

function getRenderedTextCaretFromPoint(event: React.MouseEvent): RenderedTextPoint | null {
  const doc = event.currentTarget.ownerDocument as CaretPointDocument;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position?.offsetNode.nodeType === Node.TEXT_NODE) {
    const textNode = position.offsetNode as Text;
    return {
      text: textNode.textContent ?? '',
      offset: position.offset,
    };
  }

  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range?.startContainer.nodeType !== Node.TEXT_NODE) return null;
  const textNode = range.startContainer as Text;
  return {
    text: textNode.textContent ?? '',
    offset: range.startOffset,
  };
}

function LibrarianView({ active = true, onSwitchToClipboard, onSwitchToSettings, onFullScreenChange, onFocusChromeActiveChange, onBookmarksCanvasActiveChange, onBookmarksCanvasToolbarTopChange, onSelectedItemTypeChange, initialReadingPath, initialOpenTarget, initialFullScreen, onInitialReadingConsumed, onInitialOpenTargetConsumed, autoPopArtifactPath, onAutoPopArtifactSuperseded, onOpenCommandPath, onFocusChromeShortcut, onActiveFileUpdatedChange, preserveCurrentSizeKey = false, sidebarCollapsed }: LibrarianViewProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();
  const restoredSelection = useMemo(() => restoreLibrarianSelection(localStorage), []);
  const restoredEditorSession = useMemo(() => restoreLibrarianEditorSession(localStorage), []);
  const restoredEditorSessionRef = useRef<LibrarianEditorSession | null>(restoredEditorSession);

  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => restoredSelection?.type === 'artifact' ? restoredSelection.path : null);
  const [selectedReading, setSelectedReading] = useState<Reading | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null); // null = loading

  // Edit state. Auto-save keeps disk in sync; `saveStatus` remains internal so
  // save flows can settle without flashing toolbar text.
  const [editContent, setEditContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Populated when there's unsaved content pending — call to flush the
  // pending debounced save synchronously (Esc, Cmd+S, switching files).
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  // Tracks what's actually on disk. activeReading.content goes stale after
  // the first save (we intentionally don't re-fetch to preserve the
  // textarea's native undo stack), so comparing against it would miss the
  // "typed a char then deleted it" case.
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedVersionRef = useRef<DocumentVersion | null>(null);
  const [textSize, setTextSize] = useState<'small' | 'normal' | 'large'>(() => {
    const saved = localStorage.getItem('librarian-text-size');
    return (saved === 'small' || saved === 'normal' || saved === 'large') ? saved : 'normal';
  });
  const [typographyPresetId, setTypographyPresetId] = useState<LibrarianTypographyPresetId>(() => (
    restoreLibrarianTypographyPreset(localStorage)
  ));
  const [lineHeightId, setLineHeightId] = useState<LibrarianLineHeightId>(() => (
    restoreLibrarianLineHeight(localStorage)
  ));
  const [unorderedListMarker, setUnorderedListMarker] = useState<LibrarianUnorderedListMarker>(() => (
    restoreLibrarianUnorderedListMarker(localStorage)
  ));
  const [todoMarker, setTodoMarker] = useState<LibrarianTodoMarker>(() => (
    restoreLibrarianTodoMarker(localStorage)
  ));
  const [blinkTextCursor, setBlinkTextCursor] = useState(() => restoreTextCursorBlink(localStorage));
  const [renderedEditClickMode, setRenderedEditClickMode] = useState(() => restoreRenderedEditClickMode(localStorage));
  const [renderedSelectionToolbar, setRenderedSelectionToolbar] = useState<{
    start: number;
    end: number;
    top: number;
    left: number;
  } | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => {
    if (!restoredSelection) return null;
    if (restoredSelection.type === 'wiki') return `wiki:${restoredSelection.relPath}`;
    if (restoredSelection.type === 'artifact') return `artifact:${restoredSelection.path}`;
    return BOOKMARKS_ITEM_ID;
  });
  const [selectedItemType, setSelectedItemType] = useState<'wiki' | 'artifact' | 'bookmarks' | 'external' | null>(() => restoredSelection?.type ?? null);
  const selectedItemUsesLegacyImmersive = selectedItemType === 'bookmarks';
  const [isFullScreen, setIsFullScreen] = useState(() => (
    restoredSelection?.type === 'bookmarks' ? initialFullScreen ?? false : false
  ));
  const [focusImmersive, setFocusImmersive] = useState(false);
  const toggleImmersive = useCallback(() => {
    if (selectedItemUsesLegacyImmersive) {
      setIsFullScreen((prev) => !prev);
      return;
    }
    if (!focusImmersive) {
      onFocusChromeShortcut?.();
    }
    setFocusImmersive((prev) => !prev);
  }, [focusImmersive, onFocusChromeShortcut, selectedItemUsesLegacyImmersive]);
  const [writingChromeHidden, setWritingChromeHidden] = useState(false);
  const markdownEditorEdgeFadesRef = useRef({ top: false, bottom: false });
  const [markdownDocumentTopFade, setMarkdownDocumentTopFade] = useState(false);
  const [renderedDocumentTopFade, setRenderedDocumentTopFade] = useState(false);
  const [markdownUrlPasteChoice, setMarkdownUrlPasteChoice] = useState<MarkdownUrlPasteEdit | null>(null);
  const [markdownWikiLinkCompletion, setMarkdownWikiLinkCompletion] = useState<MarkdownWikiLinkCompletionState | null>(null);
  const [markdownWikiLinkSuggestionIndex, setMarkdownWikiLinkSuggestionIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('librarian-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [discoveredDirs, setDiscoveredDirs] = useState<string[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [addingDir, setAddingDir] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFindOpen, setFileFindOpen] = useState(false);
  const [fileFindQuery, setFileFindQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarPaneRef = useRef<HTMLDivElement | null>(null);
  const sidebarInnerRef = useRef<HTMLDivElement | null>(null);
  const flatItemsRef = useRef<import('./WikiSidebar').UnifiedItem[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileFindInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarKeyboardActiveRef = useRef(false);
  const [sidebarKeyboardActive, setSidebarKeyboardActive] = useState(false);
  const [sidebarTodoStateOverrides, setSidebarTodoStateOverrides] = useState<Record<string, MarkdownTodoState | null>>({});
  const wikiCreationRef = useRef<WikiCreationController | null>(null);
  const readerPaneRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const renderedContentRef = useRef<HTMLDivElement | null>(null);
  const markdownCodeEditorRef = useRef<MarkdownCodeEditorHandle | null>(null);
  const renderedSaveTimerRef = useRef<number | null>(null);
  const pendingRenderedSaveRef = useRef<(() => void) | null>(null);

  const renderedScrollSamplerRef = useScrollFpsSampler('rendered');
  const setContentScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      contentScrollRef.current = el;
      renderedScrollSamplerRef(el);
    },
    [renderedScrollSamplerRef],
  );
  const pendingRenderedEditSelectionRef = useRef<number | null>(null);
  const pendingTitleEditPathRef = useRef<string | null>(null);
  const titleCommitInFlightRef = useRef(false);
  const [editingTitlePath, setEditingTitlePath] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const previousRenderedTaskContentRef = useRef<{ path: string | null; content: string } | null>(null);
  const taskAnimationTimerRef = useRef<number | null>(null);
  const [animatingTaskTexts, setAnimatingTaskTexts] = useState<Set<string>>(() => new Set());
  const focusMarkdownEditorOnOpenRef = useRef(false);
  const editorSessionPersistTimerRef = useRef<number | null>(null);
  const pendingScrollRatioRef = useRef<number | null>(null);
  const copyPathFeedbackTimerRef = useRef<number | null>(null);
  const markdownEditUndoStackRef = useRef<MarkdownUndoSnapshot[]>([]);

  const activateSidebarKeyboard = useCallback(() => {
    sidebarKeyboardActiveRef.current = true;
    setSidebarKeyboardActive(true);
  }, []);

  const deactivateSidebarKeyboard = useCallback(() => {
    sidebarKeyboardActiveRef.current = false;
    setSidebarKeyboardActive(false);
  }, []);

  const updateSelectedSidebarTodoState = useCallback((state: MarkdownTodoState | null) => {
    if (!selectedItemId || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) return;
    setSidebarTodoStateOverrides((prev) => (
      prev[selectedItemId] === state ? prev : { ...prev, [selectedItemId]: state }
    ));
  }, [selectedItemId, selectedItemType]);

  // Sharing state
  const [shareStatus, setShareStatus] = useState<{ shared: boolean; slug?: string; url?: string } | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyPathCopied, setCopyPathCopied] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [bookmarksCanvasActive, setBookmarksCanvasActive] = useState<boolean>(() => localStorage.getItem('bookmarks-view-mode') !== 'list');

  // Narration state
  const [narrationStatus, setNarrationStatus] = useState<{
    playbackStatus: 'idle' | 'generating' | 'playing' | 'paused' | 'stopped';
    currentReadingPath: string | null;
  }>({ playbackStatus: 'idle', currentReadingPath: null });
  const [narrationPrefs, setNarrationPrefs] = useState<{
    speakOnOpen: boolean;
    blockedDevices: string[];
  } | null>(null);

  // Mute for today state
  const [isMutedForToday, setIsMutedForToday] = useState(false);
  const [isMuting, setIsMuting] = useState(false);

  // Content mode: 'rendered' shows formatted prose, 'markdown' shows editable raw source
  const [contentMode, setContentMode] = useState<'rendered' | 'markdown'>(() => (
    editorSessionMatchesSelection(restoredEditorSession, restoredSelection)
      ? restoredEditorSession?.contentMode ?? 'rendered'
      : 'rendered'
  ));
  const canUseFocusImmersive = selectedItemType === 'wiki' || selectedItemType === 'artifact' || selectedItemType === 'external';
  const isFocusedWritingMode = canUseFocusImmersive && !isFullScreen && sidebarCollapsed && contentMode === 'markdown';
  const bookmarksFullscreenChromeActive = isBookmarksCanvasChromeActive({
    active,
    selectedItemType,
    isFullScreen,
    bookmarksCanvasActive,
  });
  const focusChromeActive =
    bookmarksFullscreenChromeActive ||
    isLibrarianDocumentFocusChromeActive({
      canUseFocusImmersive,
      isFullScreen,
      sidebarCollapsed,
      focusImmersive,
      isFocusedWritingMode,
      writingChromeHidden,
    });
  const focusChromeUsesProximityFade = focusChromeActive;
  const [focusChromeProximityVisible, setFocusChromeProximityVisible] = useState(false);
  const [focusToolbarMenuOpen, setFocusToolbarMenuOpen] = useState(false);
  const focusChromePinnedVisible = fileFindOpen || focusToolbarMenuOpen;
  const focusChromeVisualVisible = !focusChromeUsesProximityFade || focusChromeProximityVisible || focusChromePinnedVisible;
  const focusToolbarControlsVisible = !focusChromeActive || (focusChromeUsesProximityFade && (focusChromeProximityVisible || focusChromePinnedVisible));
  const contentTopPadding = getLibrarianContentTopPadding({
    contentMode,
    focusChromeActive,
    isFullScreen,
  });
  const toggleFocusChromeShortcut = useCallback(() => {
    if (!selectedItemUsesLegacyImmersive && focusChromeActive) {
      setFocusImmersive(false);
      setWritingChromeHidden(false);
      return;
    }
    toggleImmersive();
  }, [focusChromeActive, selectedItemUsesLegacyImmersive, toggleImmersive]);
  const markWritingActive = useCallback(() => {
    if (isFocusedWritingMode) setWritingChromeHidden(true);
  }, [isFocusedWritingMode]);

  const setMarkdownEditorFades = useCallback((next: { top: boolean; bottom: boolean }) => {
    const current = markdownEditorEdgeFadesRef.current;
    if (current.top === next.top && current.bottom === next.bottom) return;
    markdownEditorEdgeFadesRef.current = next;
    setMarkdownDocumentTopFade((visible) => visible === next.top ? visible : next.top);
  }, []);

  const updateMarkdownEditorFades = useCallback((editor: Pick<MarkdownCodeEditorHandle, 'scrollTop' | 'scrollHeight' | 'clientHeight'> | null) => {
    setMarkdownEditorFades(editor
      ? getMarkdownEditorEdgeFades(editor.scrollTop, editor.scrollHeight, editor.clientHeight)
      : { top: false, bottom: false });
  }, [setMarkdownEditorFades]);

  const updateRenderedDocumentTopFade = useCallback((scrollEl: Pick<HTMLDivElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'> | null) => {
    const next = !!scrollEl && scrollEl.scrollHeight - scrollEl.clientHeight > 1 && scrollEl.scrollTop > 1;
    setRenderedDocumentTopFade((current) => current === next ? current : next);
  }, []);

  // Lazy keep-alive: once the user has visited Bookmarks, the pane stays mounted
  // (hidden via CSS) so its DOM pool, snapshot cache, scroll/camera state, and
  // search input persist across sidebar switches.
  const [bookmarksEverShown, setBookmarksEverShown] = useState<boolean>(() => restoredSelection?.type === 'bookmarks');
  const [wikiSelectedRelPath, setWikiSelectedRelPath] = useState<string | null>(() => restoredSelection?.type === 'wiki' ? restoredSelection.relPath : null);
  const [wikiSelectedPage, setWikiSelectedPage] = useState<Reading | null>(null);
  // Local agent kickoff modal — opened by the toolbar agent button. Dispatches
  // the user's locally-installed Claude Code or Codex CLI against the active
  // markdown file and appends a summary footer on success.
  const [agentKickoffOpen, setAgentKickoffOpen] = useState(false);
  // External markdown files opened via macOS file-association (`open-file`)
  // whose canonical path falls outside the wiki root. Stored in Reading shape
  // so activeReading can unify over it; save branches on selectedItemType.
  const [externalOpenFile, setExternalOpenFile] = useState<Reading | null>(null);
  // Flat list of every wiki page for resolving [[wikilinks]] by title or
  // relPath. Refreshed from getTree() on mount and on `onPageChanged`.
  const [wikiIndexPages, setWikiIndexPages] = useState<WikiIndexInput[]>([]);
  const [markdownLinkRelationDocuments, setMarkdownLinkRelationDocuments] = useState<MarkdownLinkRelationDocument[]>([]);
  const [commandIndexPages, setCommandIndexPages] = useState<WikiIndexInput[]>([]);
  const [navigationHistory, setNavigationHistory] = useState<LibrarianNavigationHistory>(EMPTY_LIBRARIAN_NAVIGATION_HISTORY);
  const historyNavigationTargetRef = useRef<LibrarianNavigationEntry | null>(null);

  const selectArtifactPath = useCallback((artifactPath: string) => {
    setSelectedItemId(`artifact:${artifactPath}`);
    setSelectedItemType('artifact');
    setSelectedPath(artifactPath);
    setWikiSelectedRelPath(null);
    setExternalOpenFile(null);
  }, []);

  // Load an external markdown file (outside wiki root) into the editor.
  // Deduped against the current external selection so re-opening the same
  // file is a no-op — preserves the native textarea undo stack.
  const selectExternalFile = useCallback(async (absPath: string): Promise<void> => {
    if (externalOpenFile?.path === absPath && selectedItemType === 'external') {
      return;
    }
    await flushSaveRef.current?.();
    const file = await window.externalAPI?.open(absPath);
    if (!file) return;
    const reading = readingFromExternalMarkdownFile(file);
    setExternalOpenFile(reading);
    setSelectedItemId(`external:${file.path}`);
    setSelectedItemType('external');
    setSelectedPath(null);
    setWikiSelectedRelPath(null);
    setContentMode('rendered');
    void window.recentAPI?.visit({
      kind: 'external',
      path: file.path,
      title: reading.title,
      lastOpenedAt: Date.now(),
    });
  }, [externalOpenFile?.path, selectedItemType]);

  const openWikiPage = useCallback((relPath: string) => {
    const normalized = normalizeWikiRelPath(relPath);
    if (!normalized) return;
    setSelectedItemId(`wiki:${normalized}`);
    setSelectedItemType('wiki');
    setWikiSelectedRelPath(normalized);
    setSelectedPath(null);
    setExternalOpenFile(null);
  }, []);

  // Click on an unresolved [[wikilink]] — create the page in scratchpad using
  // the target text as the filename/title, then open it.
  const createUnresolvedWikiLink = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const page = await window.wikiAPI?.createFile('scratchpad', trimmed);
    if (page?.relPath) {
      dispatchLocalWikiAdded(page);
      openWikiPage(page.relPath);
    }
  }, [openWikiPage]);

  const openLinkAction = useCallback((action: LinkAction) => {
    switch (action.kind) {
      case 'create':
        void createUnresolvedWikiLink(action.title);
        return;
      case 'wiki':
        openWikiPage(action.relPath);
        return;
      case 'artifact':
        selectArtifactPath(action.path);
        return;
      case 'command':
        onOpenCommandPath?.(action.path);
        return;
      case 'external':
        window.shellAPI?.openExternal(action.href);
        return;
      case 'noop':
        return;
    }
  }, [createUnresolvedWikiLink, onOpenCommandPath, openWikiPage, selectArtifactPath]);

  const openMarkdownLinkTarget = useCallback((target: WikiLinkTarget) => {
    switch (target.kind) {
      case 'wiki':
        openWikiPage(target.relPath);
        return;
      case 'artifact':
        selectArtifactPath(target.path);
        return;
      case 'command':
        onOpenCommandPath?.(target.path);
        return;
    }
  }, [onOpenCommandPath, openWikiPage, selectArtifactPath]);

  const currentNavigationEntry = useMemo((): LibrarianNavigationEntry | null => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      return { itemType: 'wiki', itemPath: wikiSelectedRelPath };
    }
    if (selectedItemType === 'artifact' && selectedPath) {
      return { itemType: 'artifact', itemPath: selectedPath };
    }
    if (selectedItemType === 'external' && externalOpenFile?.path) {
      return { itemType: 'external', itemPath: externalOpenFile.path };
    }
    return null;
  }, [externalOpenFile?.path, selectedItemType, selectedPath, wikiSelectedRelPath]);

  const flushCurrentEdit = useCallback(async () => {
    await flushSaveRef.current?.();
  }, []);

  const openNavigationEntry = useCallback(async (entry: LibrarianNavigationEntry) => {
    await flushCurrentEdit();
    if (entry.itemType === 'wiki') {
      openWikiPage(entry.itemPath);
    } else if (entry.itemType === 'artifact') {
      selectArtifactPath(entry.itemPath);
    } else {
      await selectExternalFile(entry.itemPath);
    }
  }, [flushCurrentEdit, openWikiPage, selectArtifactPath, selectExternalFile]);

  const navigateHistory = useCallback((delta: -1 | 1) => {
    const next = moveLibrarianNavigationHistory(navigationHistory, delta);
    if (!next) return;
    historyNavigationTargetRef.current = next.entry;
    setNavigationHistory(next.history);
    void openNavigationEntry(next.entry);
  }, [navigationHistory, openNavigationEntry]);

  const canNavigateBack = navigationHistory.index > 0;
  const canNavigateForward = navigationHistory.index >= 0 && navigationHistory.index < navigationHistory.entries.length - 1;

  // Handle initial reading path from parent (auto-open flow)
  useEffect(() => {
    if (initialReadingPath) {
      selectArtifactPath(initialReadingPath);
      onInitialReadingConsumed?.();
    }
  }, [initialReadingPath, onInitialReadingConsumed, selectArtifactPath]);

  // Persist text size preference
  useEffect(() => {
    localStorage.setItem('librarian-text-size', textSize);
  }, [textSize]);

  useEffect(() => {
    persistLibrarianTypographyPreset(localStorage, typographyPresetId);
  }, [typographyPresetId]);

  useEffect(() => {
    persistLibrarianLineHeight(localStorage, lineHeightId);
  }, [lineHeightId]);

  useEffect(() => {
    persistLibrarianUnorderedListMarker(localStorage, unorderedListMarker);
  }, [unorderedListMarker]);

  useEffect(() => {
    persistLibrarianTodoMarker(localStorage, todoMarker);
  }, [todoMarker]);

  useEffect(() => {
    const syncTextCursorBlink = () => setBlinkTextCursor(restoreTextCursorBlink(localStorage));
    window.addEventListener('storage', syncTextCursorBlink);
    window.addEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, syncTextCursorBlink);
    return () => {
      window.removeEventListener('storage', syncTextCursorBlink);
      window.removeEventListener(TEXT_CURSOR_BLINK_CHANGED_EVENT, syncTextCursorBlink);
    };
  }, []);

  useEffect(() => {
    const syncRenderedEditClickMode = () => setRenderedEditClickMode(restoreRenderedEditClickMode(localStorage));
    window.addEventListener('storage', syncRenderedEditClickMode);
    window.addEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, syncRenderedEditClickMode);
    return () => {
      window.removeEventListener('storage', syncRenderedEditClickMode);
      window.removeEventListener(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, syncRenderedEditClickMode);
    };
  }, []);

  // Check mute status on mount
  useEffect(() => {
    window.librarianAPI?.isMutedForToday().then((muted) => {
      setIsMutedForToday(muted ?? false);
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    const scheduleIdle = window.requestIdleCallback
      ? (callback: IdleRequestCallback) => window.requestIdleCallback(callback, { timeout: 2000 })
      : (callback: IdleRequestCallback) => window.setTimeout(() => {
        callback({ didTimeout: false, timeRemaining: () => 0 });
      }, 500);
    const cancelIdle = window.cancelIdleCallback
      ? (handle: number) => window.cancelIdleCallback(handle)
      : (handle: number) => window.clearTimeout(handle);
    const handle = scheduleIdle(() => prefetchBookmarks());
    return () => cancelIdle(handle);
  }, [active]);

  const applySidebarWidth = useCallback((width: number) => {
    const nextWidth = `${width}px`;
    if (sidebarPaneRef.current) {
      sidebarPaneRef.current.style.width = nextWidth;
      sidebarPaneRef.current.style.minWidth = nextWidth;
    }
    if (sidebarInnerRef.current) {
      sidebarInnerRef.current.style.width = nextWidth;
    }
  }, []);

  // Persist sidebar width
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (isResizing) return;
    localStorage.setItem('librarian-sidebar-width', String(sidebarWidth));
  }, [isResizing, sidebarWidth]);

  useEffect(() => {
    if (selectedItemType === 'bookmarks' && !bookmarksEverShown) {
      setBookmarksEverShown(true);
    }
  }, [selectedItemType, bookmarksEverShown]);

  useEffect(() => {
    onSelectedItemTypeChange?.(active ? selectedItemType : null);
  }, [active, onSelectedItemTypeChange, selectedItemType]);

  useEffect(() => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      persistLibrarianSelection(localStorage, { type: 'wiki', relPath: wikiSelectedRelPath });
      return;
    }
    if (selectedItemType === 'artifact' && selectedPath) {
      persistLibrarianSelection(localStorage, { type: 'artifact', path: selectedPath });
      return;
    }
    if (selectedItemType === 'bookmarks') {
      persistLibrarianSelection(localStorage, { type: 'bookmarks' });
      return;
    }
    if (selectedItemType === 'external') {
      // External files are transient — don't overwrite the stored wiki/
      // artifact/bookmarks selection, so closing and reopening the library
      // restores the durable view.
      return;
    }
    if (selectedPath) {
      persistLibrarianSelection(localStorage, { type: 'artifact', path: selectedPath });
      return;
    }
    persistLibrarianSelection(localStorage, null);
  }, [selectedItemType, selectedPath, wikiSelectedRelPath]);

  useEffect(() => {
    if (!currentNavigationEntry) return;

    if (sameLibrarianNavigationEntry(historyNavigationTargetRef.current, currentNavigationEntry)) {
      historyNavigationTargetRef.current = null;
      return;
    }

    setNavigationHistory((prev) => pushLibrarianNavigationEntry(prev, currentNavigationEntry));
  }, [currentNavigationEntry]);

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarWidthRef.current = sidebarWidth;
    setIsResizing(true);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const newWidth = e.clientX - containerRect.left;
      // Clamp between 120px and 400px
      const clampedWidth = Math.max(120, Math.min(400, newWidth));
      sidebarWidthRef.current = clampedWidth;
      applySidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setSidebarWidth(sidebarWidthRef.current);
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [applySidebarWidth, isResizing]);

  // Notify parent of full-screen state (including initial state on mount)
  useEffect(() => {
    onFullScreenChange?.(isFullScreen);
  }, [isFullScreen, onFullScreenChange]);

  useEffect(() => {
    if (selectedItemType && !selectedItemUsesLegacyImmersive && isFullScreen) {
      setIsFullScreen(false);
    }
  }, [isFullScreen, selectedItemType, selectedItemUsesLegacyImmersive]);

  useEffect(() => {
    if (!isFocusedWritingMode) setWritingChromeHidden(false);
  }, [isFocusedWritingMode]);

  useEffect(() => {
    if (!canUseFocusImmersive) setFocusImmersive(false);
  }, [canUseFocusImmersive]);

  useEffect(() => {
    if (!focusChromeUsesProximityFade) {
      setFocusChromeProximityVisible(false);
      return;
    }

    const updateProximity = (event: MouseEvent) => {
      const paneTop = readerPaneRef.current?.getBoundingClientRect().top ?? 0;
      setFocusChromeProximityVisible(shouldRevealFocusChrome(event.clientY, paneTop));
    };
    const hideProximityChrome = () => setFocusChromeProximityVisible(false);

    window.addEventListener('mousemove', updateProximity);
    window.addEventListener('mouseleave', hideProximityChrome);
    return () => {
      window.removeEventListener('mousemove', updateProximity);
      window.removeEventListener('mouseleave', hideProximityChrome);
    };
  }, [focusChromeUsesProximityFade]);

  useEffect(() => {
    onFocusChromeActiveChange?.(active && focusChromeActive, active && focusChromeActive && focusChromeVisualVisible);
  }, [active, focusChromeActive, focusChromeVisualVisible, onFocusChromeActiveChange]);

  useEffect(() => {
    onBookmarksCanvasActiveChange?.(bookmarksFullscreenChromeActive);
  }, [bookmarksFullscreenChromeActive, onBookmarksCanvasActiveChange]);

  useEffect(() => {
    return () => {
      onFocusChromeActiveChange?.(false);
      onBookmarksCanvasActiveChange?.(false);
      onBookmarksCanvasToolbarTopChange?.(null);
    };
  }, [onBookmarksCanvasActiveChange, onBookmarksCanvasToolbarTopChange, onFocusChromeActiveChange]);

  // Keep Library fullscreen in the same click-away dismissal path as the panel.
  useEffect(() => {
    if (!active) return;
    const dismissable = isFullScreen;
    window.librarianAPI?.setImmersiveDismissable?.(dismissable);
    return () => window.librarianAPI?.setImmersiveDismissable?.(false);
  }, [active, isFullScreen]);

  // Push 'library' size-key for document sections. Bookmarks keeps the
  // incoming window size in list mode and only overrides size for canvas.
  useEffect(() => {
    if (!active || preserveCurrentSizeKey) return;
    if (selectedItemType === 'bookmarks') return;
    window.librarianAPI?.setSizeKey?.('library');
  }, [active, preserveCurrentSizeKey, selectedItemType]);

  // Initialize narration state and subscribe to events (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED) return;

    // Load initial narration status
    window.narrationAPI?.getStatus().then((status) => {
      if (status) {
        setNarrationStatus({
          playbackStatus: status.playbackStatus,
          currentReadingPath: status.currentReadingPath,
        });
      }
    });

    // Load narration preferences
    window.narrationAPI?.getPrefs().then((prefs) => {
      if (prefs) {
        setNarrationPrefs({
          speakOnOpen: prefs.speakOnOpen,
          blockedDevices: prefs.blockedDevices,
        });
      }
    });

    // Subscribe to playback events
    const unsubGenerating = window.narrationAPI?.onGenerationStarted?.((readingPath) => {
      setNarrationStatus({ playbackStatus: 'generating', currentReadingPath: readingPath });
    });

    const unsubStarted = window.narrationAPI?.onPlaybackStarted((readingPath) => {
      setNarrationStatus({ playbackStatus: 'playing', currentReadingPath: readingPath });
    });

    const unsubStopped = window.narrationAPI?.onPlaybackStopped(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    const unsubError = window.narrationAPI?.onPlaybackError(() => {
      setNarrationStatus({ playbackStatus: 'idle', currentReadingPath: null });
    });

    return () => {
      unsubGenerating?.();
      unsubStarted?.();
      unsubStopped?.();
      unsubError?.();
    };
  }, []);

  const textSizes = {
    small: { base: '14px', h1: '20px', h2: '16px', h3: '14px' },
    normal: { base: '16px', h1: '22px', h2: '18px', h3: '16px' },
    large: { base: '18px', h1: '26px', h2: '21px', h3: '18px' },
  };

  const typographyPreset = useMemo(
    () => LIBRARIAN_TYPOGRAPHY_PRESETS.find((preset) => preset.id === typographyPresetId) ?? LIBRARIAN_TYPOGRAPHY_PRESETS[0],
    [typographyPresetId],
  );

  const activeReading: Reading | null =
    selectedItemType === 'wiki' ? wikiSelectedPage :
    selectedItemType === 'external' ? externalOpenFile :
    selectedReading;
  const activeTitlePath =
    activeReading && (selectedItemType === 'wiki' || selectedItemType === 'external')
      ? activeReading.path
      : null;

  useEffect(() => {
    onActiveFileUpdatedChange?.(active && activeReading
      ? { path: activeReading.path, title: activeReading.title, mtime: activeReading.mtime }
      : null);
  }, [active, activeReading?.mtime, activeReading?.path, activeReading?.title, onActiveFileUpdatedChange]);

  useEffect(() => {
    if (!active || !activeReading || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) {
      void window.commandsAPI?.setActiveLibraryFileContext?.(null);
      return;
    }

    const sidebarItem = flatItemsRef.current.find((item) => (
      item.id === selectedItemId || item.absPath === activeReading.path
    ));
    if (!sidebarItem?.rootPath || !sidebarItem.relPath || (sidebarItem.type !== 'wiki' && sidebarItem.type !== 'external')) {
      void window.commandsAPI?.setActiveLibraryFileContext?.(null);
      return;
    }

    void window.commandsAPI?.setActiveLibraryFileContext?.({
      type: sidebarItem.type,
      rootPath: sidebarItem.rootPath,
      relPath: sidebarItem.relPath,
      filePath: sidebarItem.absPath,
      title: sidebarItem.title,
    });
  }, [active, activeReading?.path, activeReading?.title, selectedItemId, selectedItemType]);

  useEffect(() => {
    if (!activeTitlePath || editingTitlePath !== activeTitlePath) {
      setTitleDraft(activeReading?.title ?? '');
    }
  }, [activeReading?.title, activeTitlePath, editingTitlePath]);

  useEffect(() => {
    if (!activeTitlePath || pendingTitleEditPathRef.current !== activeTitlePath) return;
    pendingTitleEditPathRef.current = null;
    setEditingTitlePath(activeTitlePath);
    setTitleDraft(activeReading?.title ?? '');
  }, [activeReading?.title, activeTitlePath]);

  useEffect(() => {
    if (!activeTitlePath || editingTitlePath !== activeTitlePath) return;
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus({ preventScroll: true });
      titleInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTitlePath, editingTitlePath]);

  const focusMarkdownBody = useCallback(() => {
    if (contentMode !== 'markdown') {
      focusMarkdownEditorOnOpenRef.current = true;
      setContentMode('markdown');
      return;
    }
    requestAnimationFrame(() => {
      markdownCodeEditorRef.current?.focus({ preventScroll: true });
    });
  }, [contentMode]);

  const beginTitleEdit = useCallback(() => {
    if (!activeReading || !activeTitlePath) return;
    setTitleDraft(activeReading.title);
    setEditingTitlePath(activeTitlePath);
  }, [activeReading, activeTitlePath]);

  const commitTitleEdit = useCallback(async (options: { focusBody?: boolean } = {}) => {
    if (!activeReading || !activeTitlePath || titleCommitInFlightRef.current) return;
    const trimmed = (titleInputRef.current?.value ?? titleDraft).trim();
    if (!trimmed || trimmed === activeReading.title) {
      setEditingTitlePath(null);
      setTitleDraft(activeReading.title);
      if (options.focusBody) focusMarkdownBody();
      return;
    }

    titleCommitInFlightRef.current = true;
    setTitleDraft(trimmed);
    try {
      await flushCurrentEdit();

      if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
        const oldRelPath = wikiSelectedRelPath;
        const nextRelPath = await window.wikiAPI?.rename(oldRelPath, trimmed);
        if (!nextRelPath) {
          setTitleDraft(activeReading.title);
          return;
        }

        dispatchLocalWikiRenamed({
          rootPath: '',
          oldRelPath,
          newRelPath: nextRelPath,
          oldAbsPath: activeReading.path,
          newAbsPath: getRenamedWikiAbsPath(activeReading.path, oldRelPath, nextRelPath),
          builtin: true,
          source: 'app',
          detectedAt: Date.now(),
          emittedAt: Date.now(),
        });

        if (nextRelPath !== oldRelPath) {
          const from = { itemType: 'wiki' as const, itemPath: oldRelPath };
          const to = { itemType: 'wiki' as const, itemPath: nextRelPath };
          historyNavigationTargetRef.current = to;
          setNavigationHistory((prev) => replaceLibrarianNavigationEntry(prev, from, to));
          setSelectedItemId(`wiki:${nextRelPath}`);
          setWikiSelectedRelPath(nextRelPath);
        }

        const page = await window.wikiAPI?.getPage(nextRelPath);
        if (page) {
          setWikiSelectedPage(readingFromWikiPage(page));
          setTitleDraft(page.title);
          void window.recentAPI?.visit({
            kind: 'wiki',
            path: nextRelPath,
            title: page.title,
            lastOpenedAt: Date.now(),
          });
        }
      } else if (selectedItemType === 'external') {
        const file = await window.externalAPI?.rename(activeReading.path, trimmed);
        if (!file) {
          setTitleDraft(activeReading.title);
          return;
        }
        const reading = readingFromExternalMarkdownFile(file);
        setExternalOpenFile(reading);
        setSelectedItemId(`external:${file.path}`);
        setTitleDraft(reading.title);
        void window.recentAPI?.visit({
          kind: 'external',
          path: file.path,
          title: reading.title,
          lastOpenedAt: Date.now(),
        });
      }
    } finally {
      titleCommitInFlightRef.current = false;
      setEditingTitlePath(null);
    }

    if (options.focusBody) focusMarkdownBody();
  }, [
    activeReading,
    activeTitlePath,
    focusMarkdownBody,
    flushCurrentEdit,
    selectedItemType,
    titleDraft,
    wikiSelectedRelPath,
  ]);

  const commitTitleEditIfActive = useCallback(() => {
    const titleInputFocused = document.activeElement === titleInputRef.current;
    if (!activeTitlePath || (editingTitlePath !== activeTitlePath && !titleInputFocused)) return;
    void commitTitleEdit();
  }, [activeTitlePath, commitTitleEdit, editingTitlePath]);

  const applySavedDocumentState = useCallback((
    targetType: LibrarianSelectedItemType,
    targetPath: string | null,
    content: string,
    version: DocumentVersion | null,
    fallbackTitle: string,
  ) => {
    const nextTodoState = splitFrontmatter(content).todoState ?? undefined;
    const versionPatch = version ? { documentVersion: version } : {};
    const mtime = Date.now();

    if (targetType === 'wiki') {
      setWikiSelectedPage((prev) => (prev && prev.path === targetPath
        ? { ...prev, content, mtime, todoState: nextTodoState, ...versionPatch }
        : prev));
    } else if (targetType === 'external') {
      setExternalOpenFile((prev) => (prev && prev.path === targetPath
        ? { ...prev, content, mtime, todoState: nextTodoState, ...versionPatch }
        : prev));
    } else {
      setSelectedReading((prev) => (prev && prev.path === targetPath
        ? { ...prev, title: fallbackTitle, content, mtime, todoState: nextTodoState, ...versionPatch }
        : prev));
    }

    lastSavedContentRef.current = content;
    if (version) lastSavedVersionRef.current = version;
  }, []);

  const resolveSaveConflict = useCallback(async (
    result: DocumentSaveResult,
    targetType: LibrarianSelectedItemType,
    targetPath: string | null,
    targetContent: string,
    fallbackTitle: string,
    overwrite: (version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>,
  ): Promise<boolean> => {
    if (!isDocumentSaveConflict(result) || !result.currentVersion || result.currentContent === undefined) {
      return false;
    }

    const reload = window.confirm('This file changed on disk outside Field Theory. Press OK to reload the disk version, or Cancel to overwrite it with your current edit.');
    if (reload) {
      applySavedDocumentState(targetType, targetPath, result.currentContent, result.currentVersion, fallbackTitle);
      setEditContent(result.currentContent);
      return true;
    }

    const overwriteResult = await overwrite(result.currentVersion);
    if (!isDocumentSaveOk(overwriteResult)) return false;
    applySavedDocumentState(targetType, targetPath, targetContent, getDocumentSaveVersion(overwriteResult), fallbackTitle);
    return true;
  }, [applySavedDocumentState]);

  const refreshActiveAgentFile = useCallback(async (filePath: string) => {
    if (contentMode === 'markdown' || activeReading?.path !== filePath) return;

    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (!page || page.absPath !== filePath) return;
      const reading = readingFromWikiPage(page);
      setWikiSelectedPage(reading);
      lastSavedContentRef.current = reading.content;
      lastSavedVersionRef.current = reading.documentVersion;
      return;
    }

    if (selectedItemType === 'external') {
      const file = await window.externalAPI?.open(filePath);
      if (!file) return;
      const reading = readingFromExternalMarkdownFile(file);
      setExternalOpenFile((prev) => prev?.path === file.path ? reading : prev);
      if (activeReading.path === reading.path) {
        lastSavedContentRef.current = reading.content;
        lastSavedVersionRef.current = reading.documentVersion;
      }
    }
  }, [activeReading?.path, contentMode, selectedItemType, wikiSelectedRelPath]);

  useEffect(() => {
    const unsubscribe = window.agentKickoffAPI?.onStatus((event) => {
      void refreshActiveAgentFile(event.absPath);
    });
    return () => unsubscribe?.();
  }, [refreshActiveAgentFile]);

  useEffect(() => {
    if (!activeReading || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) return;
    updateSelectedSidebarTodoState(splitFrontmatter(activeReading.content).todoState);
  }, [activeReading, selectedItemType, updateSelectedSidebarTodoState]);

  const clearSelectedLibraryItem = useCallback(() => {
    setSelectedItemId(null);
    setSelectedItemType(null);
    setSelectedPath(null);
    setSelectedReading(null);
    setWikiSelectedRelPath(null);
    setWikiSelectedPage(null);
    setExternalOpenFile(null);
    setShareStatus(null);
    setLinkCopied(false);
    setMarkdownUrlPasteChoice(null);
    setMarkdownWikiLinkCompletion(null);
  }, []);

  const getEditorSessionTarget = useCallback((): Pick<LibrarianEditorSession, 'itemType' | 'itemPath'> | null => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      return { itemType: 'wiki', itemPath: wikiSelectedRelPath };
    }
    if (selectedItemType === 'artifact' && selectedPath) {
      return { itemType: 'artifact', itemPath: selectedPath };
    }
    if (selectedItemType === 'external' && activeReading?.path) {
      return { itemType: 'external', itemPath: activeReading.path };
    }
    return null;
  }, [activeReading?.path, selectedItemType, selectedPath, wikiSelectedRelPath]);
  const editorSessionMatchesCurrent = useCallback((session: LibrarianEditorSession | null): boolean => {
    const target = getEditorSessionTarget();
    return !!session && !!target && session.itemType === target.itemType && session.itemPath === target.itemPath;
  }, [getEditorSessionTarget]);
  const documentTextStyle = {
    fontSize: textSizes[textSize].base,
    lineHeight: resolveLibrarianLineHeight(lineHeightId, typographyPreset),
    fontFamily: typographyPreset.fontFamily,
    color: theme.isDark ? 'rgba(255,255,255,0.88)' : theme.text,
    fontWeight: 400,
    letterSpacing: 0,
  };
  const documentParagraphSpacing = resolveLibrarianParagraphSpacing(lineHeightId);
  const readerTopFadeVisible = (
    (contentMode === 'rendered' && renderedDocumentTopFade)
    || (contentMode === 'markdown' && markdownDocumentTopFade)
  );
  const topFadeActive = !!activeReading && readerTopFadeVisible;

  const markdownDisplay = useMemo(() => {
    if ((selectedItemType !== 'wiki' && selectedItemType !== 'external') || !activeReading) return null;
    return splitFrontmatter(activeReading.content);
  }, [selectedItemType, activeReading]);

  const wikiIndex = useMemo(() => buildWikiIndex([
    ...wikiIndexPages,
    ...readings.map((reading) => ({
      relPath: reading.path,
      title: reading.title,
      artifactPath: reading.path,
    })),
    ...commandIndexPages,
  ]), [commandIndexPages, readings, wikiIndexPages]);

  const markdownWikiLinkSuggestionItems = useMemo(() => {
    const seen = new Set<string>();
    const items: MarkdownWikiLinkSuggestion[] = [];
    const addItem = (title: string, detail: string, kind: MarkdownWikiLinkSuggestion['kind']) => {
      const cleanTitle = title.trim();
      if (!cleanTitle) return;
      const key = cleanTitle.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ title: cleanTitle, detail, kind });
    };

    for (const page of wikiIndexPages) {
      addItem(page.title, page.relPath, 'wiki');
    }
    for (const reading of readings) {
      addItem(reading.title, reading.path, 'artifact');
    }
    for (const command of commandIndexPages) {
      addItem(command.title, command.commandPath ?? command.relPath, 'command');
    }

    return items.sort((a, b) => a.title.localeCompare(b.title));
  }, [commandIndexPages, readings, wikiIndexPages]);

  const markdownWikiLinkSuggestions = useMemo(() => {
    if (!markdownWikiLinkCompletion) return [];
    return rankMarkdownWikiLinkSuggestions(markdownWikiLinkSuggestionItems, markdownWikiLinkCompletion.query);
  }, [markdownWikiLinkCompletion, markdownWikiLinkSuggestionItems]);

  const rawDisplaySourceBody = markdownDisplay ? markdownDisplay.body : (activeReading?.content ?? '');
  const displaySourceBody = useMemo(() => (
    removeEmptyMarkdownCommentPlaceholders(rawDisplaySourceBody)
  ), [rawDisplaySourceBody]);
  const displayContent = useMemo(() => {
    const raw = displaySourceBody;
    const linked = transformWikiLinks(raw, wikiIndex);
    return preserveMarkdownBlankLines(normalizeMarkdownCarrotLists(normalizeMarkdownTodoLines(linked)));
  }, [displaySourceBody, wikiIndex]);
  const sourceTaskLines = useMemo(
    () => getMarkdownTaskLines(activeReading?.content ?? ''),
    [activeReading?.content],
  );

  useEffect(() => {
    if (!active) {
      setMarkdownLinkRelationDocuments([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const wikiDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        wikiIndexPages.map(async (page) => {
          const fullPage = await window.wikiAPI?.getPage(page.relPath);
          return fullPage
            ? {
              target: { kind: 'wiki' as const, relPath: fullPage.relPath },
              title: fullPage.title,
              content: fullPage.content,
            }
            : null;
        }),
      );
      const artifactDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        readings.map(async (reading) => {
          const fullReading = await window.librarianAPI?.getReading(reading.path);
          return fullReading
            ? {
              target: { kind: 'artifact' as const, path: fullReading.path },
              title: fullReading.title,
              content: fullReading.content,
            }
            : null;
        }),
      );
      const commandPagesByPath = new Map<string, WikiIndexInput>();
      for (const command of commandIndexPages) {
        const commandPath = command.commandPath;
        if (commandPath && !commandPagesByPath.has(commandPath)) commandPagesByPath.set(commandPath, command);
      }
      const commandDocuments: Array<MarkdownLinkRelationDocument | null> = await Promise.all(
        Array.from(commandPagesByPath.entries()).map(async ([commandPath, command]) => {
          const fullCommand = await window.commandsAPI?.getCommandByPath(commandPath);
          return fullCommand
            ? {
              target: { kind: 'command' as const, path: fullCommand.filePath },
              title: fullCommand.displayName || command.title,
              content: fullCommand.content,
            }
            : null;
        }),
      );
      if (cancelled) return;
      setMarkdownLinkRelationDocuments(
        [...wikiDocuments, ...artifactDocuments, ...commandDocuments]
          .filter((document): document is MarkdownLinkRelationDocument => document !== null),
      );
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [active, commandIndexPages, readings, wikiIndexPages]);

  const activeLinkTarget = useMemo<WikiLinkTarget | null>(() => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) return { kind: 'wiki', relPath: wikiSelectedRelPath };
    if (selectedItemType === 'artifact' && selectedPath) return { kind: 'artifact', path: selectedPath };
    return null;
  }, [selectedItemType, selectedPath, wikiSelectedRelPath]);

  const linkedDocuments = useMemo<MarkdownLinkedDocument[]>(() => {
    if (!activeReading) return [];
    return getMarkdownLinkedDocuments(
      activeLinkTarget,
      activeReading.content,
      markdownLinkRelationDocuments,
      wikiIndex,
    );
  }, [activeLinkTarget, activeReading, markdownLinkRelationDocuments, wikiIndex]);

  useEffect(() => {
    if (!activeReading) {
      previousRenderedTaskContentRef.current = null;
      setAnimatingTaskTexts(new Set());
      return;
    }

    const previous = previousRenderedTaskContentRef.current;
    previousRenderedTaskContentRef.current = {
      path: activeReading.path,
      content: activeReading.content,
    };

    if (!previous || previous.path !== activeReading.path || contentMode === 'markdown') return;

    const newlyChecked = getNewlyCheckedMarkdownTasks(previous.content, activeReading.content);
    if (newlyChecked.length === 0) return;

    setAnimatingTaskTexts(new Set(newlyChecked));
    if (taskAnimationTimerRef.current) {
      window.clearTimeout(taskAnimationTimerRef.current);
    }
    taskAnimationTimerRef.current = window.setTimeout(() => {
      taskAnimationTimerRef.current = null;
      setAnimatingTaskTexts(new Set());
    }, 1500);
  }, [activeReading?.path, activeReading?.content, contentMode]);

  useEffect(() => () => {
    if (taskAnimationTimerRef.current) {
      window.clearTimeout(taskAnimationTimerRef.current);
      taskAnimationTimerRef.current = null;
    }
  }, []);

  const saveRenderedContent = useCallback(async (nextContent: string) => {
    if (!activeReading) return;
    const normalizedContent = removeEmptyMarkdownCommentPlaceholders(nextContent);
    const expectedVersion = lastSavedVersionRef.current ?? activeReading.documentVersion;
    const targetType = selectedItemType;
    const targetPath = activeReading.path;
    const targetTitle = activeReading.title;
    setSaveStatus('saving');
    try {
      let result: DocumentSaveResult | null | undefined;
      let overwrite: (version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>;
      if (targetType === 'wiki' && wikiSelectedRelPath) {
        result = await window.wikiAPI?.save(wikiSelectedRelPath, normalizedContent, expectedVersion);
        overwrite = (version) => window.wikiAPI?.save(wikiSelectedRelPath, normalizedContent, version) ?? Promise.resolve(undefined);
      } else if (targetType === 'external' && activeReading.path) {
        result = await window.externalAPI?.save(activeReading.path, normalizedContent, expectedVersion);
        overwrite = (version) => window.externalAPI?.save(activeReading.path, normalizedContent, version) ?? Promise.resolve(undefined);
      } else if (activeReading.path) {
        result = await window.librarianAPI?.saveReading(activeReading.path, normalizedContent, expectedVersion);
        overwrite = (version) => window.librarianAPI?.saveReading(activeReading.path, normalizedContent, version) ?? Promise.resolve(undefined);
      } else {
        return;
      }

      if (isDocumentSaveConflict(result)) {
        const resolved = await resolveSaveConflict(result, targetType, targetPath, normalizedContent, targetTitle, overwrite);
        setSaveStatus(resolved ? 'saved' : 'idle');
        return;
      }
      if (!isDocumentSaveOk(result)) throw new Error('save failed');
      applySavedDocumentState(targetType, targetPath, normalizedContent, getDocumentSaveVersion(result), targetTitle);
      setEditContent(normalizedContent);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('idle');
    }
  }, [activeReading, applySavedDocumentState, resolveSaveConflict, selectedItemType, wikiSelectedRelPath]);

  const applyRenderedContentLocalState = useCallback((nextContent: string) => {
    const normalizedContent = removeEmptyMarkdownCommentPlaceholders(nextContent);
    if (selectedItemType === 'wiki') {
      setWikiSelectedPage((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    } else if (selectedItemType === 'external') {
      setExternalOpenFile((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    } else {
      setSelectedReading((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    }
    setEditContent(normalizedContent);
  }, [selectedItemType]);

  const flushPendingRenderedSave = useCallback(() => {
    if (renderedSaveTimerRef.current !== null) {
      window.clearTimeout(renderedSaveTimerRef.current);
      renderedSaveTimerRef.current = null;
    }
    const pending = pendingRenderedSaveRef.current;
    pendingRenderedSaveRef.current = null;
    pending?.();
  }, []);

  const requestRenderedContentSave = useCallback((nextContent: string) => {
    if (renderedSaveTimerRef.current !== null) {
      window.clearTimeout(renderedSaveTimerRef.current);
    }
    pendingRenderedSaveRef.current = () => {
      void saveRenderedContent(nextContent);
    };
    renderedSaveTimerRef.current = window.setTimeout(() => {
      renderedSaveTimerRef.current = null;
      const pending = pendingRenderedSaveRef.current;
      pendingRenderedSaveRef.current = null;
      pending?.();
    }, 400);
  }, [saveRenderedContent]);

  const applyRenderedMarkdownEdit = useCallback((edit: MarkdownTextEdit) => {
    applyRenderedContentLocalState(edit.nextValue);
    setRenderedSelectionToolbar(null);
    (renderedContentRef.current?.ownerDocument.getSelection() ?? window.getSelection())?.removeAllRanges();
    requestRenderedContentSave(edit.nextValue);
  }, [applyRenderedContentLocalState, requestRenderedContentSave]);

  const updateRenderedSelectionToolbar = useCallback(() => {
    if (!RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED) {
      setRenderedSelectionToolbar(null);
      return;
    }
    if (contentMode !== 'rendered' || !activeReading) {
      setRenderedSelectionToolbar(null);
      return;
    }
    const root = renderedContentRef.current;
    const selection = root?.ownerDocument.getSelection() ?? null;
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setRenderedSelectionToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setRenderedSelectionToolbar(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const toolbar = getRenderedMarkdownSelectionToolbarState(activeReading.content, selection.toString(), rect);
    if (!toolbar) {
      setRenderedSelectionToolbar(null);
      return;
    }

    setRenderedSelectionToolbar(toolbar);
  }, [activeReading, contentMode]);

  const applyRenderedSelectionFormat = useCallback((action: RenderedMarkdownFormatAction) => {
    if (!activeReading || !renderedSelectionToolbar) return;
    const edit = getRenderedMarkdownSelectionFormatEdit(
      activeReading.content,
      renderedSelectionToolbar.start,
      renderedSelectionToolbar.end,
      action,
    );
    if (!edit) return;
    applyRenderedMarkdownEdit(edit);
  }, [activeReading, applyRenderedMarkdownEdit, renderedSelectionToolbar]);

  useEffect(() => {
    if (!RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED) return;
    if (contentMode !== 'rendered') return;
    const selectionDocument = renderedContentRef.current?.ownerDocument ?? document;
    let frame: number | null = null;
    const updateAfterSelectionChange = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        updateRenderedSelectionToolbar();
      });
    };
    selectionDocument.addEventListener('selectionchange', updateAfterSelectionChange);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      selectionDocument.removeEventListener('selectionchange', updateAfterSelectionChange);
    };
  }, [contentMode, updateRenderedSelectionToolbar]);

  useEffect(() => {
    setRenderedSelectionToolbar(null);
  }, [activeReading?.path, contentMode]);

  useEffect(() => {
    return () => {
      flushPendingRenderedSave();
    };
  }, [activeReading?.path, contentMode, flushPendingRenderedSave]);

  const toggleRenderedTask = useCallback((lineIndex: number, checked: boolean) => {
    if (!activeReading) return;
    const nextContent = toggleMarkdownTaskLineAtIndex(activeReading.content, lineIndex, checked);
    if (nextContent === activeReading.content) return;
    void saveRenderedContent(nextContent);
  }, [activeReading, saveRenderedContent]);

  const cycleSelectedMarkdownTodoState = useCallback(async (direction: 'forward' | 'backward' = 'forward'): Promise<boolean> => {
    if (!activeReading || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) return false;
    if (selectedItemType === 'wiki' && !wikiSelectedRelPath) return false;

    const sourceContent = contentMode === 'markdown' ? editContent : activeReading.content;
    const next = cycleMarkdownTodoState(sourceContent, direction);
    if (next.content === sourceContent) return false;

    const previousState = splitFrontmatter(sourceContent).todoState;
    const applyLocalState = (content: string, state: MarkdownTodoState | null) => {
      updateSelectedSidebarTodoState(state);
      if (selectedItemType === 'wiki') {
        setWikiSelectedPage((prev) => (prev ? { ...prev, content, todoState: state ?? undefined } : prev));
      } else {
        setExternalOpenFile((prev) => (prev ? { ...prev, content, todoState: state ?? undefined } : prev));
      }
      setEditContent(content);
    };
    const applyRebasedConflict = async (
      conflict: Extract<DocumentSaveResult, { ok: false; reason: 'conflict' }>,
      save: (content: string, version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>,
    ): Promise<boolean> => {
      if (!conflict.currentVersion || conflict.currentContent === undefined) return false;
      const rebased = rebaseMarkdownTodoStateChange(sourceContent, next.content, conflict.currentContent);
      if (!rebased) return false;
      const saved = await save(rebased.content, conflict.currentVersion);
      if (!isDocumentSaveOk(saved)) return false;
      applySavedDocumentState(selectedItemType, activeReading.path, rebased.content, getDocumentSaveVersion(saved), activeReading.title);
      updateSelectedSidebarTodoState(rebased.state);
      setEditContent(rebased.content);
      setSaveStatus('saved');
      return true;
    };

    applyLocalState(next.content, next.state);
    setSaveStatus('saving');
    try {
      const expectedVersion = lastSavedVersionRef.current ?? activeReading.documentVersion;
      if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
        const saved = await window.wikiAPI?.save(wikiSelectedRelPath, next.content, expectedVersion);
        if (isDocumentSaveConflict(saved)) {
          if (await applyRebasedConflict(
            saved,
            (content, version) => window.wikiAPI?.save(wikiSelectedRelPath, content, version) ?? Promise.resolve(undefined),
          )) {
            return true;
          }
          const resolved = await resolveSaveConflict(
            saved,
            selectedItemType,
            activeReading.path,
            next.content,
            activeReading.title,
            (version) => window.wikiAPI?.save(wikiSelectedRelPath, next.content, version) ?? Promise.resolve(undefined),
          );
          if (resolved) return true;
        }
        if (!isDocumentSaveOk(saved)) {
          applyLocalState(sourceContent, previousState);
          setSaveStatus('idle');
          return false;
        }
        applySavedDocumentState(selectedItemType, activeReading.path, next.content, getDocumentSaveVersion(saved), activeReading.title);
      } else if (selectedItemType === 'external') {
        const saved = await window.externalAPI?.save(activeReading.path, next.content, expectedVersion);
        if (isDocumentSaveConflict(saved)) {
          if (await applyRebasedConflict(
            saved,
            (content, version) => window.externalAPI?.save(activeReading.path, content, version) ?? Promise.resolve(undefined),
          )) {
            return true;
          }
          const resolved = await resolveSaveConflict(
            saved,
            selectedItemType,
            activeReading.path,
            next.content,
            activeReading.title,
            (version) => window.externalAPI?.save(activeReading.path, next.content, version) ?? Promise.resolve(undefined),
          );
          if (resolved) return true;
        }
        if (!isDocumentSaveOk(saved)) {
          applyLocalState(sourceContent, previousState);
          setSaveStatus('idle');
          return false;
        }
        applySavedDocumentState(selectedItemType, activeReading.path, next.content, getDocumentSaveVersion(saved), activeReading.title);
      }

      setSaveStatus('saved');
      return true;
    } catch {
      applyLocalState(sourceContent, previousState);
      setSaveStatus('idle');
      return false;
    }
  }, [activeReading, applySavedDocumentState, contentMode, editContent, resolveSaveConflict, selectedItemType, updateSelectedSidebarTodoState, wikiSelectedRelPath]);

  const runFileFind = useCallback((query: string, fromSelection = true) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (contentMode === 'markdown') {
      const editor = markdownCodeEditorRef.current;
      if (!editor) return;
      const value = editor.getValue();
      const selection = editor.getSelectionRange();
      const fromIndex = fromSelection ? selection.end : 0;
      const match = findNextMarkdownMatch(value, trimmed, fromIndex);
      if (!match) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(match.start, match.end);
      return;
    }

    const find = (window as unknown as { find?: (query: string) => boolean }).find;
    find?.(trimmed);
  }, [contentMode]);

  const openFileFind = useCallback(() => {
    setFileFindOpen(true);
    requestAnimationFrame(() => {
      fileFindInputRef.current?.focus();
      fileFindInputRef.current?.select();
    });
  }, []);

  useEffect(() => {
    const root = renderedContentRef.current;
    if (!root || contentMode === 'markdown') return;
    if (!fileFindOpen) {
      clearFileFindMarks(root);
      return;
    }
    highlightFileFindMatches(root, fileFindQuery);
    return () => clearFileFindMarks(root);
  }, [contentMode, displayContent, fileFindOpen, fileFindQuery]);

  const captureContentScrollRatio = useCallback(() => {
    const scrollEl = contentMode === 'markdown' ? markdownCodeEditorRef.current : contentScrollRef.current;
    if (!scrollEl) return;
    pendingScrollRatioRef.current = getScrollRatio(
      scrollEl.scrollTop,
      scrollEl.scrollHeight,
      scrollEl.clientHeight,
    );
  }, [contentMode]);

  const captureEditorSession = useCallback((): LibrarianEditorSession | null => {
    const target = getEditorSessionTarget();
    if (!target) return null;

    const editor = markdownCodeEditorRef.current;
    const scrollEl = contentMode === 'markdown' ? editor : contentScrollRef.current;
    const selection = editor?.getSelectionRange();
    return {
      ...target,
      contentMode,
      selectionStart: selection?.start ?? 0,
      selectionEnd: selection?.end ?? selection?.start ?? 0,
      scrollTop: scrollEl?.scrollTop ?? 0,
    };
  }, [contentMode, getEditorSessionTarget]);

  const persistEditorSession = useCallback(() => {
    const session = captureEditorSession();
    if (!session) return;
    persistLibrarianEditorSession(localStorage, session);
  }, [captureEditorSession]);

  const scheduleEditorSessionPersist = useCallback(() => {
    if (editorSessionPersistTimerRef.current !== null) {
      window.clearTimeout(editorSessionPersistTimerRef.current);
    }
    editorSessionPersistTimerRef.current = window.setTimeout(() => {
      editorSessionPersistTimerRef.current = null;
      persistEditorSession();
    }, 160);
  }, [persistEditorSession]);

  const flushEditorSessionPersist = useCallback(() => {
    if (editorSessionPersistTimerRef.current !== null) {
      window.clearTimeout(editorSessionPersistTimerRef.current);
      editorSessionPersistTimerRef.current = null;
    }
    persistEditorSession();
  }, [persistEditorSession]);

  const applyMarkdownCodeEditorTextEdit = useCallback((
    edit: MarkdownTextEdit,
    options: { preserveCompletion?: boolean } = {},
  ) => {
    const editor = markdownCodeEditorRef.current;
    const currentValue = editor?.getValue() ?? editContent;
    const selection = editor?.getSelectionRange() ?? { start: 0, end: 0 };
    markdownEditUndoStackRef.current.push({
      value: currentValue,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    });
    markWritingActive();
    setEditContent(edit.nextValue);
    setMarkdownUrlPasteChoice(null);
    if (!options.preserveCompletion) setMarkdownWikiLinkCompletion(null);
    scheduleEditorSessionPersist();
    requestAnimationFrame(() => {
      const nextEditor = markdownCodeEditorRef.current;
      if (!nextEditor || nextEditor.getValue() !== edit.nextValue) return;
      nextEditor.focus({ preventScroll: true });
      nextEditor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }, [editContent, markWritingActive, scheduleEditorSessionPersist]);

  const updateMarkdownCodeEditorWikiLinkCompletion = useCallback((
    snapshot: MarkdownCodeEditorSelectionSnapshot,
  ) => {
    scheduleEditorSessionPersist();
    if (
      markdownUrlPasteChoice &&
      (snapshot.selectionStart < markdownUrlPasteChoice.insertedStart ||
        snapshot.selectionEnd > markdownUrlPasteChoice.insertedEnd)
    ) {
      setMarkdownUrlPasteChoice(null);
    }

    const autoCloseEdit = snapshot.docChanged && snapshot.inputType === 'insertText' && snapshot.inputData === '['
      ? getMarkdownWikiLinkAutoCloseEdit(snapshot.value, snapshot.selectionStart, snapshot.selectionEnd)
      : null;
    if (autoCloseEdit) {
      applyMarkdownCodeEditorTextEdit(autoCloseEdit, { preserveCompletion: true });
      setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
        autoCloseEdit.nextValue,
        autoCloseEdit.selectionStart,
        autoCloseEdit.selectionEnd,
        snapshot.caretPosition,
      ));
      return;
    }

    setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
      snapshot.value,
      snapshot.selectionStart,
      snapshot.selectionEnd,
      snapshot.caretPosition,
    ));
  }, [applyMarkdownCodeEditorTextEdit, markdownUrlPasteChoice, scheduleEditorSessionPersist]);

  const applyMarkdownWikiLinkSuggestion = useCallback((
    suggestion: MarkdownWikiLinkSuggestion,
    completionFallback: MarkdownWikiLinkCompletion | null,
  ) => {
    const editor = markdownCodeEditorRef.current;
    const currentValue = editor?.getValue() ?? editContent;
    const selection = editor?.getSelectionRange();
    const liveCompletion = selection
      ? getActiveMarkdownWikiLinkCompletion(currentValue, selection.start, selection.end)
      : null;
    const completion = liveCompletion ?? completionFallback;
    if (!completion) return;
    const edit = getMarkdownWikiLinkCompletionReplacement(currentValue, completion, suggestion.title);
    if (!edit) return;

    markWritingActive();
    setEditContent(edit.nextValue);
    setMarkdownWikiLinkCompletion(null);
    setMarkdownUrlPasteChoice(null);
    scheduleEditorSessionPersist();

    requestAnimationFrame(() => {
      const nextCodeEditor = markdownCodeEditorRef.current;
      if (!nextCodeEditor || nextCodeEditor.getValue() !== edit.nextValue) return;
      nextCodeEditor.focus({ preventScroll: true });
      nextCodeEditor.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }, [editContent, markWritingActive, scheduleEditorSessionPersist]);

  const applyMarkdownTextInsertion = useCallback((text: string) => {
    if (!text) return;
    markWritingActive();
    setMarkdownUrlPasteChoice(null);
    setMarkdownWikiLinkCompletion(null);

    const editor = markdownCodeEditorRef.current;
    const currentValue = editor?.getValue() ?? editContent;
    const selection = editor?.getSelectionRange();
    const selectionStart = selection?.start ?? currentValue.length;
    const selectionEnd = selection?.end ?? selectionStart;
    const insertedText = formatPastedLocalImageMarkdown(text) ?? text;
    const nextValue = `${currentValue.slice(0, selectionStart)}${insertedText}${currentValue.slice(selectionEnd)}`;
    const nextSelection = selectionStart + insertedText.length;

    setEditContent(nextValue);
    scheduleEditorSessionPersist();

    requestAnimationFrame(() => {
      const nextEditor = markdownCodeEditorRef.current;
      if (!nextEditor || nextEditor.getValue() !== nextValue) return;
      nextEditor.focus({ preventScroll: true });
      nextEditor.setSelectionRange(nextSelection, nextSelection);
    });
  }, [editContent, markWritingActive, scheduleEditorSessionPersist]);

  const insertMarkdownText = useCallback((text: string) => {
    if (contentMode !== 'markdown') {
      setContentMode('markdown');
      requestAnimationFrame(() => applyMarkdownTextInsertion(text));
      return;
    }
    applyMarkdownTextInsertion(text);
  }, [applyMarkdownTextInsertion, contentMode]);

  const insertCurrentClipboardImagePath = useCallback(async () => {
    const imagePath = await window.clipboardAPI?.getClipboardImagePath?.();
    if (imagePath) insertMarkdownText(formatLocalImageMarkdown(imagePath));
  }, [insertMarkdownText]);

  const applyMarkdownUrlPasteEdit = useCallback((pasteEdit: MarkdownUrlPasteEdit) => {
    markWritingActive();
    setEditContent(pasteEdit.nextValue);
    setMarkdownUrlPasteChoice(pasteEdit);
    setMarkdownWikiLinkCompletion(null);
    scheduleEditorSessionPersist();

    requestAnimationFrame(() => {
      const editor = markdownCodeEditorRef.current;
      if (!editor || editor.getValue() !== pasteEdit.nextValue) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(pasteEdit.selectionStart, pasteEdit.selectionEnd);
    });
  }, [markWritingActive, scheduleEditorSessionPersist]);

  const handleMarkdownCodeEditorPaste = useCallback((event: ClipboardEvent): boolean => {
    const clipboardData = event.clipboardData;
    const pastedText = clipboardData?.getData('text/plain') ?? '';
    if (clipboardData && shouldInsertClipboardImagePathForPaste({ pastedText, hasImage: clipboardDataHasImage(clipboardData) })) {
      void insertCurrentClipboardImagePath();
      return true;
    }
    if (!pastedText) return false;

    const localImageMarkdown = formatPastedLocalImageMarkdown(pastedText);
    if (localImageMarkdown) {
      insertMarkdownText(localImageMarkdown);
      return true;
    }

    const editor = markdownCodeEditorRef.current;
    if (!editor) return false;
    const selection = editor.getSelectionRange();
    const pasteEdit = getMarkdownUrlPasteEdit(
      editor.getValue(),
      selection.start,
      selection.end,
      pastedText,
    );
    if (!pasteEdit) {
      setMarkdownUrlPasteChoice(null);
      return false;
    }

    applyMarkdownUrlPasteEdit(pasteEdit);
    return true;
  }, [applyMarkdownUrlPasteEdit, insertCurrentClipboardImagePath, insertMarkdownText]);

  const applyMarkdownUrlPasteKind = useCallback((kind: MarkdownUrlPasteKind) => {
    if (!markdownUrlPasteChoice) return;
    const pasteEdit = getMarkdownUrlPasteReplacement(editContent, markdownUrlPasteChoice, kind);
    applyMarkdownUrlPasteEdit(pasteEdit);
  }, [applyMarkdownUrlPasteEdit, editContent, markdownUrlPasteChoice]);

  const restoreMarkdownCodeEditorProgrammaticUndo = useCallback((): boolean => {
    const snapshot = markdownEditUndoStackRef.current.pop();
    if (!snapshot) return false;
    markWritingActive();
    setEditContent(snapshot.value);
    setMarkdownUrlPasteChoice(null);
    setMarkdownWikiLinkCompletion(null);
    scheduleEditorSessionPersist();
    requestAnimationFrame(() => {
      const editor = markdownCodeEditorRef.current;
      if (!editor || editor.getValue() !== snapshot.value) return;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    });
    return true;
  }, [markWritingActive, scheduleEditorSessionPersist]);

  const handleMarkdownCodeEditorKeyDown = useCallback((event: KeyboardEvent): boolean => {
    const editor = markdownCodeEditorRef.current;
    const value = editor?.getValue() ?? editContent;
    const selection = editor?.getSelectionRange() ?? { start: 0, end: 0 };

    if (isImmersiveToggleShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleFocusChromeShortcut();
      return true;
    }

    if (event.key.toLowerCase() === 'z' && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
      if (restoreMarkdownCodeEditorProgrammaticUndo()) {
        event.preventDefault();
        return true;
      }
    }

    if (isMarkdownTaskToggleShortcut(event)) {
      const edit = getMarkdownTaskToggleEdit(value, selection.start, selection.end);
      if (!edit) return false;
      event.preventDefault();
      applyMarkdownCodeEditorTextEdit(edit);
      return true;
    }

    if (event.key.toLowerCase() === 'a' && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
      const range = getMarkdownBodySelectionRange(value);
      if (range && (selection.start !== range.start || selection.end !== range.end)) {
        event.preventDefault();
        editor?.setSelectionRange(range.start, range.end);
        scheduleEditorSessionPersist();
        return true;
      }
    }

    if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey) {
      if (isMarkdownTaskShortcut(event)) {
        const edit = getMarkdownTaskShortcutEdit(value, selection.start, selection.end);
        if (!edit) return false;
        event.preventDefault();
        applyMarkdownCodeEditorTextEdit(edit);
        return true;
      }

      if (event.code === 'Digit7' || event.code === 'Digit8') {
        const edit = getMarkdownListToggleEdit(
          value,
          selection.start,
          selection.end,
          event.code === 'Digit7' ? 'ordered' : 'unordered',
          unorderedListMarker,
        );
        if (!edit) return false;
        event.preventDefault();
        applyMarkdownCodeEditorTextEdit(edit);
        return true;
      }
    }

    const completion = markdownWikiLinkCompletion;
    if (completion) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMarkdownWikiLinkCompletion(null);
        return true;
      }

      if (markdownWikiLinkSuggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setMarkdownWikiLinkSuggestionIndex((index) => (
            (index + 1) % markdownWikiLinkSuggestions.length
          ));
          return true;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setMarkdownWikiLinkSuggestionIndex((index) => (
            (index - 1 + markdownWikiLinkSuggestions.length) % markdownWikiLinkSuggestions.length
          ));
          return true;
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          const suggestion = markdownWikiLinkSuggestions[
            Math.min(markdownWikiLinkSuggestionIndex, markdownWikiLinkSuggestions.length - 1)
          ];
          applyMarkdownWikiLinkSuggestion(suggestion, completion);
          return true;
        }
      }
    }

    if (event.key === 'Enter') {
      const carrotEdit = getCarrotListEnterEdit(value, selection.start, selection.end);
      if (carrotEdit) {
        event.preventDefault();
        setUnorderedListMarker('carrot');
        applyMarkdownCodeEditorTextEdit(carrotEdit);
        return true;
      }

      const listEdit = getMarkdownListEnterEdit(value, selection.start, selection.end);
      if (listEdit) {
        event.preventDefault();
        applyMarkdownCodeEditorTextEdit(listEdit);
        return true;
      }
    }

    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const edit = getCarrotListTabEdit(value, selection.start, selection.end, event.shiftKey ? 'out' : 'in');
      if (edit) {
        event.preventDefault();
        setUnorderedListMarker('carrot');
        applyMarkdownCodeEditorTextEdit(edit);
        return true;
      }
    }

    return false;
  }, [
    applyMarkdownCodeEditorTextEdit,
    applyMarkdownWikiLinkSuggestion,
    editContent,
    markdownWikiLinkCompletion,
    markdownWikiLinkSuggestionIndex,
    markdownWikiLinkSuggestions,
    restoreMarkdownCodeEditorProgrammaticUndo,
    scheduleEditorSessionPersist,
    toggleFocusChromeShortcut,
    unorderedListMarker,
  ]);

  const handleMarkdownCodeEditorMouseDown = useCallback((event: MouseEvent, offset: number): boolean => {
    if (!event.metaKey || event.altKey || event.ctrlKey) return false;
    const action = getMarkdownEditorLinkActionAtOffset(editContent, offset, wikiIndex);
    if (action.kind === 'noop') return false;
    event.preventDefault();
    event.stopPropagation();
    openLinkAction(action);
    return true;
  }, [editContent, openLinkAction, wikiIndex]);

  const restoreEditorSession = useCallback((session: LibrarianEditorSession | null) => {
    if (!session || contentMode !== 'markdown' || !editorSessionMatchesCurrent(session)) return;

    const frame = requestAnimationFrame(() => {
      const editor = markdownCodeEditorRef.current;
      if (!editor) return;

      const length = editor.getValue().length;
      const selectionStart = Math.min(session.selectionStart, length);
      const selectionEnd = Math.min(session.selectionEnd, length);
      editor.setSelectionRange(selectionStart, selectionEnd);
      editor.scrollTop = session.scrollTop;
    });

    return () => cancelAnimationFrame(frame);
  }, [contentMode, editorSessionMatchesCurrent]);

  useEffect(() => {
    const ratio = pendingScrollRatioRef.current;
    if (ratio === null) return;
    pendingScrollRatioRef.current = null;

    const frame = requestAnimationFrame(() => {
      const scrollEl = contentMode === 'markdown' ? markdownCodeEditorRef.current : contentScrollRef.current;
      if (!scrollEl) return;
      scrollEl.scrollTop = getScrollTopForRatio(
        scrollEl.scrollHeight,
        scrollEl.clientHeight,
        ratio,
      );
      if (contentMode === 'markdown') {
        updateMarkdownEditorFades(scrollEl);
      } else {
        updateRenderedDocumentTopFade(scrollEl);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [contentMode, activeReading?.path, updateMarkdownEditorFades, updateRenderedDocumentTopFade]);

  useEffect(() => {
    if (contentMode !== 'markdown') updateMarkdownEditorFades(null);
  }, [contentMode, updateMarkdownEditorFades]);

  useEffect(() => {
    if (contentMode === 'markdown') {
      updateRenderedDocumentTopFade(null);
      return;
    }
    const frame = requestAnimationFrame(() => updateRenderedDocumentTopFade(contentScrollRef.current));
    return () => cancelAnimationFrame(frame);
  }, [contentMode, displayContent, lineHeightId, textSize, typographyPresetId, updateRenderedDocumentTopFade]);

  useEffect(() => {
    if (contentMode !== 'markdown') return;
    const frame = requestAnimationFrame(() => updateMarkdownEditorFades(markdownCodeEditorRef.current));
    return () => cancelAnimationFrame(frame);
  }, [activeReading?.path, contentMode, editContent, lineHeightId, textSize, typographyPresetId, updateMarkdownEditorFades]);

  useEffect(() => {
    if (!markdownUrlPasteChoice) return;
    const timer = window.setTimeout(() => setMarkdownUrlPasteChoice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [markdownUrlPasteChoice]);

  useEffect(() => {
    setMarkdownWikiLinkSuggestionIndex(0);
  }, [markdownWikiLinkCompletion?.query, markdownWikiLinkCompletion?.queryStart]);

  useEffect(() => {
    if (markdownWikiLinkSuggestionIndex < markdownWikiLinkSuggestions.length) return;
    setMarkdownWikiLinkSuggestionIndex(0);
  }, [markdownWikiLinkSuggestionIndex, markdownWikiLinkSuggestions.length]);

  useEffect(() => {
    setMarkdownUrlPasteChoice(null);
    setMarkdownWikiLinkCompletion(null);
  }, [activeReading?.path, contentMode]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.librarianAPI?.onInsertMarkdownText(insertMarkdownText);
    return () => unsubscribe?.();
  }, [active, insertMarkdownText]);

  useEffect(() => {
    return () => window.librarianAPI?.setMarkdownEditorFocused(false);
  }, []);

  const enterEditMode = useCallback((selectionStart?: number | null) => {
    captureContentScrollRatio();
    focusMarkdownEditorOnOpenRef.current = true;
    pendingRenderedEditSelectionRef.current = typeof selectionStart === 'number' ? selectionStart : null;
    setContentMode('markdown');
  }, [captureContentScrollRatio]);

  useEffect(() => {
    if (contentMode !== 'markdown' || !focusMarkdownEditorOnOpenRef.current) return;
    const frame = requestAnimationFrame(() => {
      focusMarkdownEditorOnOpenRef.current = false;
      const selectionStart = pendingRenderedEditSelectionRef.current;
      const selectionEnd = selectionStart;
      pendingRenderedEditSelectionRef.current = null;

      const editor = markdownCodeEditorRef.current;
      if (!editor) {
        focusMarkdownEditorOnOpenRef.current = true;
        return;
      }
      editor.focus({ preventScroll: true });
      if (typeof selectionStart === 'number') {
        const value = editor.getValue();
        const offset = Math.max(0, Math.min(selectionStart, value.length));
        const endOffset = Math.max(offset, Math.min(selectionEnd ?? offset, value.length));
        editor.setSelectionRange(offset, endOffset);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeReading?.path, contentMode]);

  const exitEditMode = useCallback(async () => {
    captureContentScrollRatio();
    await flushCurrentEdit();
    setContentMode('rendered');
  }, [captureContentScrollRatio, flushCurrentEdit]);

  // Debounced auto-save. Fires ~400ms after the last keystroke and doesn't
  // round-trip the saved content back into React state, so the textarea's
  // native undo stack stays intact for Cmd+Z within the session.
  useEffect(() => {
    // Nothing pending unless/until a matching save is scheduled below.
    flushSaveRef.current = null;
    if (contentMode !== 'markdown' || !activeReading) return;
    // Compare against what's actually on disk, not activeReading.content —
    // the latter is frozen at load time. Otherwise "type a char, delete it"
    // would leave the typed char persisted.
    if (editContent === lastSavedContentRef.current) return;
    // Capture target ids so a mid-debounce file switch still writes pending
    // content to the correct path.
    const targetType = selectedItemType;
    const targetWikiPath = wikiSelectedRelPath;
    const targetReadingPath = activeReading.path;
    const targetTitle = activeReading.title;
    const targetVersion = lastSavedVersionRef.current ?? activeReading.documentVersion;
    const targetContent = removeEmptyMarkdownCommentPlaceholders(editContent);
    let done = false;
    const doSave = async () => {
      if (done) return;
      done = true;
      setSaveStatus('saving');
      try {
        let result: DocumentSaveResult | null | undefined;
        let overwrite: (version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>;
        if (targetType === 'wiki' && targetWikiPath) {
          result = await window.wikiAPI?.save(targetWikiPath, targetContent, targetVersion);
          overwrite = (version) => window.wikiAPI?.save(targetWikiPath, targetContent, version) ?? Promise.resolve(undefined);
        } else if (targetType === 'external' && targetReadingPath) {
          result = await window.externalAPI?.save(targetReadingPath, targetContent, targetVersion);
          overwrite = (version) => window.externalAPI?.save(targetReadingPath, targetContent, version) ?? Promise.resolve(undefined);
        } else if (targetReadingPath) {
          result = await window.librarianAPI?.saveReading(targetReadingPath, targetContent, targetVersion);
          overwrite = (version) => window.librarianAPI?.saveReading(targetReadingPath, targetContent, version) ?? Promise.resolve(undefined);
        } else {
          return;
        }

        if (isDocumentSaveConflict(result)) {
          const resolved = await resolveSaveConflict(result, targetType, targetReadingPath, targetContent, targetTitle, overwrite);
          setSaveStatus(resolved ? 'saved' : 'idle');
          return;
        }
        if (!isDocumentSaveOk(result)) throw new Error('save failed');
        applySavedDocumentState(targetType, targetReadingPath, targetContent, getDocumentSaveVersion(result), targetTitle);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      } finally {
        // Only clear the ref if it still points at this save — a newer
        // effect run may have replaced it while we were awaiting disk.
        if (flushSaveRef.current === doSave) flushSaveRef.current = null;
      }
    };
    flushSaveRef.current = doSave;
    const timer = setTimeout(() => { void doSave(); }, 400);
    return () => clearTimeout(timer);
  }, [activeReading, applySavedDocumentState, contentMode, editContent, resolveSaveConflict, selectedItemType, wikiSelectedRelPath]);

  // Keep the internal save state from staying in "saved" after auto-save settles.
  // 2.5s is long enough to notice when clicking away to another file without
  // being obtrusive.
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const t = setTimeout(() => setSaveStatus('idle'), 2500);
    return () => clearTimeout(t);
  }, [saveStatus]);

  // Explicit names still come from the sidebar's inline input; built-in folders
  // can also create pages with a default filename title selected for editing.
  const handleCreateFile = useCallback(async (location: LibraryCreateLocation, fileName: string) => {
    if (!fileName.trim()) return false;
    if (!location.builtin) {
      const page = await window.libraryAPI?.createFile(location.rootPath, location.relPath, fileName.trim());
      if (page?.absPath) {
        await selectExternalFile(page.absPath);
        setContentMode('markdown');
        return page;
      }
      return false;
    }

    const page = await window.wikiAPI?.createFile(location.relPath, fileName.trim());
    if (page) {
      dispatchLocalWikiAdded(page);
      openWikiPage(page.relPath);
      setContentMode('markdown');
      return page;
    }
    return false;
  }, [openWikiPage, selectExternalFile]);

  const openPageForTitleEdit = useCallback((page: WikiPage) => {
    pendingTitleEditPathRef.current = page.absPath;
    openWikiPage(page.relPath);
    setWikiSelectedPage(readingFromWikiPage(page));
    setEditContent(page.content);
    lastSavedContentRef.current = page.content;
    lastSavedVersionRef.current = page.documentVersion;
    setContentMode('markdown');
  }, [openWikiPage]);

  useEffect(() => {
    if (!initialOpenTarget) return;
    if (initialOpenTarget.kind === 'wiki') {
      void (async () => {
        setSearchQuery('');
        openWikiPage(initialOpenTarget.path);
        if (initialOpenTarget.contentMode === 'markdown') {
          setContentMode('markdown');
          const page = await window.wikiAPI?.getPage(initialOpenTarget.path);
          if (page) {
            dispatchLocalWikiAdded(page);
            setWikiSelectedPage(readingFromWikiPage(page));
            setEditContent(page.content);
            lastSavedContentRef.current = page.content;
            lastSavedVersionRef.current = page.documentVersion;
            pendingTitleEditPathRef.current = page.absPath;
          }
        }
        onInitialOpenTargetConsumed?.();
      })();
    } else if (initialOpenTarget.kind === 'artifact') {
      selectArtifactPath(initialOpenTarget.path);
      onInitialOpenTargetConsumed?.();
    } else if (initialOpenTarget.kind === 'external') {
      void selectExternalFile(initialOpenTarget.path).finally(() => {
        onInitialOpenTargetConsumed?.();
      });
    }
  }, [initialOpenTarget, onInitialOpenTargetConsumed, openWikiPage, selectArtifactPath, selectExternalFile]);

  const handleCreateDefaultFile = useCallback(async (location: LibraryCreateLocation) => {
    if (!location.builtin) return false;
    const page = await window.wikiAPI?.createFileWithDefaultTitle(location.relPath);
    if (!page) return false;
    dispatchLocalWikiAdded(page);
    openPageForTitleEdit(page);
    return true;
  }, [openPageForTitleEdit]);

  const handleCreateDir = useCallback(async (location: LibraryCreateLocation) => {
    if (!location.relPath.trim()) return false;
    if (!location.builtin) {
      return await window.libraryAPI?.createDir(location.rootPath, location.relPath) ?? false;
    }
    return await window.wikiAPI?.createDir(location.relPath) ?? false;
  }, []);

  // True while the currently-selected item is the artifact the librarian
  // just auto-popped. Escape should close the window in that case.
  const isOnAutoPopArtifact =
    !!autoPopArtifactPath &&
    selectedItemType === 'artifact' &&
    selectedPath === autoPopArtifactPath;

  const handleSelectItem = useCallback(async (item: UnifiedItem) => {
    // Flush any pending auto-save against the current file before we
    // redirect editContent to the new one.
    await flushCurrentEdit();
    if (item.taggedDocId && item.hasUnread) {
      void window.taggedDocsAPI?.markRead(item.taggedDocId);
    }
    if (item.type === 'wiki' && item.relPath) {
      openWikiPage(item.relPath);
      setContentMode('rendered');
    } else if (item.type === 'artifact') {
      selectArtifactPath(item.absPath);
      setContentMode('rendered');
    } else if (item.type === 'external') {
      await selectExternalFile(item.absPath);
      setContentMode('rendered');
    } else if (item.type === 'bookmarks') {
      setSelectedItemId(BOOKMARKS_ITEM_ID);
      setSelectedItemType('bookmarks');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
      setExternalOpenFile(null);
      setContentMode('rendered');
    }
    // Any navigation other than reselecting the same auto-popped artifact
    // dismisses the auto-pop exception.
    const stayingOnAutoPop = item.type === 'artifact' && item.absPath === autoPopArtifactPath;
    if (autoPopArtifactPath && !stayingOnAutoPop) {
      onAutoPopArtifactSuperseded?.();
    }
  }, [flushCurrentEdit, openWikiPage, selectArtifactPath, selectExternalFile, autoPopArtifactPath, onAutoPopArtifactSuperseded]);

  const handleDeletedLibraryItem = useCallback((item: UnifiedItem) => {
    const deletedSelection = deletedLibraryItemMatchesSelection(item, {
      selectedItemId,
      selectedItemType,
      wikiSelectedRelPath,
      selectedPath,
    });
    if (deletedSelection) clearSelectedLibraryItem();
  }, [clearSelectedLibraryItem, selectedItemId, selectedItemType, selectedPath, wikiSelectedRelPath]);

  // Seed editContent when the user enters markdown mode on a file, or when
  // they switch to a different file while editing. Guarded by path so that
  // activeReading updates caused by our own save don't clobber in-progress
  // edits (setWikiSelectedPage after a write produces a new object but the
  // path is unchanged).
  const lastSeededPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (contentMode !== 'markdown' || !activeReading) {
      lastSeededPathRef.current = null;
      return;
    }
    if (lastSeededPathRef.current === activeReading.path) return;
    const normalizedContent = removeEmptyMarkdownCommentPlaceholders(activeReading.content);
    setEditContent(normalizedContent);
    lastSavedContentRef.current = normalizedContent;
    lastSavedVersionRef.current = activeReading.documentVersion;
    lastSeededPathRef.current = activeReading.path;
  }, [contentMode, activeReading]);

  useEffect(() => {
    const session = restoredEditorSessionRef.current;
    if (!session) return;

    const cancelRestore = restoreEditorSession(session);
    if (cancelRestore) {
      restoredEditorSessionRef.current = null;
    }
    return cancelRestore;
  }, [activeReading?.path, restoreEditorSession]);

  useEffect(() => {
    if (!active) return;
    const restorePersistedSession = () => {
      const session = restoreLibrarianEditorSession(localStorage);
      restoreEditorSession(session);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushEditorSessionPersist();
      } else {
        restorePersistedSession();
      }
    };

    window.addEventListener('focus', restorePersistedSession);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      flushEditorSessionPersist();
      window.removeEventListener('focus', restorePersistedSession);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [active, flushEditorSessionPersist, restoreEditorSession]);

  const handleShare = useCallback(async () => {
    if (!selectedPath || !selectedReading) return;

    setIsSharing(true);
    try {
      if (shareStatus?.shared) {
        // Unshare
        const success = await Promise.race([
          window.librarianAPI?.unshareReading(selectedPath),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15000)),
        ]);
        if (success) {
          setShareStatus({ shared: false });
        }
      } else {
        // Share
        const result = await Promise.race([
          window.librarianAPI?.shareReading(selectedPath),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
        ]);
        if (result) {
          setShareStatus({ shared: true, slug: result.slug, url: result.url });
        } else {
          console.warn('[Librarian] Share failed or timed out');
        }
      }
    } catch (err) {
      console.error('[Librarian] Share error:', err);
    } finally {
      setIsSharing(false);
    }
  }, [selectedPath, selectedReading, shareStatus?.shared]);

  const copyShareLink = useCallback(async () => {
    if (!shareStatus?.url) return;
    await navigator.clipboard.writeText(shareStatus.url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shareStatus?.url]);

  const flashCopyPathCopied = useCallback(() => {
    setCopyPathCopied(true);
    if (copyPathFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyPathFeedbackTimerRef.current);
    }
    copyPathFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyPathCopied(false);
      copyPathFeedbackTimerRef.current = null;
    }, COPY_PATH_FEEDBACK_MS);
  }, []);

  const getRenderedSelectionText = useCallback((): string => {
    const root = renderedContentRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return '';

    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      const container = range.commonAncestorContainer;
      const node = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
      if (node && root.contains(node)) {
        return selection.toString();
      }
    }
    return '';
  }, []);

  const getActiveReadingCopyText = useCallback((): string => {
    if (contentMode === 'markdown') {
      const editor = markdownCodeEditorRef.current;
      const selection = editor?.getSelectionRange();
      if (editor && selection && selection.start !== selection.end) {
        return editor.getValue().slice(selection.start, selection.end);
      }
    }

    const renderedSelection = getRenderedSelectionText();
    if (renderedSelection) return renderedSelection;
    return activeReading?.path ?? '';
  }, [activeReading?.path, contentMode, getRenderedSelectionText]);

  const copyActiveReadingTextOrPath = useCallback(async () => {
    const text = getActiveReadingCopyText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopyPathCopied();
    } catch (err) {
      console.warn('[Librarian] Failed to copy text or path:', err);
    }
  }, [flashCopyPathCopied, getActiveReadingCopyText]);

  const copyActiveReadingPath = useCallback(async () => {
    if (!activeReading?.path) return;
    try {
      await navigator.clipboard.writeText(activeReading.path);
      flashCopyPathCopied();
    } catch (err) {
      console.warn('[Librarian] Failed to copy path:', err);
    }
  }, [activeReading?.path, flashCopyPathCopied]);

  useEffect(() => {
    return () => {
      if (copyPathFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyPathFeedbackTimerRef.current);
      }
    };
  }, []);

  // Delete current item — branches on selectedItemType. Wiki pages go to
  // macOS Trash via shell.trashItem (recoverable) and the main process
  // auto-prunes any matching Recent entry; artifacts use the existing
  // librarian delete flow.
  const handleDelete = useCallback(() => {
    if (selectedItemType === 'wiki') {
      if (!wikiSelectedRelPath || !activeReading) return;
      confirmDelete({
        title: 'Delete page?',
        message: `Move "${activeReading.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          const success = await window.wikiAPI?.deletePage(wikiSelectedRelPath);
          if (success) {
            dispatchLocalWikiDeleted(wikiSelectedRelPath);
            clearSelectedLibraryItem();
          }
        },
      });
      return;
    }

    if (selectedItemType === 'artifact') {
      if (!selectedPath || !selectedReading) return;
      confirmDelete({
        title: 'Delete artifact?',
        message: `Delete "${selectedReading.title}"? This cannot be undone.`,
        onConfirm: async () => {
          if (shareStatus?.shared) {
            await window.librarianAPI?.unshareReading(selectedPath);
          }
          const success = await window.librarianAPI?.deleteReading(selectedPath);
          if (success) clearSelectedLibraryItem();
        },
      });
    }
  }, [activeReading, clearSelectedLibraryItem, confirmDelete, selectedItemType, selectedPath, selectedReading, shareStatus?.shared, wikiSelectedRelPath]);

  // Play narration for current reading
  const handlePlayNarration = useCallback(async () => {
    if (!selectedPath) return;
    await window.narrationAPI?.playReading(selectedPath);
  }, [selectedPath]);

  // Stop narration
  const handleStopNarration = useCallback(async () => {
    await window.narrationAPI?.stop();
  }, []);

  // Check if current reading is being narrated
  const isNarrating = !!(selectedPath && narrationStatus.currentReadingPath === selectedPath);
  const isGenerating = narrationStatus.playbackStatus === 'generating' && isNarrating;
  const isPlaying = narrationStatus.playbackStatus === 'playing' && isNarrating;


  useEffect(() => {
    if (!wikiSelectedRelPath) { setWikiSelectedPage(null); return; }
    (async () => {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (page) {
        if (page.relPath !== wikiSelectedRelPath) {
          setWikiSelectedRelPath(page.relPath);
          setSelectedItemId(`wiki:${page.relPath}`);
        }
        setWikiSelectedPage(readingFromWikiPage(page));
        void window.recentAPI?.visit({
          kind: 'wiki',
          path: page.relPath,
          title: page.title,
          lastOpenedAt: Date.now(),
        });
      } else {
        // Target relPath disappeared between index refresh and navigation —
        // clear the stale render so the reader sees empty state instead of
        // the previous page, which would look like "the link did nothing".
        setWikiSelectedPage(null);
      }
    })();
  }, [wikiSelectedRelPath]);

  useEffect(() => {
    if (!wikiSelectedRelPath) return;
    let cancelled = false;
    const unsubscribe = window.wikiAPI?.onPageChanged(async () => {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (page) return;
      const previousVersion = lastSavedVersionRef.current;
      if (previousVersion) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (cancelled) return;
        const renamedPage = await window.wikiAPI?.findPageByDocumentVersion(previousVersion, wikiSelectedRelPath);
        if (renamedPage) {
          const reading = readingFromWikiPage(renamedPage);
          const hasUnsavedEdit = contentMode === 'markdown' && editContent !== lastSavedContentRef.current;
          if (hasUnsavedEdit) reading.content = editContent;
          const from = { itemType: 'wiki' as const, itemPath: wikiSelectedRelPath };
          const to = { itemType: 'wiki' as const, itemPath: renamedPage.relPath };
          historyNavigationTargetRef.current = to;
          setNavigationHistory((prev) => replaceLibrarianNavigationEntry(prev, from, to));
          lastSeededPathRef.current = reading.path;
          setWikiSelectedRelPath(renamedPage.relPath);
          setSelectedItemId(`wiki:${renamedPage.relPath}`);
          setSelectedItemType('wiki');
          setWikiSelectedPage(reading);
          lastSavedContentRef.current = renamedPage.content;
          lastSavedVersionRef.current = renamedPage.documentVersion;
          void window.recentAPI?.visit({
            kind: 'wiki',
            path: renamedPage.relPath,
            title: renamedPage.title,
            lastOpenedAt: Date.now(),
          });
          return;
        }
      }
      if (cancelled) return;
      setWikiSelectedRelPath(null);
      setWikiSelectedPage(null);
      setSelectedItemId(null);
      setSelectedItemType(null);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [contentMode, editContent, wikiSelectedRelPath]);

  useEffect(() => {
    if (selectedItemType !== 'external' || !externalOpenFile?.path) return;
    let cancelled = false;
    const previousPath = externalOpenFile.path;
    const unsubscribe = window.libraryAPI?.onRootsChanged(async () => {
      const file = await window.externalAPI?.open(previousPath);
      if (file) return;
      const previousVersion = lastSavedVersionRef.current;
      if (previousVersion) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (cancelled) return;
        const renamedFile = await window.externalAPI?.findLibraryFileByDocumentVersion(previousVersion, previousPath);
        if (renamedFile) {
          const reading = readingFromExternalMarkdownFile(renamedFile);
          const hasUnsavedEdit = contentMode === 'markdown' && editContent !== lastSavedContentRef.current;
          if (hasUnsavedEdit) reading.content = editContent;
          const from = { itemType: 'external' as const, itemPath: previousPath };
          const to = { itemType: 'external' as const, itemPath: renamedFile.path };
          historyNavigationTargetRef.current = to;
          setNavigationHistory((prev) => replaceLibrarianNavigationEntry(prev, from, to));
          lastSeededPathRef.current = reading.path;
          setExternalOpenFile(reading);
          setSelectedItemId(`external:${renamedFile.path}`);
          setSelectedPath(null);
          lastSavedContentRef.current = renamedFile.content;
          lastSavedVersionRef.current = renamedFile.documentVersion;
          void window.recentAPI?.visit({
            kind: 'external',
            path: renamedFile.path,
            title: reading.title,
            lastOpenedAt: Date.now(),
          });
          return;
        }
      }
      if (cancelled) return;
      setExternalOpenFile(null);
      setSelectedItemId(null);
      setSelectedItemType(null);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [contentMode, editContent, externalOpenFile?.path, selectedItemType]);

  useEffect(() => {
    const unsubscribe = window.wikiAPI?.onPageRenamed?.(async (event) => {
      if (selectedItemType !== 'wiki' || wikiSelectedRelPath !== event.oldRelPath) return;
      traceLibraryRename('view-wiki-received', event);
      const page = await window.wikiAPI?.getPage(event.newRelPath);
      if (!page) {
        traceLibraryRename('view-wiki-get-page-missed', event);
        return;
      }
      const reading = readingFromWikiPage(page);
      const hasUnsavedEdit = contentMode === 'markdown' && editContent !== lastSavedContentRef.current;
      if (hasUnsavedEdit) reading.content = editContent;
      const from = { itemType: 'wiki' as const, itemPath: event.oldRelPath };
      const to = { itemType: 'wiki' as const, itemPath: event.newRelPath };
      historyNavigationTargetRef.current = to;
      setNavigationHistory((prev) => replaceLibrarianNavigationEntry(prev, from, to));
      lastSeededPathRef.current = reading.path;
      setWikiSelectedRelPath(event.newRelPath);
      setSelectedItemId(`wiki:${event.newRelPath}`);
      setSelectedItemType('wiki');
      setWikiSelectedPage(reading);
      setTitleDraft(reading.title);
      lastSavedContentRef.current = page.content;
      lastSavedVersionRef.current = page.documentVersion;
      traceLibraryRename('view-wiki-updated', event, { hasUnsavedEdit });
    });

    return () => unsubscribe?.();
  }, [contentMode, editContent, selectedItemType, wikiSelectedRelPath]);

  useEffect(() => {
    const unsubscribe = window.libraryAPI?.onItemRenamed?.(async (event) => {
      if (event.builtin || selectedItemType !== 'external' || externalOpenFile?.path !== event.oldAbsPath) return;
      traceLibraryRename('view-external-received', event);
      const file = await window.externalAPI?.open(event.newAbsPath);
      if (!file) {
        traceLibraryRename('view-external-open-missed', event);
        return;
      }
      const reading = readingFromExternalMarkdownFile(file);
      const hasUnsavedEdit = contentMode === 'markdown' && editContent !== lastSavedContentRef.current;
      if (hasUnsavedEdit) reading.content = editContent;
      const from = { itemType: 'external' as const, itemPath: event.oldAbsPath };
      const to = { itemType: 'external' as const, itemPath: event.newAbsPath };
      historyNavigationTargetRef.current = to;
      setNavigationHistory((prev) => replaceLibrarianNavigationEntry(prev, from, to));
      lastSeededPathRef.current = reading.path;
      setExternalOpenFile(reading);
      setSelectedItemId(`external:${event.newAbsPath}`);
      setSelectedPath(null);
      setTitleDraft(reading.title);
      lastSavedContentRef.current = file.content;
      lastSavedVersionRef.current = file.documentVersion;
      traceLibraryRename('view-external-updated', event, { hasUnsavedEdit });
    });

    return () => unsubscribe?.();
  }, [contentMode, editContent, externalOpenFile?.path, selectedItemType]);

  // Load readings on mount and check setup completion
  useEffect(() => {
    async function loadReadings() {
      // Check if setup wizard is complete
      const isComplete = await window.librarianAPI?.isSetupComplete();
      setSetupComplete(isComplete ?? true); // Default to true for backwards compatibility

      // Load readings
      const result = await window.librarianAPI?.getReadings();
      if (result) {
        setReadings(result);
        const preferredArtifactPath =
          initialReadingPath ??
          (restoredSelection?.type === 'artifact' ? restoredSelection.path : null);

        if (preferredArtifactPath && result.some((reading) => reading.path === preferredArtifactPath)) {
          selectArtifactPath(preferredArtifactPath);
        } else if (result.length > 0 && !restoredSelection) {
          // Only default to the first artifact on a fresh session. Any
          // restoredSelection (wiki, bookmarks, or an artifact that's since
          // been deleted) takes precedence and should not be clobbered.
          selectArtifactPath(result[0].path);
        }
      }
      setLoading(false);
    }
    loadReadings();
  }, [initialReadingPath, restoredSelection, selectArtifactPath]);

  // Handle setup wizard completion
  const handleSetupComplete = useCallback(async () => {
    setSetupComplete(true);
    // Reload readings to show the new welcome artifact
    const result = await window.librarianAPI?.getReadings();
    if (result) {
      setReadings(result);
      if (result.length > 0) {
        selectArtifactPath(result[0].path);
      }
    }
  }, [selectArtifactPath]);

  // Load selected reading content
  useEffect(() => {
    async function loadReading() {
      if (selectedPath === null) {
        setSelectedReading(null);
        return;
      }
      const result = await window.librarianAPI?.getReading(selectedPath);
      setSelectedReading(result || null);
    }
    loadReading();
  }, [selectedPath]);

  // Load share status when reading changes
  useEffect(() => {
    async function loadShareStatus() {
      if (!selectedPath) {
        setShareStatus(null);
        return;
      }
      const status = await window.librarianAPI?.getShareStatus(selectedPath);
      setShareStatus(status || null);
    }
    loadShareStatus();
  }, [selectedPath]);

  // Listen for new readings
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingAdded((reading) => {
      setReadings((prev) => [
        {
          path: reading.path,
          title: reading.title,
          context: reading.context,
          readingTime: reading.readingTime,
          modelSignature: reading.modelSignature,
          createdAt: reading.createdAt,
          mtime: reading.mtime,
        },
        ...prev,
      ]);
    });

    return () => unsubscribe?.();
  }, []);

  // Listen for reading updates (file content changed)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingUpdated((reading) => {
      setReadings((prev) =>
        prev.map((r) => (r.path === reading.path ? reading : r))
      );
      // Reload content if this is the selected reading
      if (selectedPath === reading.path) {
        window.librarianAPI?.getReading(reading.path).then((result) => {
          setSelectedReading(result || null);
        });
      }
    });

    return () => unsubscribe?.();
  }, [selectedPath]);

  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingRenamed?.(({ oldPath, reading, traceId, emittedAt }) => {
      if (libraryRenameTraceEnabled()) {
        console.debug('[LibraryRenameTrace]', 'view-reading-received', {
          traceId,
          oldPath,
          newPath: reading.path,
          ipcAgeMs: emittedAt ? Date.now() - emittedAt : null,
        });
      }
      setNavigationHistory((prev) => replaceLibrarianNavigationEntry(
        prev,
        { itemType: 'artifact', itemPath: oldPath },
        { itemType: 'artifact', itemPath: reading.path },
      ));
      setReadings((prev) => {
        const withoutOld = prev.filter((r) => r.path !== oldPath && r.path !== reading.path);
        return [reading, ...withoutOld];
      });
      if (selectedPath === oldPath) {
        setSelectedPath(reading.path);
        setSelectedItemId(`artifact:${reading.path}`);
        window.librarianAPI?.getReading(reading.path).then((result) => {
          setSelectedReading(result || null);
        });
      }
    });

    return () => unsubscribe?.();
  }, [selectedPath]);

  // Listen for reading removals (file deleted)
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onReadingRemoved((filePath) => {
      setNavigationHistory((prev) => {
        const entries = prev.entries.filter((entry) => !(entry.itemType === 'artifact' && entry.itemPath === filePath));
        if (entries.length === prev.entries.length) return prev;
        return {
          entries,
          index: Math.min(prev.index, entries.length - 1),
        };
      });
      setReadings((prev) => {
        const newReadings = prev.filter((r) => r.path !== filePath);
        // If removed reading was selected, select next one
        if (selectedPath === filePath && newReadings.length > 0) {
          const currentIndex = prev.findIndex((r) => r.path === filePath);
          const newIndex = Math.min(currentIndex, newReadings.length - 1);
          selectArtifactPath(newReadings[newIndex].path);
        } else if (selectedPath === filePath) {
          setSelectedPath(null);
          setSelectedItemId(null);
          setSelectedItemType(null);
        }
        return newReadings;
      });
    });

    return () => unsubscribe?.();
  }, [selectedPath, selectArtifactPath]);

  // Listen for URL-scheme focus requests. Bookmarks maps to legacy fullscreen;
  // normal Library documents map to focus chrome without resizing the window.
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onSetFullscreen((fullscreen) => {
      if (selectedItemUsesLegacyImmersive) {
        setIsFullScreen(fullscreen);
      } else {
        setFocusImmersive(fullscreen);
      }
    });

    return () => unsubscribe?.();
  }, [selectedItemUsesLegacyImmersive]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (isImmersiveToggleShortcut(e)) {
        e.preventDefault();
        toggleFocusChromeShortcut();
        return;
      }
      if (selectedItemType === 'bookmarks' && isSidebarToggleShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleImmersive();
        return;
      }

      // Cmd+. - toggle between rendered and markdown.
      if (isMarkdownModeToggleShortcut(e)) {
        e.preventDefault();
        if (contentMode === 'markdown') {
          void exitEditMode();
        } else if (activeReading) {
          enterEditMode();
        }
        return;
      }

      // Cmd+S - flush the pending auto-save and drop back to rendered.
      if (e.key === 's' && e.metaKey && contentMode === 'markdown') {
        e.preventDefault();
        void exitEditMode();
        return;
      }

      if (isCommandFindShortcut(e) && activeReading) {
        e.preventDefault();
        openFileFind();
        return;
      }

      // / focuses library search. Cmd+F remains available for in-file find.
      if (isSearchFocusShortcut(e)) {
        e.preventDefault();
        deactivateSidebarKeyboard();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === 'c' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && activeReading?.path) {
        e.preventDefault();
        void copyActiveReadingPath();
        return;
      }

      // Cmd+C copies selected file text first, then falls back to the path.
      if (e.key === 'c' && e.metaKey && !e.shiftKey && contentMode !== 'markdown') {
        if (activeReading?.path) {
          e.preventDefault();
          void copyActiveReadingTextOrPath();
          return;
        }
      }

      // Cmd+N - create new file (inline input in sidebar)
      if (e.key === 'n' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const folder = selectedItemType === 'wiki'
          ? resolveWikiCreateFolder('', selectedItemType, wikiSelectedRelPath)
          : undefined;
        wikiCreationRef.current?.beginCreateFile(folder);
        return;
      }

      // Cmd+Shift+N - create new directory (inline input in sidebar)
      if (e.key === 'n' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        wikiCreationRef.current?.beginCreateDir();
        return;
      }

      // Cmd/Ctrl + = (plus) - increase text size
      if ((e.key === '=' || e.key === '+') && e.metaKey) {
        e.preventDefault();
        setTextSize((prev) => {
          if (prev === 'small') return 'normal';
          if (prev === 'normal') return 'large';
          return 'large'; // Already at max
        });
        return;
      }

      // Cmd/Ctrl + - (minus) - decrease text size
      if (e.key === '-' && e.metaKey) {
        e.preventDefault();
        setTextSize((prev) => {
          if (prev === 'large') return 'normal';
          if (prev === 'normal') return 'small';
          return 'small'; // Already at min
        });
        return;
      }

      // Cmd+W - close window (same as red close button). Flush pending save
      // first so an in-flight debounce doesn't lose the last keystrokes.
      if (e.key === 'w' && e.metaKey) {
        e.preventDefault();
        const pending = flushCurrentEdit();
        void pending.then(() => window.clipboardAPI?.closeWindow());
        return;
      }

      // Cmd+[ / Cmd+] - match the toolbar back and forward controls.
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '[' && canNavigateBack) {
          e.preventDefault();
          navigateHistory(-1);
          return;
        }
        if (e.key === ']' && canNavigateForward) {
          e.preventDefault();
          navigateHistory(1);
          return;
        }
      }

      if (document.activeElement === searchInputRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setSearchQuery('');
          searchInputRef.current?.blur();
        }
        return;
      }

      // Escape hierarchy: edit-mode → focus chrome → legacy fullscreen → close window.
      // In markdown mode, Esc just drops back to rendered without closing the
      // window — auto-save already persisted the content.
      if (e.key === 'Escape') {
        if (shortcutsHelpOpen) {
          setShortcutsHelpOpen(false);
        } else if (contentMode === 'markdown') {
          void exitEditMode();
        } else if (focusImmersive) {
          setFocusImmersive(false);
        } else if (isFullScreen && isOnAutoPopArtifact) {
          window.clipboardAPI?.closeWindow();
        } else if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          window.clipboardAPI?.closeWindow();
        }
        return;
      }

      const isSidebarNavigationKey = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'j' || e.key === 'k';
      const activeEl = document.activeElement;
      const inTextInput = (activeEl instanceof HTMLInputElement && isTextEntryInputType(activeEl.type))
        || activeEl instanceof HTMLTextAreaElement
        || activeEl instanceof HTMLSelectElement
        || (activeEl instanceof HTMLElement && activeEl.isContentEditable);
      if (inTextInput) return;

      if (isKeyboardShortcutsHelpShortcut(e)) {
        e.preventDefault();
        setShortcutsHelpOpen((open) => !open);
        return;
      }

      if (isCommandDeleteShortcut(e) && sidebarKeyboardActiveRef.current && selectedItemType === 'wiki') {
        e.preventDefault();
        handleDelete();
        return;
      }

      if (shouldHandleMarkdownTodoTabShortcut({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, selectedItemType })) {
        e.preventDefault();
        void cycleSelectedMarkdownTodoState(e.shiftKey ? 'backward' : 'forward');
        return;
      }

      if (!isSidebarNavigationKey) return;
      if (!sidebarKeyboardActiveRef.current) return;

      // Arrow key / j/k navigation through the current sidebar folder.
      const items = flatItemsRef.current;
      if (items.length > 0) {
        const currentIdx = items.findIndex((i) => i.id === selectedItemId);
        if (currentIdx < 0) return;
        if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          const newIdx = Math.max(0, currentIdx - 1);
          handleSelectItem(items[newIdx]);
        } else if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          const newIdx = Math.min(items.length - 1, currentIdx + 1);
          handleSelectItem(items[newIdx]);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, readings, selectedPath, isFullScreen, focusImmersive, contentMode, activeReading, onSwitchToClipboard, enterEditMode, exitEditMode, flushCurrentEdit, handleCreateFile, handleCreateDir, selectedItemId, handleSelectItem, selectedItemType, handleDelete, cycleSelectedMarkdownTodoState, isOnAutoPopArtifact, toggleFocusChromeShortcut, toggleImmersive, canNavigateBack, canNavigateForward, navigateHistory, openFileFind, copyActiveReadingTextOrPath, copyActiveReadingPath, shortcutsHelpOpen]);

  // Listen for show reading requests (auto-show on new reading)
  // Note: fullscreen state is controlled separately by onSetFullscreen, not here
  useEffect(() => {
    const unsubscribe = window.librarianAPI?.onShowReading((readingPath) => {
      selectArtifactPath(readingPath);
    });

    return () => unsubscribe?.();
  }, [selectArtifactPath]);

  // Listen for wiki:openPage requests from fieldtheory://wiki/open URL scheme
  useEffect(() => {
    const unsubscribe = window.wikiAPI?.onOpenWikiPage((relPath) => {
      openWikiPage(relPath);
    });

    return () => unsubscribe?.();
  }, [openWikiPage]);

  // Keep a flat list of all wiki pages for resolving [[wikilinks]]. Reloaded
  // on mount and whenever the wiki tree changes so links to newly created
  // pages resolve without a reopen.
  useEffect(() => {
    if (!active) return;
    const load = async () => {
      const folders = await window.wikiAPI?.getTree();
      if (!folders) return;
      setWikiIndexPages(
        folders.flatMap((f) => f.files.map((p) => ({ relPath: p.relPath, title: p.title }))),
      );
    };
    void load();
    const unsubscribe = window.wikiAPI?.onPageChanged(() => { void load(); });
    return () => unsubscribe?.();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const toIndexPages = (commands: Array<{ name: string; displayName: string; filePath: string }> | undefined): WikiIndexInput[] => (
      commands ?? []
    ).flatMap((command) => {
      const displayTitle = command.displayName || command.name;
      const base = {
        relPath: command.filePath,
        commandPath: command.filePath,
      };
      return displayTitle === command.name
        ? [{ ...base, title: command.name }]
        : [{ ...base, title: displayTitle }, { ...base, title: command.name }];
    });

    const load = async () => {
      const commands = await window.commandsAPI?.getCommands();
      setCommandIndexPages(toIndexPages(commands));
    };
    void load();
    const unsubscribe = window.commandsAPI?.onCommandsChanged((commands) => {
      setCommandIndexPages(toIndexPages(commands));
    });
    return () => unsubscribe?.();
  }, [active]);

  // macOS `open-file` for paths outside the wiki root.
  useEffect(() => {
    const unsubscribe = window.externalAPI?.onOpenExternal((absPath) => {
      void selectExternalFile(absPath);
    });
    return () => unsubscribe?.();
  }, [selectExternalFile]);

  // Mirror the current file into the native macOS title bar (proxy icon +
  // Cmd-click menu showing the full path). Only external files get this —
  // wiki/artifacts live under our private data dir so the proxy icon would
  // point users to an opaque internal path.
  useEffect(() => {
    const representedPath = active && selectedItemType === 'external' ? activeReading?.path ?? '' : '';
    void window.shellAPI?.setRepresentedFilename(representedPath);
  }, [active, selectedItemType, activeReading?.path]);

  // Discover existing .librarian directories on empty state
  useEffect(() => {
    if (active && !loading && readings.length === 0 && discoveredDirs.length === 0 && !isDiscovering) {
      setIsDiscovering(true);
      window.librarianAPI?.discoverLibrarianDirs().then((dirs) => {
        setDiscoveredDirs(dirs);
        setIsDiscovering(false);
      });
    }
  }, [active, loading, readings.length, discoveredDirs.length, isDiscovering]);

  // Helper to format path for display (show project name from path)
  const formatDirPath = (dirPath: string): { projectName: string; location: string } => {
    // Remove .librarian suffix and get parent (project) directory
    const projectPath = dirPath.replace(/\/.librarian$/, '');
    const parts = projectPath.split('/');
    const projectName = parts[parts.length - 1];
    // Show abbreviated parent path
    const parentPath = parts.slice(0, -1).join('/').replace(/^\/Users\/[^/]+/, '~');
    return { projectName, location: parentPath };
  };

  // Add a discovered directory
  const handleAddDiscoveredDir = async (dirPath: string) => {
    setAddingDir(dirPath);
    try {
      const result = await window.librarianAPI?.addWatchedDir(dirPath);
      if (result) {
        // Remove from discovered list and reload readings
        setDiscoveredDirs((prev) => prev.filter((d) => d !== dirPath));
        const newReadings = await window.librarianAPI?.getReadings();
        if (newReadings) {
          setReadings(newReadings);
          if (newReadings.length > 0) {
            selectArtifactPath(newReadings[0].path);
          }
        }
      }
    } finally {
      setAddingDir(null);
    }
  };

  // Add all discovered directories
  const handleAddAllDiscoveredDirs = async () => {
    for (const dirPath of discoveredDirs) {
      await window.librarianAPI?.addWatchedDir(dirPath);
    }
    setDiscoveredDirs([]);
    const newReadings = await window.librarianAPI?.getReadings();
    if (newReadings) {
      setReadings(newReadings);
      if (newReadings.length > 0) {
        selectArtifactPath(newReadings[0].path);
      }
    }
  };

  // Setup wizard - shown on first visit
  if (!loading && setupComplete === false) {
    return <LibrarianSetupWizard onComplete={handleSetupComplete} />;
  }

  // Empty state
  if (!loading && readings.length === 0) {
    return (
      <div
        ref={containerRef}
        tabIndex={0}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '32px',
          color: theme.textSecondary,
          textAlign: 'center',
          outline: 'none',
        }}
      >
        <div style={{ fontSize: '32px', marginBottom: '16px' }}>
          {theme.isDark ? '📚' : '📖'}
        </div>
        <div style={{ fontSize: '16px', fontWeight: 500, marginBottom: '8px', color: theme.text }}>
          No artifacts yet
        </div>

        {/* Show discovered directories if any */}
        {discoveredDirs.length > 0 ? (
          <>
            <div style={{ fontSize: '13px', marginBottom: '16px', maxWidth: '320px' }}>
              Found {discoveredDirs.length} existing reading{discoveredDirs.length === 1 ? '' : 's'} collection{discoveredDirs.length === 1 ? '' : 's'}:
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '16px',
                maxWidth: '400px',
                width: '100%',
              }}
            >
              {discoveredDirs.map((dirPath) => {
                const { projectName, location } = formatDirPath(dirPath);
                const isAdding = addingDir === dirPath;
                return (
                  <div
                    key={dirPath}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                      borderRadius: '8px',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: theme.text, fontSize: '13px' }}>
                        {projectName}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: theme.textSecondary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {location}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddDiscoveredDir(dirPath)}
                      disabled={isAdding}
                      style={{
                        padding: '4px 12px',
                        fontSize: '12px',
                        fontWeight: 500,
                        color: 'white',
                        backgroundColor: theme.accent,
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isAdding ? 'default' : 'pointer',
                        opacity: isAdding ? 0.6 : 1,
                        flexShrink: 0,
                      }}
                    >
                      {isAdding ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
            {discoveredDirs.length > 1 && (
              <button
                onClick={handleAddAllDiscoveredDirs}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'white',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  marginBottom: '16px',
                }}
              >
                Add All
              </button>
            )}
            <div
              style={{
                fontSize: '11px',
                color: theme.textSecondary,
                marginTop: '8px',
              }}
            >
              Or{' '}
              <button
                onClick={onSwitchToSettings}
                style={{
                  background: 'none',
                  border: 'none',
                  color: theme.accent,
                  cursor: 'pointer',
                  fontSize: '11px',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                open Settings
              </button>{' '}
              to add a new directory
            </div>
          </>
        ) : isDiscovering ? (
          <div style={{ fontSize: '13px', marginBottom: '24px', color: theme.textSecondary }}>
            Searching for existing artifacts...
          </div>
        ) : (
          <>
          <div style={{ fontSize: '13px', marginBottom: '24px', maxWidth: '280px' }}>
              Add a watched directory in Settings to start collecting artifacts from your coding sessions.
            </div>
            {onSwitchToSettings && (
              <button
                onClick={onSwitchToSettings}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'white',
                  backgroundColor: theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Open Settings
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  let renderedTaskInputIndex = 0;
  let renderedTaskListItemIndex = 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        outline: 'none',
        position: 'relative',
        backgroundColor: theme.bg,
      }}
    >
      <ScrollDiagnosticsHUD />
      <style>
        {`
          @keyframes ftRenderedTaskCompletedLive {
            0% {
              background: rgba(52, 199, 89, 0);
              box-shadow: inset 0 0 0 0 rgba(52, 199, 89, 0);
              transform: translateX(0);
            }
            18% {
              background: rgba(52, 199, 89, 0.16);
              box-shadow: inset 3px 0 0 rgba(52, 199, 89, 0.8);
              transform: translateX(2px);
            }
            100% {
              background: rgba(52, 199, 89, 0);
              box-shadow: inset 0 0 0 0 rgba(52, 199, 89, 0);
              transform: translateX(0);
            }
          }
          .ft-rendered-task-completed-live {
            animation: ftRenderedTaskCompletedLive 1.4s ease-out;
          }
          .ft-rendered-task-completed-live span {
            text-decoration: line-through;
            text-decoration-thickness: 1.5px;
            text-decoration-color: rgba(52, 199, 89, 0.85);
          }
          @keyframes ftMarkdownEditorFadeIn {
            from { opacity: 0.72; }
            to { opacity: 1; }
          }
        `}
      </style>
      {/* Sidebar - hidden in full-screen mode but kept in DOM for instant collapse */}
      <div
        ref={sidebarPaneRef}
        style={{
          width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          minWidth: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
          display: isFullScreen ? 'none' : 'block',
          overflow: 'hidden',
          userSelect: isResizing ? 'none' : 'auto',
          flexShrink: 0,
          transition: isResizing ? 'none' : 'width 0.18s ease, min-width 0.18s ease',
        }}
      >
        <div
          ref={sidebarInnerRef}
          style={{
            width: `${sidebarWidth}px`,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 0 0',
            minHeight: 0,
            pointerEvents: sidebarCollapsed ? 'none' : 'auto',
          }}
        >
          <WikiSidebar
            active={active}
            selectedId={selectedItemId}
            selectedKeyboardActive={sidebarKeyboardActive}
            todoStateOverrides={sidebarTodoStateOverrides}
            onSelectItem={handleSelectItem}
            onCreateFile={handleCreateFile}
            onCreateDefaultFile={handleCreateDefaultFile}
            onCreateDir={handleCreateDir}
            flatItemsRef={flatItemsRef}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchInputRef={searchInputRef}
            creationControllerRef={wikiCreationRef}
            onDeletedItem={handleDeletedLibraryItem}
            onKeyboardScopeActive={activateSidebarKeyboard}
          />
        </div>
      </div>
      {/* Resize handle - hidden in full-screen mode but kept in DOM */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          width: sidebarCollapsed ? '0px' : '4px',
          minWidth: sidebarCollapsed ? '0px' : '4px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: sidebarCollapsed ? '0 solid transparent' : `1px solid ${theme.border}`,
          transition: 'width 0.18s ease, min-width 0.18s ease, background-color 0.15s ease',
          flexShrink: 0,
          display: isFullScreen ? 'none' : 'block',
          pointerEvents: sidebarCollapsed ? 'none' : 'auto',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = theme.isDark
              ? 'rgba(255,255,255,0.1)'
              : 'rgba(0,0,0,0.05)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizing) {
            e.currentTarget.style.backgroundColor = 'transparent';
          }
        }}
      />

      {/* Reader pane */}
      <div
        ref={readerPaneRef}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0, // Required for flex child to shrink below content size
          position: 'relative',
        }}
      >
        {bookmarksEverShown && (
          <div
            style={{
              flex: 1,
              display: selectedItemType === 'bookmarks' ? 'flex' : 'none',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <BookmarksPane
              active={active && selectedItemType === 'bookmarks'}
              isFullScreen={isFullScreen}
              onToggleFullScreen={toggleImmersive}
              onCanvasModeActiveChange={setBookmarksCanvasActive}
              onCanvasToolbarTopChange={onBookmarksCanvasToolbarTopChange}
            />
          </div>
        )}
        {selectedItemType !== 'bookmarks' && (<Fragment>
        {/* Top draggable region - captures clicks at very top of frameless window */}
        <div
          style={{
            height: isFullScreen ? '20px' : '0px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            // @ts-ignore - webkit vendor prefix for Electron draggable region
            WebkitAppRegion: 'drag',
            cursor: 'grab',
          }}
        >
          {/* Drag handle indicator - only visible in immersive mode */}
          {isFullScreen && (
            <div
              style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
              }}
            />
          )}
        </div>

        {/* Toolbar - includes draggable region for window movement */}
        {activeReading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isFullScreen ? '8px 16px 4px 16px' : '8px 20px',
              backgroundColor: theme.bg,
              flexShrink: 0,
              position: focusChromeActive ? 'absolute' : 'relative',
              top: focusChromeActive ? 0 : undefined,
              left: focusChromeActive ? 0 : undefined,
              right: focusChromeActive ? 0 : undefined,
              zIndex: focusChromeActive ? 20 : undefined,
              boxSizing: 'border-box',
              opacity: focusChromeVisualVisible ? 1 : 0,
              pointerEvents: focusChromeVisualVisible ? 'auto' : 'none',
              transition: 'opacity 180ms ease',
            }}
          >
            {/* Inner container - always matches the centered document width. */}
            <div
              style={{
                maxWidth: typographyPreset.maxWidth,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Nav: back (only visible in fullscreen). Copy-path moved to
                  the right of the immersive toggle inside ContentToolbar. */}
              {isFullScreen && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginRight: '8px' }}>
                  <button
                    onClick={() => setIsFullScreen(false)}
                    style={{ padding: '3px 6px', fontSize: '11px', color: theme.textSecondary, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    title="Back to standard view"
                  >←</button>
                </div>
              )}
              {/* Breadcrumb — "folder / filename" for wiki, "parent / filename"
                  + External chip for external. Artifacts skip this (title
                  already renders prominently in the content area). */}
              {focusToolbarControlsVisible && (selectedItemType === 'wiki' || selectedItemType === 'external') && activeReading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    flexShrink: 1,
                    // @ts-ignore - opt the breadcrumb out of the drag region so
                    // clicks on the External chip's title tooltip land.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={activeReading.path}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  >
                    {formatBreadcrumb(selectedItemType, activeReading, wikiSelectedRelPath)}
                  </span>
                  {selectedItemType === 'external' && (
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        letterSpacing: '0.4px',
                        textTransform: 'uppercase',
                        color: theme.isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.65)',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        flexShrink: 0,
                      }}
                    >
                      External
                    </span>
                  )}
                </div>
              )}
              <ContentToolbar
                filePath={activeReading?.path || undefined}
                isFullScreen={isFullScreen}
                canNavigateBack={canNavigateBack}
                canNavigateForward={canNavigateForward}
                onNavigateBack={() => navigateHistory(-1)}
                onNavigateForward={() => navigateHistory(1)}
                textSize={textSize}
                onTextSizeChange={setTextSize}
                showTextSize={focusToolbarControlsVisible}
                typographyPreset={typographyPresetId}
                typographyPresetOptions={focusToolbarControlsVisible ? LIBRARIAN_TYPOGRAPHY_PRESETS : undefined}
                onTypographyPresetChange={focusToolbarControlsVisible ? (preset) => {
                  if (isLibrarianTypographyPresetId(preset)) {
                    setTypographyPresetId(preset);
                  }
                } : undefined}
                lineHeight={lineHeightId}
                lineHeightOptions={focusToolbarControlsVisible ? LIBRARIAN_LINE_HEIGHT_OPTIONS : undefined}
                onLineHeightChange={focusToolbarControlsVisible ? (lineHeight) => {
                  if (isLibrarianLineHeightId(lineHeight)) {
                    setLineHeightId(lineHeight);
                  }
                } : undefined}
                unorderedListMarker={unorderedListMarker}
                onUnorderedListMarkerChange={focusToolbarControlsVisible ? setUnorderedListMarker : undefined}
                todoMarker={todoMarker}
                onTodoMarkerChange={focusToolbarControlsVisible ? setTodoMarker : undefined}
                onTypographyMenuOpenChange={setFocusToolbarMenuOpen}
                onDelete={focusToolbarControlsVisible ? handleDelete : undefined}
                showDelete={focusToolbarControlsVisible}
                onShowInFolder={focusToolbarControlsVisible ? () => activeReading?.path && window.shellAPI?.showItemInFolder(activeReading.path) : undefined}
                showFolder={focusToolbarControlsVisible}
                onCopy={focusToolbarControlsVisible && shareStatus?.shared ? copyShareLink : undefined}
                showCopy={focusToolbarControlsVisible && !!shareStatus?.shared}
                shareStatus={shareStatus}
                isSharing={isSharing}
                showShare={false}
                onCopyPath={focusToolbarControlsVisible && activeReading?.path ? copyActiveReadingTextOrPath : undefined}
                copyPathCopied={copyPathCopied}
                copyPathTitle="Copy selected text or file path (⌘C)"
              />

              {/* Agent kickoff — opens a popup that dispatches the user's
                  locally-installed Claude Code / Codex CLI against this file. */}
              {LIBRARIAN_AGENT_KICKOFF_ENABLED && focusToolbarControlsVisible && activeReading?.path
                && (selectedItemType === 'wiki' || selectedItemType === 'external')
                && (
                <button
                  type="button"
                  onClick={() => setAgentKickoffOpen(true)}
                  title="Run a local agent on this file (Claude Code or Codex)"
                  aria-label="Run agent on this file"
                  style={{
                    width: '26px',
                    height: '24px',
                    padding: 0,
                    fontSize: '12px',
                    fontWeight: 500,
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px',
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                    // @ts-ignore - opt out of the drag region so the click lands.
                    WebkitAppRegion: 'no-drag',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
                    e.currentTarget.style.color = theme.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = theme.textSecondary;
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4" />
                    <path d="m6.41 6.41-2.83-2.83" />
                    <path d="M2 12h4" />
                    <path d="m6.41 17.59-2.83 2.83" />
                    <path d="M12 18v4" />
                    <path d="m17.59 17.59 2.83 2.83" />
                    <path d="M18 12h4" />
                    <path d="m17.59 6.41 2.83-2.83" />
                    <circle cx="12" cy="12" r="4" />
                  </svg>
                </button>
              )}

              {fileFindOpen && (
                <input
                  ref={fileFindInputRef}
                  value={fileFindQuery}
                  onChange={(event) => {
                    setFileFindQuery(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setFileFindOpen(false);
                      setFileFindQuery('');
                      if (contentMode === 'markdown') markdownCodeEditorRef.current?.focus({ preventScroll: true });
                      return;
                    }
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      runFileFind(fileFindQuery, true);
                    }
                  }}
                  placeholder="Find in file"
                  style={{
                    width: '150px',
                    height: '24px',
                    padding: '2px 8px',
                    fontSize: '12px',
                    color: theme.text,
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '5px',
                    outline: 'none',
                    // @ts-ignore - keep the find input clickable in the drag region.
                    WebkitAppRegion: 'no-drag',
                  }}
                />
              )}

              {/* Narration Play/Stop button (feature flagged) */}
              {FEATURE_NARRATION_ENABLED && selectedReading && contentMode !== 'markdown' && (
                <button
                  onClick={isPlaying || isGenerating ? handleStopNarration : handlePlayNarration}
                  disabled={isGenerating}
                  style={{
                    padding: '4px 8px',
                    fontSize: '13px',
                    color: isPlaying ? '#8b5cf6' : theme.textSecondary,
                    backgroundColor: isPlaying
                      ? (theme.isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isGenerating ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isPlaying && !isGenerating) {
                      e.currentTarget.style.backgroundColor = theme.isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isPlaying) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                  title={isPlaying ? 'Stop narration' : isGenerating ? 'Generating...' : 'Listen to reading'}
                >
                  {/* Speaker icon or stop icon */}
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  ) : isGenerating ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ animation: 'pulse 1s infinite' }}>
                      <circle cx="12" cy="12" r="3" />
                      <circle cx="12" cy="12" r="8" fillOpacity="0.3" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                  <span style={{ fontSize: '12px' }}>
                    {isPlaying ? 'Stop' : isGenerating ? '...' : 'Listen'}
                  </span>
                </button>
              )}

              {/* Content mode toggle - raw markdown / rendered view */}
              {focusToolbarControlsVisible && (
                <div
                  style={{
                    display: 'flex',
                    gap: '2px',
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                    borderRadius: '6px',
                    padding: '2px',
                  }}
                >
                  <button
                    onClick={() => {
                      if (contentMode !== 'markdown' && activeReading) enterEditMode();
                    }}
                    title="Markdown source"
                    aria-label="Markdown source"
                    style={{
                      width: '26px',
                      height: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      color: contentMode === 'markdown' ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                      backgroundColor: contentMode === 'markdown'
                        ? (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                        : 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="5 4 2 8 5 12" />
                      <polyline points="11 4 14 8 11 12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      if (contentMode === 'markdown') void exitEditMode();
                    }}
                    title="Rendered"
                    aria-label="Rendered"
                    style={{
                      width: '26px',
                      height: '22px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      color: contentMode === 'rendered' ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                      backgroundColor: contentMode === 'rendered'
                        ? (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)')
                        : 'transparent',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M2 4h12M2 8h12M2 12h8" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Immersive/fullscreen toggle sits to the right of the mode
                  toggle so the editor controls stay grouped together. */}
              <ImmersiveToggle isFullScreen={isFullScreen || focusImmersive} onToggle={toggleFocusChromeShortcut} />
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <div
          ref={setContentScrollRef}
          onScroll={(e) => {
            if (contentMode !== 'markdown') updateRenderedDocumentTopFade(e.currentTarget);
          }}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: contentMode === 'markdown' ? 'hidden' : 'auto',
            padding: `${contentTopPadding}px 32px ${LIBRARIAN_CONTENT_BOTTOM_PADDING_PX}px 32px`,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {activeReading ? (
          <div
            style={{
              maxWidth: typographyPreset.maxWidth,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              flex: contentMode === 'markdown' ? '1 1 auto' : '0 1 auto',
              height: contentMode === 'markdown' ? '100%' : 'auto',
              minHeight: 0,
              overflow: contentMode === 'markdown' ? 'hidden' : 'visible',
              position: 'relative',
            }}
          >
            {activeTitlePath && activeReading && (
              <input
                ref={titleInputRef}
                value={editingTitlePath === activeTitlePath ? titleDraft : activeReading.title}
                onFocus={beginTitleEdit}
                onChange={(event) => {
                  if (editingTitlePath !== activeTitlePath) beginTitleEdit();
                  setTitleDraft(event.currentTarget.value);
                }}
                onBlur={() => { void commitTitleEdit(); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void commitTitleEdit({ focusBody: true });
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditingTitlePath(null);
                    setTitleDraft(activeReading.title);
                    titleInputRef.current?.blur();
                  }
                }}
                spellCheck={false}
                aria-label="File title"
                style={{
                  width: '100%',
                  flex: '0 0 auto',
                  margin: contentMode === 'markdown' ? '0 0 18px 0' : '0 0 22px 0',
                  padding: 0,
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  color: theme.text,
                  fontSize: contentMode === 'markdown' ? '26px' : '30px',
                  lineHeight: 1.18,
                  fontWeight: 650,
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  letterSpacing: 0,
                  textOverflow: 'ellipsis',
                }}
              />
            )}
            {contentMode === 'markdown' ? (
              /* Markdown edit mode */
              <div
                style={{
                  position: 'relative',
                  flex: '1 1 0',
                  minHeight: 0,
                  width: '100%',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    animation: 'ftMarkdownEditorFadeIn 140ms ease-out',
                  }}
                >
                  <MarkdownCodeEditor
                    ref={markdownCodeEditorRef}
                    value={editContent}
                    onChange={(next) => {
                      const normalizedNext = removeEmptyMarkdownCommentPlaceholders(next);
                      markdownEditUndoStackRef.current = [];
                      markWritingActive();
                      setEditContent(normalizedNext);
                      scheduleEditorSessionPersist();
                    }}
                    onKeyDown={handleMarkdownCodeEditorKeyDown}
                    onMouseDown={handleMarkdownCodeEditorMouseDown}
                    onPaste={handleMarkdownCodeEditorPaste}
                    onFocus={() => {
                      deactivateSidebarKeyboard();
                      commitTitleEditIfActive();
                      window.librarianAPI?.setMarkdownEditorFocused(true);
                    }}
                    onBlur={() => {
                      window.librarianAPI?.setMarkdownEditorFocused(false);
                      setMarkdownWikiLinkCompletion(null);
                    }}
                    onSelectionChange={updateMarkdownCodeEditorWikiLinkCompletion}
                    onScroll={() => {
                      scheduleEditorSessionPersist();
                      updateMarkdownEditorFades(markdownCodeEditorRef.current);
                    }}
                    fontFamily={(documentTextStyle.fontFamily as string) ?? '-apple-system, BlinkMacSystemFont, sans-serif'}
                    fontSize={(documentTextStyle.fontSize as string | number) ?? 16}
                    lineHeight={(documentTextStyle.lineHeight as string | number) ?? 1.6}
                    color={(documentTextStyle.color as string) ?? theme.text}
                    background="transparent"
                    caretColor={theme.accent}
                    blinkCursor={blinkTextCursor}
                    placeholder="Write your markdown here..."
                    dataAttributes={{
                      'data-ft-agent-context': 'markdown',
                      'data-ft-agent-file-path': activeReading.path,
                      'data-ft-agent-title': activeReading.title,
                    }}
                  />
                </div>
                {markdownWikiLinkCompletion && markdownWikiLinkSuggestions.length > 0 && (
                  <div
                    role="listbox"
                    aria-label="Wiki link suggestions"
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      position: 'absolute',
                      top: `${markdownWikiLinkCompletion.top}px`,
                      left: `${markdownWikiLinkCompletion.left}px`,
                      width: '260px',
                      maxHeight: '176px',
                      overflowY: 'auto',
                      zIndex: 4,
                      padding: '4px',
                      borderRadius: '6px',
                      backgroundColor: theme.isDark ? 'rgba(22,22,22,0.96)' : 'rgba(255,255,255,0.96)',
                      border: `1px solid ${theme.border}`,
                      boxShadow: theme.isDark ? '0 8px 24px rgba(0,0,0,0.28)' : '0 8px 24px rgba(0,0,0,0.12)',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    {markdownWikiLinkSuggestions.map((suggestion, index) => {
                      const selected = index === markdownWikiLinkSuggestionIndex;
                      return (
                        <button
                          key={`${suggestion.kind}:${suggestion.detail}:${suggestion.title}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseEnter={() => setMarkdownWikiLinkSuggestionIndex(index)}
                          onClick={() => applyMarkdownWikiLinkSuggestion(suggestion, markdownWikiLinkCompletion)}
                          style={{
                            display: 'block',
                            width: '100%',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '6px 7px',
                            textAlign: 'left',
                            backgroundColor: selected
                              ? (theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)')
                              : 'transparent',
                            color: theme.text,
                            cursor: 'pointer',
                            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '12px',
                              lineHeight: '16px',
                            }}
                          >
                            {suggestion.title}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '10px',
                              lineHeight: '13px',
                              color: theme.textSecondary,
                            }}
                          >
                            {suggestion.kind} - {suggestion.detail}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {markdownUrlPasteChoice && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      bottom: '8px',
                      zIndex: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      padding: '3px',
                      borderRadius: '6px',
                      backgroundColor: theme.isDark ? 'rgba(22,22,22,0.86)' : 'rgba(255,255,255,0.88)',
                      border: `1px solid ${theme.border}`,
                      boxShadow: theme.isDark ? '0 4px 14px rgba(0,0,0,0.22)' : '0 4px 14px rgba(0,0,0,0.08)',
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    {MARKDOWN_URL_PASTE_OPTIONS.map((option) => {
                      const selected = markdownUrlPasteChoice.kind === option.kind;
                      return (
                        <button
                          key={option.kind}
                          type="button"
                          onClick={() => applyMarkdownUrlPasteKind(option.kind)}
                          title={option.title}
                          aria-label={option.title}
                          style={{
                            height: '22px',
                            minWidth: '42px',
                            padding: '0 7px',
                            border: 'none',
                            borderRadius: '4px',
                            color: selected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                            backgroundColor: selected
                              ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                              : 'transparent',
                            cursor: 'pointer',
                            fontSize: '11px',
                            lineHeight: 1,
                            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                          }}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* View mode - markdown renderer */
              <>
            {/* Field Theory icon - only in immersive mode */}
            {isFullScreen && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                <img
                  src={theme.isDark ? 'fieldtheory-icon.png' : 'field-theory-icon-black.png'}
                  alt="Field Theory"
                  style={{ height: '32px', width: 'auto', opacity: 0.6 }}
                />
              </div>
            )}
            {/* Divider - only in immersive mode */}
            {isFullScreen && (
              <hr style={{ border: 'none', height: '1px', backgroundColor: theme.border, margin: '0 0 20px 0' }} />
            )}
            {/* Metadata tags — small pill badges above content. Task state stays in the sidebar filename row. */}
            {markdownDisplay && (markdownDisplay.meta.tags || markdownDisplay.meta.source_type) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                {(markdownDisplay.meta.tags ?? '')
                  .replace(/^\[|\]$/g, '')
                  .split(',')
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean)
                  .map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                        color: theme.textSecondary,
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                {markdownDisplay.meta.source_type && (
                  <span style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '8px',
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    color: theme.textSecondary,
                    fontFamily: 'system-ui, sans-serif',
                    opacity: 0.7,
                  }}>
                    {markdownDisplay.meta.source_type}
                  </span>
                )}
              </div>
            )}
            {/* Content - markdown renders the title. Click gesture opens source. */}
            <div
              ref={renderedContentRef}
              className="librarian-content"
              onMouseDown={() => {
                deactivateSidebarKeyboard();
              }}
              onMouseUp={() => {
                if (RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED) requestAnimationFrame(updateRenderedSelectionToolbar);
              }}
              onDoubleClick={() => {
                if (RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED) requestAnimationFrame(updateRenderedSelectionToolbar);
              }}
              onClick={(e) => {
                if (!activeReading) return;
                const behavior = getRenderedMarkdownClickBehavior(e, renderedEditClickMode);
                if (!behavior) return;
                const caret = getRenderedTextCaretFromPoint(e);
                const selectionStart = caret
                  ? resolveMarkdownCaretOffsetFromRenderedText(activeReading.content, caret.text, caret.offset)
                  : activeReading.content.length;
                if (selectionStart === null) return;
                enterEditMode(selectionStart);
              }}
              onCopy={flashCopyPathCopied}
              style={{
                ...documentTextStyle,
                position: 'relative',
                outline: 'none',
                userSelect: 'text',
                cursor: activeReading ? 'text' : 'default',
              }}
            >
              <FieldTheoryProse
                className={todoMarker === 'square' ? 'ft-prose-todo-square' : undefined}
                color={documentTextStyle.color}
                fontFamily={typographyPreset.fontFamily}
                fontSize={textSizes[textSize].base}
                h1Size={textSizes[textSize].h1}
                h2Size={textSizes[textSize].h2}
                h3Size={textSizes[textSize].h3}
                headingFontFamily={typographyPreset.headingFontFamily}
                lineHeight={documentTextStyle.lineHeight}
                linkColor={theme.accent}
                mutedColor={theme.textSecondary}
                paragraphSpacing={documentParagraphSpacing}
                remarkLineBreaks
                surface={theme.isDark ? 'dark' : 'light'}
                components={{
                  p: ({ children, node }) => {
                    const textContent = extractMarkdownText(node);
                    const normalizedText = textContent.trim();
                    const hasBraille = /[\u2800-\u28FF]/.test(textContent);
                    const isModelSignatureLine = isArtifactModelSignatureText(normalizedText);
                    const isPreservedBlankLine = textContent === PRESERVED_BLANK_MARKDOWN_LINE;

                    if (hasBraille) {
                      return (
                        <p
                          style={{
                            marginBottom: '16px',
                            marginTop: '8px',
                            textAlign: 'center',
                            fontFamily: fonts.mono,
                            fontSize: '14px',
                            lineHeight: 1.15,
                            whiteSpace: 'pre',
                            letterSpacing: 0,
                          }}
                        >
                          {children}
                        </p>
                      );
                    }

                    if (isModelSignatureLine) {
                      return null;
                    }

                    if (isPreservedBlankLine) {
                      return (
                        <p
                          aria-hidden="true"
                          style={{
                            margin: 0,
                            height: '0.3em',
                            lineHeight: 0.3,
                            overflow: 'hidden',
                          }}
                        >
                          {children}
                        </p>
                      );
                    }

                    return (
                      <p>{children}</p>
                    );
                  },
                  input: ({ node: _node, type, checked, ...props }) => {
                    if (type !== 'checkbox') {
                      return <input type={type} {...props} />;
                    }

                    const taskLine = sourceTaskLines[renderedTaskInputIndex];
                    renderedTaskInputIndex += 1;
                    const isChecked = taskLine?.checked ?? Boolean(checked);
                    return (
                      <input
                        {...props}
                        className="ft-rendered-task-checkbox"
                        type="checkbox"
                        checked={isChecked}
                        disabled={false}
                        readOnly={!taskLine}
                        onChange={(event) => {
                          event.stopPropagation();
                          if (taskLine) toggleRenderedTask(taskLine.lineIndex, event.currentTarget.checked);
                        }}
                        onClick={(event) => event.stopPropagation()}
                        style={{
                          ...props.style,
                          cursor: taskLine ? 'pointer' : 'default',
                          margin: 0,
                        }}
                      />
                    );
                  },
                  li: ({ children, node }) => {
                    const textContent = extractMarkdownText(node).trim();
                    const isCarrotListItem = textContent.startsWith(CARROT_LIST_SENTINEL);
                    const isTaskListItem = isRenderedTaskListItem(node);
                    if (isTaskListItem) {
                      const taskLine = sourceTaskLines[renderedTaskListItemIndex];
                      renderedTaskListItemIndex += 1;
                      const checked = taskLine?.checked ?? false;
                      const taskText = taskLine?.text ?? textContent;
                      const animateCompletion = checked && animatingTaskTexts.has(taskText);
                      const { checkbox, content } = splitTaskListItemChildren(children);
                      return (
                        <li
                          className={[
                            'ft-rendered-task-list-item',
                            checked ? 'ft-rendered-task-list-item-done' : 'ft-rendered-task-list-item-open',
                            animateCompletion ? 'ft-rendered-task-completed-live' : null,
                          ].filter(Boolean).join(' ')}
                          style={{
                            margin: 'calc(var(--ft-prose-list-item-spacing) * 0.55) 0',
                            listStyle: 'none',
                            display: 'grid',
                            gridTemplateColumns: '0.95em minmax(0, 1fr)',
                            columnGap: '0.6em',
                            alignItems: 'baseline',
                          }}
                        >
                          <span
                            onClick={(event) => {
                              event.stopPropagation();
                              if (taskLine) toggleRenderedTask(taskLine.lineIndex, !checked);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              height: '1lh',
                              cursor: taskLine ? 'pointer' : 'default',
                            }}
                          >
                            {checkbox}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            {content}
                          </span>
                        </li>
                      );
                    }

                    if (isCarrotListItem) {
                      return (
                        <li
                          style={{
                            marginBottom: '2px',
                            listStyle: 'none',
                            display: 'grid',
                            gridTemplateColumns: 'auto minmax(0, 1fr)',
                            columnGap: '8px',
                            alignItems: 'baseline',
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              color: theme.text,
                              fontWeight: 700,
                              lineHeight: 'inherit',
                            }}
                          >
                            {CARROT_LIST_MARKER}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            {stripLeadingCarrotListSentinel(children)}
                          </div>
                        </li>
                      );
                    }

                    return (
                      <li
                        style={{
                          marginBottom: '0.25em',
                        }}
                      >
                        {children}
                      </li>
                    );
                  },
                  a: ({ href, children }) => {
                    const unresolved = isUnresolvedWikiHref(href);
                    return (
                      <a
                        href={href}
                        style={{
                          color: unresolved ? '#ef4444' : theme.accent,
                          textDecoration: 'underline',
                          textDecorationColor: unresolved ? '#ef4444' : `${theme.accent}66`,
                          textUnderlineOffset: '2px',
                          cursor: 'pointer',
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Markdown like `[categories/tool]()` renders an
                          // <a> with an empty href — fall back to the link
                          // text so these still resolve through the index.
                          const effectiveHref = href && href.trim()
                            ? href
                            : (e.currentTarget.textContent?.trim() ?? '');
                          const action = classifyLinkHref(effectiveHref, wikiIndex);
                          openLinkAction(action);
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {displayContent}
              </FieldTheoryProse>
              {linkedDocuments.length > 0 && (
                <section
                  aria-label="Linked"
                  style={{
                    marginTop: '32px',
                    paddingTop: '16px',
                    borderTop: `1px solid ${theme.border}`,
                  }}
                >
                  <div
                    style={{
                      marginBottom: '8px',
                      fontSize: '12px',
                      fontWeight: 650,
                      color: theme.textSecondary,
                      letterSpacing: 0,
                    }}
                  >
                    Linked
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {linkedDocuments.map((link) => (
                      <button
                        key={getWikiLinkTargetKey(link.target)}
                        type="button"
                        title={WIKI_LINK_DIRECTION_LABEL[link.direction]}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openMarkdownLinkTarget(link.target);
                        }}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '18px minmax(0, 1fr)',
                          columnGap: '8px',
                          alignItems: 'start',
                          padding: '6px 0',
                          border: 'none',
                          backgroundColor: 'transparent',
                          color: theme.text,
                          cursor: 'pointer',
                          textAlign: 'left',
                          font: 'inherit',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            marginTop: '1px',
                            color: theme.textSecondary,
                            fontSize: '13px',
                            lineHeight: 1.2,
                            textAlign: 'center',
                          }}
                        >
                          {WIKI_LINK_DIRECTION_MARKER[link.direction]}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: '13px', fontWeight: 600 }}>
                            {link.title}
                            <span style={{ marginLeft: '6px', color: theme.textSecondary, fontSize: '11px', fontWeight: 500 }}>
                              {WIKI_LINK_TARGET_LABEL[link.target.kind]}
                            </span>
                          </span>
                          {link.excerpt && (
                            <span
                              style={{
                                display: 'block',
                                marginTop: '2px',
                                color: theme.textSecondary,
                                fontSize: '12px',
                                lineHeight: 1.35,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {link.excerpt}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
            {RENDERED_MARKDOWN_INLINE_FORMATTING_ENABLED && contentMode === 'rendered' && renderedSelectionToolbar && (
              <div
                role="toolbar"
                aria-label="Rendered markdown formatting"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                style={{
                  position: 'fixed',
                  top: `${renderedSelectionToolbar.top}px`,
                  left: `${renderedSelectionToolbar.left}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 30,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  padding: '4px',
                  borderRadius: '6px',
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.isDark ? 'rgba(24,24,24,0.96)' : 'rgba(255,255,255,0.98)',
                  boxShadow: theme.isDark ? '0 10px 24px rgba(0,0,0,0.32)' : '0 10px 24px rgba(0,0,0,0.14)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                {([
                  ['bold', 'B', 'Bold'],
                  ['italic', 'I', 'Italic'],
                  ['code', '`', 'Inline code'],
                  ['link', '[]', 'Link'],
                  ['unordered-list', '-', 'Unordered list'],
                ] as Array<[RenderedMarkdownFormatAction, string, string]>).map(([action, label, title]) => (
                  <button
                    key={action}
                    type="button"
                    title={title}
                    aria-label={title}
                    onClick={() => applyRenderedSelectionFormat(action)}
                    style={{
                      width: '24px',
                      height: '22px',
                      padding: 0,
                      border: 'none',
                      borderRadius: '4px',
                      backgroundColor: 'transparent',
                      color: theme.text,
                      cursor: 'pointer',
                      fontSize: action === 'bold' ? '12px' : '11px',
                      fontWeight: action === 'bold' ? 700 : action === 'italic' ? 600 : 500,
                      fontStyle: action === 'italic' ? 'italic' : 'normal',
                      fontFamily: action === 'code' ? fonts.mono : 'system-ui, sans-serif',
                      lineHeight: 1,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* Footer - only in immersive mode */}
            {isFullScreen && (
              <>
                <hr style={{ border: 'none', height: '1px', backgroundColor: theme.border, margin: '32px 0 24px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    paddingBottom: '24px',
                  }}
                >
                  <div style={{ color: theme.textSecondary }}>
                    <div style={{ fontSize: '13px' }}>Artifact made by the Librarian</div>
                    <div style={{ fontSize: '12px', marginTop: '2px', fontStyle: 'italic' }}>
                      Inspired by <span title={shareStatus?.slug || ''} style={{ cursor: shareStatus?.slug ? 'help' : 'default' }}>your work</span>
                    </div>
                    {selectedReading?.modelSignature && (
                      <div style={{ fontSize: '12px', marginTop: '6px' }}>
                        Signed by {selectedReading?.modelSignature}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                    {/* Mute button */}
                    <button
                      onClick={async () => {
                        setIsMuting(true);
                        try {
                          if (isMutedForToday) {
                            await window.librarianAPI?.unmute();
                            setIsMutedForToday(false);
                          } else {
                            await window.librarianAPI?.muteForToday();
                            setIsMutedForToday(true);
                          }
                        } finally {
                          setIsMuting(false);
                        }
                      }}
                      disabled={isMuting}
                      title={isMutedForToday ? 'Muted until tomorrow - click to unmute' : 'Mute for today'}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: isMutedForToday ? '#f59e0b' : theme.textSecondary,
                        backgroundColor: isMutedForToday
                          ? (theme.isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.08)')
                          : 'transparent',
                        border: `1px solid ${isMutedForToday ? 'rgba(245, 158, 11, 0.4)' : theme.border}`,
                        borderRadius: '5px',
                        cursor: isMuting ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isMutedForToday ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M1.414 1.414a.5.5 0 0 1 .707 0l12.728 12.728a.5.5 0 0 1-.707.707L11.34 12.05A3.994 3.994 0 0 1 8 14a3.994 3.994 0 0 1-3.34-1.95l-.47-.47-.293-.293L1.414 8.804A3.962 3.962 0 0 1 1 6.5c0-.932.32-1.79.854-2.467L1.414 3.594a.5.5 0 0 1 0-.707zM4 6.5c0-.553.132-1.074.366-1.535l7.17 7.17A2.989 2.989 0 0 1 8 13a2.99 2.99 0 0 1-2.536-1.406.5.5 0 0 0-.428-.229H4.5A.5.5 0 0 1 4 10.865V6.5z"/>
                          <path d="M8 2a4 4 0 0 1 4 4v2.335c0 .38.1.745.287 1.065l.603.905-8.535-8.536A3.988 3.988 0 0 1 8 2zm3.5 8.865V6.5a3.5 3.5 0 0 0-7-0v1.865l7 0z"/>
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 16a2 2 0 0 0 2-2H6a2 2 0 0 0 2 2zM8 1.918l-.797.161A4.002 4.002 0 0 0 4 6c0 .628-.134 2.197-.459 3.742-.16.767-.376 1.566-.663 2.258h10.244c-.287-.692-.502-1.49-.663-2.258C12.134 8.197 12 6.628 12 6a4.002 4.002 0 0 0-3.203-3.92L8 1.917zM14.22 12c.223.447.481.801.78 1H1c.299-.199.557-.553.78-1C2.68 10.2 3 6.88 3 6c0-2.42 1.72-4.44 4.005-4.901a1 1 0 1 1 1.99 0A5.002 5.002 0 0 1 13 6c0 .88.32 4.2 1.22 6z"/>
                        </svg>
                      )}
                    </button>
                    {/* Share button */}
                    <button
                      onClick={async () => {
                        if (shareStatus?.shared) {
                          // Already shared - unshare
                          await handleShare();
                        } else {
                          // Share and copy link
                          setIsSharing(true);
                          try {
                            const result = await Promise.race([
                              window.librarianAPI?.shareReading(selectedPath!),
                              new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
                            ]);
                            if (result) {
                              setShareStatus({ shared: true, slug: result.slug, url: result.url });
                              // Copy link to clipboard
                              await navigator.clipboard.writeText(result.url);
                              setLinkCopied(true);
                              setTimeout(() => setLinkCopied(false), 2000);
                            } else {
                              console.warn('[Librarian] Share failed or timed out');
                            }
                          } catch (err) {
                            console.error('[Librarian] Share error:', err);
                          } finally {
                            setIsSharing(false);
                          }
                        }
                      }}
                      disabled={isSharing}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: shareStatus?.shared ? '#22c55e' : theme.textSecondary,
                        backgroundColor: shareStatus?.shared
                          ? (theme.isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)')
                          : 'transparent',
                        border: `1px solid ${shareStatus?.shared ? 'rgba(34, 197, 94, 0.4)' : theme.border}`,
                        borderRadius: '5px',
                        cursor: isSharing ? 'wait' : 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
                        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
                      </svg>
                      {isSharing ? '...' : shareStatus?.shared ? 'Shareable' : 'Not shared'}
                    </button>
                    <span style={{ fontSize: '9px', color: '#22c55e', marginTop: '-3px', height: '12px', visibility: linkCopied ? 'visible' : 'hidden' }}>Copied!</span>
                  </div>
                </div>
              </>
            )}
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.textSecondary,
            }}
          >
            Select a page
          </div>
        )}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '30px',
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, ${theme.bg} 0%, ${theme.bg} 28%, transparent 100%)`,
            backdropFilter: topFadeActive ? 'blur(3px)' : 'none',
            WebkitBackdropFilter: topFadeActive ? 'blur(3px)' : 'none',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 45%, transparent 100%)',
            maskImage: 'linear-gradient(to bottom, black 0%, black 45%, transparent 100%)',
            opacity: topFadeActive ? 0.72 : 0,
            zIndex: 3,
            transition: 'opacity 0.12s ease, backdrop-filter 0.12s ease',
          }}
        />
        </div>
        </Fragment>
        )}
      </div>

      {shortcutsHelpOpen && (
        <div
          role="dialog"
          aria-label="Keyboard shortcuts"
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            right: '18px',
            bottom: '18px',
            width: 'min(360px, calc(100% - 36px))',
            maxHeight: 'min(520px, calc(100% - 36px))',
            overflowY: 'auto',
            padding: '10px',
            borderRadius: '6px',
            color: theme.text,
            backgroundColor: theme.isDark ? 'rgba(24,24,24,0.96)' : 'rgba(255,255,255,0.97)',
            border: `1px solid ${theme.border}`,
            boxShadow: theme.isDark ? '0 18px 50px rgba(0,0,0,0.42)' : '0 18px 50px rgba(0,0,0,0.16)',
            zIndex: 30,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600 }}>Keyboard shortcuts</div>
            <button
              type="button"
              onClick={() => setShortcutsHelpOpen(false)}
              aria-label="Close keyboard shortcuts"
              style={{
                width: '22px',
                height: '22px',
                border: 'none',
                borderRadius: '4px',
                color: theme.textSecondary,
                backgroundColor: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
              onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: '14px', rowGap: '6px' }}>
            {LIBRARIAN_KEYBOARD_SHORTCUTS.map((shortcut) => (
              <Fragment key={`${shortcut.keys}-${shortcut.label}`}>
                <kbd
                  style={{
                    fontSize: '11px',
                    fontFamily: fonts.mono,
                    color: theme.textSecondary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {shortcut.keys}
                </kbd>
                <span style={{ fontSize: '12px', color: theme.text, minWidth: 0 }}>
                  {shortcut.label}
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      )}

      {copyPathCopied && (
        <div
          role="status"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '14px',
            transform: 'translateX(-50%)',
            padding: '4px 8px',
            borderRadius: '5px',
            fontSize: '11px',
            color: theme.isDark ? '#d1fae5' : '#065f46',
            backgroundColor: theme.isDark ? 'rgba(6, 95, 70, 0.7)' : 'rgba(209, 250, 229, 0.95)',
            border: `1px solid ${theme.isDark ? 'rgba(110, 231, 183, 0.28)' : 'rgba(5, 150, 105, 0.2)'}`,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        >
          Copied path
        </div>
      )}

      {deleteConfirmationDialog}

      <AgentKickoffModal
        isOpen={agentKickoffOpen}
        onClose={() => setAgentKickoffOpen(false)}
        filePath={activeReading?.path ?? null}
        fileTitle={activeReading?.title ?? null}
      />
    </div>
  );
}

export default memo(LibrarianView);
