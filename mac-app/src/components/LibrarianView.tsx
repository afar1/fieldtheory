// =============================================================================
// LibrarianView - reading and writing experience for collected readings.
// Named after the AI assistant in Snow Crash that provides contextual intel.
// =============================================================================

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, Fragment, memo, lazy, Suspense } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import { fonts } from '../design/tokens';
import ContentToolbar, { ContentToolbarFolderButton, ContentToolbarMaxwellButton } from './ContentToolbar';
import ContentModeToggleButton from './ContentModeToggleButton';
import ImmersiveToggle, { FOCUS_TOOLBAR_BUTTON_WIDTH } from './ImmersiveToggle';
import AgentKickoffModal from './AgentKickoffModal';
import CodexTerminalPanel, { type CodexTerminalDockSide } from './CodexTerminalPanel';
import LibrarianSetupWizard from './LibrarianSetupWizard';
import { SidebarRiverIcon } from './SidebarIcons';
import { useCollapsedSidebarHoverReveal } from '../hooks/useCollapsedSidebarHoverReveal';
import { formatRelativeTime } from '../utils/formatUtils';
import WikiSidebar, {
  BOOKMARKS_ITEM_ID,
  EMBER_ITEM_ID,
  dispatchLocalWikiAdded,
  dispatchLocalWikiDeleted,
  dispatchLocalWikiRenamed,
  type WikiArchiveController,
  type LibraryCreateLocation,
  type UnifiedItem,
  type WikiCreationController,
} from './WikiSidebar';
import BookmarksPane from './BookmarksPane';
import EmberPane from './EmberPane';
import { prefetchBookmarks } from '../services/bookmarksCache';
import { FEATURE_NARRATION_ENABLED, FEATURE_TYPEDOWN_ENABLED } from '../featureFlags';
import {
  LIBRARIAN_KEYBOARD_SHORTCUTS,
  LINE_NUMBERS_STORAGE_KEY,
  RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT,
  RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT,
  TEXT_CURSOR_BLINK_CHANGED_EVENT,
  type RenderedTextCursorStyle,
  isFadedLineNumbersShortcut,
  getMarkdownFormattingShortcut,
  getMarkdownListShortcutKind,
  isCommandDeleteShortcut,
  isCommandFindShortcut,
  isImmersiveToggleShortcut,
  isKeyboardShortcutsHelpShortcut,
  isLineNumbersToggleShortcut,
  isMarkdownModeToggleShortcut,
  isMarkdownTaskShortcut,
  isMarkdownTaskToggleShortcut,
  isSearchFocusShortcut,
  isSharedFileToggleShortcut,
  restoreRenderedBlockCursorOpacity,
  restoreSharedFileToggleHotkey,
  restoreRenderedTextCursorStyle,
  restoreTextCursorBlink,
} from '../utils/editorShortcuts';
import {
  RENDERED_EDITOR_DEBUG_ENTRY_LIMIT,
  RENDERED_EDITOR_DEBUG_STORAGE_KEY,
  getElementDebugSummary,
  getRectDebugSummary,
  getRenderedSelectionDebug,
  type RenderedEditorDebugApi,
  type RenderedEditorDebugEntry,
  type RenderedEditorTimingEntry,
} from '../utils/renderedMarkdownEditor';
import {
  getMarkdownTodoState,
  parseMarkdownEditActor,
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
  resolveLibrarianDocumentMaxWidth,
  resolveLibrarianLineHeight,
  resolveLibrarianParagraphSpacing,
  restoreLibrarianLineHeight,
  restoreLibrarianTypographyPreset,
  type LibrarianLineHeightId,
  type LibrarianTextSizeId,
  type LibrarianTypographyPresetId,
} from '../utils/librarianTypography';
import { getMarkdownFormattingEdit } from '../utils/markdownFormatting';
import {
  MARKDOWN_URL_PASTE_OPTIONS,
  getMarkdownUrlPasteEdit,
  getMarkdownUrlPasteReplacement,
  type MarkdownUrlPasteEdit,
  type MarkdownUrlPasteKind,
} from '../utils/markdownUrlPaste';
import { getMarkdownTaskShortcutEdit, getMarkdownTaskToggleEdit } from '../utils/markdownTasks';
import { getMarkdownDrawCommandEdit, insertMarkdownBlockAt } from '../utils/markdownSlashCommands';
import { getDocumentSaveVersion, isDocumentSaveConflict, isDocumentSaveOk } from '../utils/documentSaveConflicts';
import { formatLocalImageMarkdown, formatPastedLocalImageMarkdown } from '../utils/clipboardMarkdown';
import { getHtmlPreviewSrcDoc as buildHtmlPreviewSrcDoc, getLocalFileUrl as buildLocalFileUrl } from '../utils/htmlPreview';
import MarkdownCodeEditor, {
  RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
  RENDERED_MARKDOWN_EDITOR_TIMING_EVENT,
  getRenderedMarkdownBlockBodyStartForLine,
  getRenderedMarkdownInlineHtmlBlockRanges,
  isRenderedMarkdownSelectionInsideInlineHtmlBlock,
  isRenderedMarkdownDrawingAlt,
  type MarkdownCodeEditorImagePreview,
  type MarkdownCodeEditorHandle,
  type MarkdownCodeEditorSelectionSnapshot,
} from './MarkdownCodeEditor';
import LinkedDocumentsSection from './LinkedDocumentsSection';
import ImagePreviewOverlay from './ImagePreviewOverlay';
import ScrollDiagnosticsHUD from './ScrollDiagnosticsHUD';
import { useScrollFpsSampler } from '../hooks/useScrollFpsSampler';
import { useInteractionFpsSampler } from '../hooks/useInteractionFpsSampler';
import '../utils/scrollDiagnostics.bootstrap';
import {
  coerceMarkdownContentMode,
  getNextMarkdownContentMode,
  isMarkdownContentMode,
  type MarkdownContentMode,
} from '../utils/markdownContentMode';
import {
  buildWikiIndex,
  getActiveMarkdownWikiLinkCompletion,
  getMarkdownEditorLinkActionAtOffset,
  getMarkdownEditorLinkHits,
  getMarkdownLinkedDocuments,
  getMarkdownWikiLinkPasteText,
  getMarkdownWikiLinkAutoCloseEdit,
  getMarkdownWikiLinkCompletionCommitEdit,
  getMarkdownWikiLinkCompletionDeleteEdit,
  getMarkdownWikiLinkCompletionReplacement,
  normalizeWikiRelPath,
  transformWikiLinks,
  upsertMarkdownLinkRelationDocument,
  type WikiIndex,
  type LinkAction,
  type MarkdownLinkedDocument,
  type MarkdownLinkRelationDocument,
  type MarkdownWikiLinkCompletion,
  type WikiIndexInput,
  type WikiLinkTarget,
} from '../utils/wikiLinks';

const SketchView = lazy(() => import('./SketchView'));

type FieldTheoryMarkdownTarget = {
  kind: 'wiki' | 'artifact' | 'command' | 'external' | 'bookmarks' | 'library' | 'commands' | 'clipboard';
  path: string;
  contentMode?: MarkdownContentMode;
  selectionStart?: number;
  selectionEnd?: number;
};

type InlineDrawInsertion = {
  mode: 'markdown' | 'rendered';
  documentPath: string;
  insertionStart: number;
  replaceFrom?: number;
  replaceTo?: number;
  backgroundImage?: {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
};

export type LibrarianSelectedItemType = 'wiki' | 'artifact' | 'bookmarks' | 'ember' | 'external' | null;
type CodexTerminalPageContextInput = Parameters<NonNullable<Window['codexTerminalAPI']>['attachPageContext']>[1];
type LibrarianCommandsAPI = NonNullable<Window['commandsAPI']>;
type MeetingToolbarSession = NonNullable<Awaited<ReturnType<NonNullable<LibrarianCommandsAPI['getActiveMeeting']>>>>;
const COPY_PATH_FEEDBACK_MS = 1600;
const LOCAL_RIVER_CHANGED_EVENT = 'fieldtheory:river-changed-local';
const MEETING_TOOLBAR_ACTIVE_STATUSES = new Set(['starting', 'recording', 'transcribing', 'summarizing']);
const CODEX_TERMINAL_VISIBLE_STORAGE_KEY = 'fieldtheory.codexTerminal.visible';
const CODEX_TERMINAL_DOCK_STORAGE_KEY = 'fieldtheory.codexTerminal.dockSide';

function isMeetingToolbarActiveSession(session: MeetingToolbarSession | null | undefined): session is MeetingToolbarSession {
  return !!session && MEETING_TOOLBAR_ACTIVE_STATUSES.has(session.status);
}

export type LibraryDocumentViewKind = 'markdown' | 'html' | 'css';
type SharedFileType = 'document' | 'command' | 'plan';
interface SharedFileStatus {
  shared: boolean;
  sharedId?: string;
  revision?: number;
  cachePath?: string;
}
interface SharedFilePresenceUser {
  userId: string;
  email: string | null;
  initials: string;
}

export function getLibraryDocumentViewKind(
  filePath: string | null | undefined,
  itemType: LibrarianSelectedItemType = null,
): LibraryDocumentViewKind {
  const extension = filePath?.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase() ?? '';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'css') return 'css';
  if (itemType === 'wiki' || itemType === 'artifact' || itemType === 'external') return 'markdown';
  return 'markdown';
}

export function getLibraryDocumentDefaultContentMode(kind: LibraryDocumentViewKind): MarkdownContentMode {
  return kind === 'css' ? 'markdown' : 'rendered';
}

export function getLocalFileUrl(filePath: string): string {
  return buildLocalFileUrl(filePath);
}

function getEditActorDisplay(actor: MarkdownEditActor | undefined): string | null {
  const name = actor?.name.trim();
  if (!name) return null;
  const detail = actor?.detail?.trim();
  return detail ? `${name} (${detail})` : name;
}

export function getReadingUpdatedByline(reading: Pick<Reading, 'mtime' | 'sharedAuthorCallsign' | 'editActor'>): string {
  const updated = `Updated ${formatRelativeTime(reading.mtime)}`;
  const editActor = getEditActorDisplay(reading.editActor);
  if (editActor) return `${updated} by ${editActor}`;
  const callsign = reading.sharedAuthorCallsign?.trim();
  return callsign ? `${updated} by ${callsign}` : updated;
}

export function getReadingUpdatedTitle(reading: Pick<Reading, 'mtime' | 'sharedAuthorCallsign' | 'editActor'>): string {
  const updated = `Updated ${new Date(reading.mtime).toLocaleString()}`;
  const editActor = getEditActorDisplay(reading.editActor);
  if (editActor) return `${updated} by ${editActor}`;
  const callsign = reading.sharedAuthorCallsign?.trim();
  return callsign ? `${updated} by ${callsign}` : updated;
}

export function getHtmlPreviewSrcDoc(html: string, filePath: string): string {
  return buildHtmlPreviewSrcDoc(html, filePath);
}

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
    sharedOriginalSourcePath: page.sharedOriginalSourcePath,
    sharedAuthorCallsign: page.sharedAuthorCallsign,
    editActor: page.editActor,
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
    editActor: parseMarkdownEditActor(file.content) ?? undefined,
    documentVersion: file.documentVersion,
  };
}

function inferSharedFileTypeForActiveReading(filePath: string | null): SharedFileType {
  const normalized = (filePath ?? '').replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/commands/')) return 'command';
  if (normalized.includes('/plans/')) return 'plan';
  return 'document';
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

export function replaceMarkdownBodyPreservingFrontmatter(content: string, nextBody: string): string {
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.raw === null || !parsed.raw.trim()) return nextBody;
  return `---\n${parsed.raw}\n---\n\n${nextBody}`;
}

export function getMarkdownRenderedBodyStartLineIndex(content: string): number {
  if (!content.startsWith('---')) return 0;
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.raw === null) return 0;

  const lines = content.split(/\r?\n/);
  let bodyStartLineIndex = 0;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== '---') continue;
    bodyStartLineIndex = index + 1;
    break;
  }
  while (bodyStartLineIndex < lines.length && lines[bodyStartLineIndex] === '') {
    bodyStartLineIndex += 1;
  }
  return bodyStartLineIndex;
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

export function shouldApplyLiveMarkdownFileUpdate(input: {
  contentMode: MarkdownContentMode;
  editContent: string;
  lastSavedContent: string | null;
  hasPendingRenderedSave?: boolean;
  hasRenderedSaveInFlight?: boolean;
}): boolean {
  if (input.hasPendingRenderedSave) return false;
  if (input.hasRenderedSaveInFlight) return false;
  return input.lastSavedContent !== null && input.editContent === input.lastSavedContent;
}

export function getRenderedDisplayReadingContent(input: {
  contentMode: MarkdownContentMode;
  renderedEditingActive: boolean;
  activeReadingPath: string | null;
  renderedDisplayContent: { path: string; content: string } | null;
  activeReadingContent: string | null;
}): string | null {
  if (
    input.contentMode === 'rendered'
    && input.renderedEditingActive
    && input.activeReadingPath
    && input.renderedDisplayContent?.path === input.activeReadingPath
  ) {
    return input.renderedDisplayContent.content;
  }
  return input.activeReadingContent;
}

export function getVerifiedMarkdownSelectionReplacement(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  expectedText: string,
  replacementText: string,
): { nextValue: string; selectionStart: number; selectionEnd: number } | null {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  if (start === end || !expectedText || !replacementText) return null;
  const selectedText = value.slice(start, end);
  const selectedTrimmed = selectedText.trim();
  if (selectedText !== expectedText && selectedTrimmed !== expectedText.trim()) return null;
  const leading = selectedText.match(/^\s*/)?.[0] ?? '';
  const trailing = selectedText.match(/\s*$/)?.[0] ?? '';
  const insertedText = selectedText === expectedText
    ? replacementText
    : `${leading}${replacementText}${trailing}`;
  return {
    nextValue: `${value.slice(0, start)}${insertedText}${value.slice(end)}`,
    selectionStart: start,
    selectionEnd: start + insertedText.length,
  };
}

export function getRenderedCaretEnsureSourceOffset(input: {
  activeSourceOffset: number | null;
  selectionRange: { start: number; end: number } | null;
  contentLength: number;
}): number {
  const contentLength = Math.max(0, input.contentLength);
  const clamp = (offset: number) => Math.max(0, Math.min(contentLength, offset));
  if (typeof input.activeSourceOffset === 'number' && Number.isFinite(input.activeSourceOffset)) {
    return clamp(input.activeSourceOffset);
  }
  if (
    input.selectionRange
    && input.selectionRange.start === input.selectionRange.end
    && Number.isFinite(input.selectionRange.start)
  ) {
    return clamp(input.selectionRange.start);
  }
  return contentLength;
}

export function documentVersionsEqual(left: DocumentVersion | null | undefined, right: DocumentVersion | null | undefined): boolean {
  return !!left && !!right && left.size === right.size && left.sha256 === right.sha256;
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
    && input.altKey
    && (input.selectedItemType === 'wiki' || input.selectedItemType === 'external');
}

export function isTerminalEditorFocusToggleShortcut(input: {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return input.key === 'Tab'
    && input.ctrlKey
    && !input.altKey
    && !input.metaKey
    && !input.shiftKey;
}

export function isTerminalPanelVisibilityToggleShortcut(input: {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return input.metaKey
    && !input.shiftKey
    && !input.altKey
    && !input.ctrlKey
    && (input.key === '.' || input.code === 'Period');
}

export function shouldRestoreEditorWhenTogglingTerminalPanel(input: {
  terminalVisible: boolean;
  terminalFocused: boolean;
  restoreEditorFocus?: boolean;
}): boolean {
  return input.terminalVisible && (input.restoreEditorFocus === true || input.terminalFocused);
}

export function shouldRestoreEditorWhenTogglingTerminalFocus(input: {
  terminalVisible: boolean;
  terminalFocused: boolean;
  restoreEditorFocus?: boolean;
}): boolean {
  return input.terminalVisible && (input.restoreEditorFocus === true || input.terminalFocused);
}

export function isCodexTerminalEventTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('[data-ft-codex-terminal-panel="true"]');
}

const MARKDOWN_IMAGE_REFERENCE_RE = /!\[([^\]\n]*(?:\\.[^\]\n]*)*)\]\((<[^>\n]+>|[^)\s]+)\)/g;

export function getMarkdownImageReferenceSnapshot(content: string): string[] {
  return Array.from(content.matchAll(MARKDOWN_IMAGE_REFERENCE_RE), (match) => match[0]);
}

export function markdownContentMayNeedPortableImages(content: string): boolean {
  return getMarkdownImageReferenceSnapshot(content).length > 0;
}

export function markdownPortableImagesChanged(previousContent: string | null | undefined, nextContent: string): boolean {
  const nextImages = getMarkdownImageReferenceSnapshot(nextContent);
  if (nextImages.length === 0) return false;
  if (previousContent === null || previousContent === undefined) return true;
  const previousImages = getMarkdownImageReferenceSnapshot(previousContent);
  if (previousImages.length !== nextImages.length) return true;
  return nextImages.some((image, index) => image !== previousImages[index]);
}

export function shouldOpenMarkdownLinkFromMouseDown(input: {
  button: number;
  metaKey?: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  renderedEditingActive?: boolean;
  actionKind?: LinkAction['kind'];
}): boolean {
  if (input.button !== 0 || input.altKey || input.ctrlKey) return false;
  if (input.renderedEditingActive && (input.actionKind === 'wiki' || input.actionKind === 'create')) return true;
  if (input.renderedEditingActive) return input.metaKey === true;
  return true;
}

export function shouldOpenMarkdownEditorLinkFromMouseDown(input: {
  button: number;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return input.button === 0 && input.metaKey && !input.altKey && !input.ctrlKey;
}

export function isRenderedMarkdownLinkEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest(`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`) !== null;
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

export function getFocusChromeContentCenterX(input: {
  readerLeft: number;
  readerRight: number;
  terminalLeft: number | null;
  terminalDockedRight: boolean;
  terminalVisible: boolean;
}): number {
  const contentRight = input.terminalVisible && input.terminalDockedRight && input.terminalLeft !== null
    ? Math.max(input.readerLeft, Math.min(input.readerRight, input.terminalLeft))
    : input.readerRight;
  return Math.round(input.readerLeft + ((contentRight - input.readerLeft) / 2));
}

const RESPONSIVE_PANEL_MIN_EDITOR_WIDTH = 560;
const RESPONSIVE_PANEL_RIGHT_TERMINAL_MIN_WIDTH = 360;
const RESPONSIVE_PANEL_BOTTOM_TERMINAL_MIN_HEIGHT = 220;
const RESPONSIVE_PANEL_MIN_EDITOR_HEIGHT_WITH_BOTTOM_TERMINAL = 360;
const RESPONSIVE_PANEL_SIDEBAR_GAP = 4;
const RESPONSIVE_PANEL_RESTORE_BAND = 36;

export type ResponsivePanelState = {
  autoCollapseSidebar: boolean;
  autoDockTerminalBottom: boolean;
  autoHideTerminal: boolean;
  reason: 'unmeasured' | 'wide' | 'sidebar' | 'terminal-bottom' | 'terminal-hidden' | 'forced-sidebar';
};

export function getResponsivePanelState(input: {
  containerWidth: number;
  containerHeight: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarForcedVisible: boolean;
  terminalVisible: boolean;
  terminalDockSide: CodexTerminalDockSide;
  userResizing?: boolean;
  previous?: ResponsivePanelState;
}): ResponsivePanelState {
  if (input.userResizing && input.previous) {
    return input.previous;
  }

  if (input.containerWidth <= 0 || input.containerHeight <= 0) {
    return { autoCollapseSidebar: false, autoDockTerminalBottom: false, autoHideTerminal: false, reason: 'unmeasured' };
  }

  const sidebarThreshold = input.sidebarWidth
    + RESPONSIVE_PANEL_SIDEBAR_GAP
    + RESPONSIVE_PANEL_MIN_EDITOR_WIDTH
    + RESPONSIVE_PANEL_RIGHT_TERMINAL_MIN_WIDTH;
  const sidebarRestoreThreshold = sidebarThreshold + RESPONSIVE_PANEL_RESTORE_BAND;
  const autoCollapseSidebar = !input.sidebarCollapsed
    && !input.sidebarForcedVisible
    && (input.containerWidth < sidebarThreshold
      || (input.previous?.autoCollapseSidebar === true && input.containerWidth < sidebarRestoreThreshold));
  const effectiveSidebarCollapsed = input.sidebarCollapsed || autoCollapseSidebar;
  const readerWidth = input.containerWidth - (effectiveSidebarCollapsed ? 0 : input.sidebarWidth + RESPONSIVE_PANEL_SIDEBAR_GAP);
  const rightDockThreshold = RESPONSIVE_PANEL_MIN_EDITOR_WIDTH + RESPONSIVE_PANEL_RIGHT_TERMINAL_MIN_WIDTH;
  const rightDockRestoreThreshold = rightDockThreshold + RESPONSIVE_PANEL_RESTORE_BAND;
  const canUseBottomDock = input.containerHeight >= (
    RESPONSIVE_PANEL_MIN_EDITOR_HEIGHT_WITH_BOTTOM_TERMINAL + RESPONSIVE_PANEL_BOTTOM_TERMINAL_MIN_HEIGHT
  );
  const autoDockTerminalBottom = input.terminalVisible
    && input.terminalDockSide === 'right'
    && canUseBottomDock
    && (readerWidth < rightDockThreshold
      || (input.previous?.autoDockTerminalBottom === true && readerWidth < rightDockRestoreThreshold));
  const effectiveTerminalDockSide = autoDockTerminalBottom ? 'bottom' : input.terminalDockSide;
  const autoHideTerminal = input.terminalVisible
    && (
      readerWidth < RESPONSIVE_PANEL_MIN_EDITOR_WIDTH
      || (effectiveTerminalDockSide === 'bottom' && !canUseBottomDock)
    );

  const reason: ResponsivePanelState['reason'] =
    input.sidebarForcedVisible ? 'forced-sidebar' :
    autoHideTerminal ? 'terminal-hidden' :
    autoDockTerminalBottom ? 'terminal-bottom' :
    autoCollapseSidebar ? 'sidebar' :
    'wide';

  return { autoCollapseSidebar, autoDockTerminalBottom, autoHideTerminal, reason };
}

export function shouldAnimateResponsiveSidebar(input: {
  responsivePanelState: Pick<ResponsivePanelState, 'autoCollapseSidebar' | 'autoDockTerminalBottom' | 'autoHideTerminal'>;
  userResizing: boolean;
}): boolean {
  return !input.userResizing
    && !input.responsivePanelState.autoDockTerminalBottom
    && !input.responsivePanelState.autoHideTerminal;
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
const LIBRARIAN_DOCUMENT_TOOLBAR_ROW_HEIGHT_PX = 40;
const LIBRARIAN_MARKDOWN_CONTENT_TOP_PADDING_PX = 22;
const LIBRARIAN_RENDERED_CONTENT_TOP_PADDING_PX = 28;
const LIBRARIAN_FULLSCREEN_RENDERED_CONTENT_TOP_PADDING_PX = 16;
const LIBRARIAN_CONTENT_BOTTOM_SCROLL_SPACE_PX = 59.2;
const LIBRARIAN_READER_SCROLLBAR_GUTTER_PX = 14;
const ACTIVE_MARKDOWN_FILE_REFRESH_INTERVAL_MS = 750;
const RENDERED_SAVE_INITIAL_DELAY_MS = 400;
const RENDERED_SAVE_QUIET_DELAY_MS = 750;
const RENDERED_SAVE_IN_FLIGHT_RETRY_MS = 150;
const LIBRARIAN_AGENT_KICKOFF_ENABLED = false;
export const LIBRARIAN_UNORDERED_LIST_MARKER_STORAGE_KEY = 'librarian-unordered-list-marker';
export const LIBRARIAN_TODO_MARKER_STORAGE_KEY = 'librarian-todo-marker';
export const LIBRARIAN_MAXWELL_ITEMS_STORAGE_KEY = 'librarian-maxwell-items';
export const CARROT_LIST_MARKER = '›';
const CARROT_LIST_SENTINEL = '\u2060';

export type LibrarianUnorderedListMarker = 'dash' | 'carrot';
export type LibrarianTodoMarker = 'circle' | 'square';
export type LibrarianMaxwellItem = {
  id: string;
  type: 'wiki' | 'artifact' | 'external';
  title: string;
  path: string;
  relPath?: string;
};

type MaxwellToolbarSelection = { start: number; end: number } | null;
type MaxwellToolbarRunMode =
  | { mode: 'document' }
  | { mode: 'selection'; selection: { start: number; end: number } };

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

export function restoreLibrarianMaxwellItems(
  storage: Pick<Storage, 'getItem'>,
): LibrarianMaxwellItem[] {
  try {
    const raw = storage.getItem(LIBRARIAN_MAXWELL_ITEMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is LibrarianMaxwellItem => (
      item
      && (item.type === 'wiki' || item.type === 'artifact' || item.type === 'external')
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && typeof item.path === 'string'
      && (item.relPath === undefined || typeof item.relPath === 'string')
    ));
  } catch {
    return [];
  }
}

export function persistLibrarianMaxwellItems(
  storage: Pick<Storage, 'setItem'>,
  items: LibrarianMaxwellItem[],
): void {
  storage.setItem(LIBRARIAN_MAXWELL_ITEMS_STORAGE_KEY, JSON.stringify(items));
}

export function getMaxwellToolbarRunMode(selection: MaxwellToolbarSelection): MaxwellToolbarRunMode {
  if (!selection || selection.start === selection.end) {
    return { mode: 'document' };
  }
  return {
    mode: 'selection',
    selection: {
      start: Math.min(selection.start, selection.end),
      end: Math.max(selection.start, selection.end),
    },
  };
}

type MarkdownTextEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
  deletedMarkdownImages?: string[];
};

type ReplaceSelectedMarkdownTextRequest = {
  requestId: string;
  expectedText: string;
  replacementText: string;
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

function getMarkdownProtectedListMarkerEnd(line: string): number | null {
  const task = line.match(/^\s*(?:(?:[-*+]|\d+[.)]|›+)\s+)?\[(?: |x|X)\]\s+/);
  if (task) return task[0].length;

  const list = line.match(/^\s*(?:[-*+]|\d+[.)]|›+)\s+/);
  if (list) return list[0].length;

  return null;
}

function getMarkdownWordDeleteBackwardStart(value: string, floor: number, sourceStart: number): number {
  let index = sourceStart;
  const startedAfterWhitespace = /\s/.test(value[index - 1] ?? '');
  const shouldRemovePreviousSeparator = startedAfterWhitespace && !/\S/.test(value[sourceStart] ?? '');
  while (index > floor && /\s/.test(value[index - 1] ?? '')) index -= 1;
  while (index > floor && !/\s/.test(value[index - 1] ?? '')) index -= 1;
  if (shouldRemovePreviousSeparator) {
    while (index > floor && /\s/.test(value[index - 1] ?? '')) index -= 1;
  }
  return index;
}

export function getMarkdownWordDeleteBackwardPreservingListMarkerEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null {
  if (selectionStart !== selectionEnd) return null;

  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', selectionStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const markerEnd = getMarkdownProtectedListMarkerEnd(line);
  if (markerEnd === null) return null;

  const sourceFloor = lineStart + markerEnd;
  if (selectionStart <= sourceFloor) return null;

  const deleteStart = getMarkdownWordDeleteBackwardStart(value, sourceFloor, selectionStart);
  if (deleteStart >= selectionStart) return null;

  return {
    nextValue: `${value.slice(0, deleteStart)}${value.slice(selectionStart)}`,
    selectionStart: deleteStart,
    selectionEnd: deleteStart,
  };
}

function isNormalizedCarrotListLine(line: string): boolean {
  return line.trimStart().startsWith(`- ${CARROT_LIST_SENTINEL}`);
}

export function preserveMarkdownBlankLines(content: string): string {
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
      output.push('', PRESERVED_BLANK_MARKDOWN_LINE.repeat(Math.max(1, line.length)), '');
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

export function getRenderedMarkdownDisplayContent(body: string, wikiIndex: WikiIndex): string {
  const linked = transformWikiLinks(body, wikiIndex);
  return preserveMarkdownBlankLines(normalizeMarkdownCarrotLists(normalizeMarkdownTodoLines(linked)));
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
  const insertAt = (minimumOffsetInLine: number, insertion: string) => {
    const offset = Math.max(selectionStart, lineStart + minimumOffsetInLine);
    const nextValue = `${value.slice(0, offset)}${insertion}${value.slice(offset)}`;
    const nextSelection = offset + insertion.length;
    return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
  };

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
    return insertAt(line.length - bareTask[3].length, insertion);
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
    return insertAt(line.length - task[2].length, insertion);
  }

  const ordered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
  if (ordered) {
    if (ordered[4].trim().length === 0) {
      return {
        nextValue: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
        selectionStart: lineStart,
        selectionEnd: lineStart,
      };
    }
    const nextNumber = Number.parseInt(ordered[2], 10) + 1;
    const insertion = `\n${ordered[1]}${nextNumber}${ordered[3]} `;
    return insertAt(line.length - ordered[4].length, insertion);
  }

  const quote = line.match(/^(\s*)>\s?(.*)$/);
  if (quote) {
    if (quote[2].trim().length === 0) {
      return {
        nextValue: `${value.slice(0, lineStart)}${value.slice(lineEnd)}`,
        selectionStart: lineStart,
        selectionEnd: lineStart,
      };
    }
    const insertion = `\n${quote[1]}> `;
    return insertAt(line.length - quote[2].length, insertion);
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
  return insertAt(line.length - unordered[3].length, insertion);
}

function getEmptyMarkdownListLineRange(value: string, selectionStart: number, selectionEnd: number): { lineStart: number; lineEnd: number } | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', selectionStart);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const line = value.slice(lineStart, lineEnd);
  const marker = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+|[-*+]\s+\[(?: |x|X)\]\s*|\[(?: |x|X)?\]\s*)$/);
  if (!marker) return null;
  return { lineStart, lineEnd };
}

export function getEmptyMarkdownListMarkerDeleteEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null {
  const range = getEmptyMarkdownListLineRange(value, selectionStart, selectionEnd);
  if (!range) return null;
  return {
    nextValue: `${value.slice(0, range.lineStart)}${value.slice(range.lineEnd)}`,
    selectionStart: range.lineStart,
    selectionEnd: range.lineStart,
  };
}

export function getRenderedMarkdownPasteTextEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  pastedText: string,
): MarkdownTextEdit | null {
  const range = getEmptyMarkdownListLineRange(value, selectionStart, selectionEnd);
  if (!range) return null;
  const pastedTask = pastedText.trim().match(/^(?:[-*+]\s+)?\[(?: |x|X)?\]\s*(.+)$/);
  if (!pastedTask?.[1]?.trim()) return null;
  const line = value.slice(range.lineStart, range.lineEnd);
  if (!/^\s*(?:[-*+]\s+)?\[(?: |x|X)?\]\s*$/.test(line)) return null;
  const nextLine = `${line}${pastedTask[1].trim()}`;
  const nextSelection = range.lineStart + nextLine.length;
  return {
    nextValue: `${value.slice(0, range.lineStart)}${nextLine}${value.slice(range.lineEnd)}`,
    selectionStart: nextSelection,
    selectionEnd: nextSelection,
  };
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
  if (nonBlank.length === 0 && selectionStart === selectionEnd) {
    const line = lines[0] ?? '';
    const indent = line.match(/^\s*/)?.[0] ?? '';
    const marker = kind === 'ordered'
      ? '1. '
      : unorderedMarker === 'carrot' ? `${CARROT_LIST_MARKER} ` : '- ';
    const nextBlock = `${indent}${marker}`;
    const nextSelection = lineStart + nextBlock.length;
    return {
      nextValue: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
      selectionStart: nextSelection,
      selectionEnd: nextSelection,
    };
  }

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

export function getMarkdownListIndentEdit(
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
  let collapsedDelta = 0;
  let blockOffset = 0;
  const listLinePattern = /^(\s*)(?:[-*+]\s+(?:\[(?: |x|X)\]\s*)?|\d+[.)]\s+|\[(?: |x|X)?\]\s*|>\s?)/;

  const transformed = lines.map((line, index) => {
    const lineOffset = blockOffset;
    blockOffset += line.length + (index < lines.length - 1 ? 1 : 0);
    if (!listLinePattern.test(line)) return line;

    if (direction === 'in') {
      changed = true;
      if (!selectionIsBlock && selectionStart > lineStart + lineOffset) collapsedDelta = 2;
      return `  ${line}`;
    }

    const removableSpaces = line.match(/^ {1,2}/)?.[0].length ?? 0;
    if (removableSpaces === 0) return line;
    changed = true;
    if (!selectionIsBlock && selectionStart > lineStart + lineOffset) collapsedDelta = -Math.min(
      removableSpaces,
      Math.max(0, selectionStart - lineStart - lineOffset),
    );
    return line.slice(removableSpaces);
  });

  if (!changed) return null;
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

export function getRenderedMarkdownShortcutEdit(input: {
  event: KeyboardEvent;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  unorderedListMarker?: LibrarianUnorderedListMarker;
}): MarkdownTextEdit | null {
  const formattingKind = getMarkdownFormattingShortcut(input.event);
  if (formattingKind) {
    return getMarkdownFormattingEdit(
      input.value,
      input.selectionStart,
      input.selectionEnd,
      formattingKind,
    );
  }

  if (!input.event.metaKey || !input.event.shiftKey || input.event.altKey || input.event.ctrlKey) return null;
  if (isMarkdownTaskShortcut(input.event)) {
    return getMarkdownTaskShortcutEdit(input.value, input.selectionStart, input.selectionEnd);
  }

  const listShortcutKind = getMarkdownListShortcutKind(input.event);
  if (!listShortcutKind) return null;
  return getMarkdownListToggleEdit(
    input.value,
    input.selectionStart,
    input.selectionEnd,
    listShortcutKind,
    input.unorderedListMarker ?? 'dash',
  );
}

function getRenderedMarkdownHiddenInlineSuffixEnd(value: string, offset: number): number {
  const lineEndIndex = value.indexOf('\n', offset);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  let index = Math.max(0, Math.min(offset, lineEnd));
  const lineBefore = () => value.slice(lineStart, index);
  const hasOddTokenCount = (token: string) => lineBefore().split(token).length % 2 === 0;
  const hasUnclosedMarkdownLinkLabel = () => lineBefore().lastIndexOf('[') > lineBefore().lastIndexOf(']');
  const hasUnclosedUnderline = () => lineBefore().lastIndexOf('<u>') > lineBefore().lastIndexOf('</u>');
  const hasUnclosedWikiLink = () => lineBefore().lastIndexOf('[[') > lineBefore().lastIndexOf(']]');
  const hasUnclosedStandaloneAsterisk = () => (lineBefore().match(/(?<!\*)\*(?!\*)/g)?.length ?? 0) % 2 === 1;

  while (index < lineEnd) {
    const tail = value.slice(index, lineEnd);
    const linkClose = tail.match(/^\]\([^)\n]*\)/);
    if (linkClose && hasUnclosedMarkdownLinkLabel()) {
      index += linkClose[0].length;
      continue;
    }
    if (tail.startsWith('</u>') && hasUnclosedUnderline()) {
      index += '</u>'.length;
      continue;
    }
    if (tail.startsWith(']]') && hasUnclosedWikiLink()) {
      index += 2;
      continue;
    }
    if (tail.startsWith('**') && hasOddTokenCount('**')) {
      index += 2;
      continue;
    }
    if (tail.startsWith('~~') && hasOddTokenCount('~~')) {
      index += 2;
      continue;
    }
    if (tail.startsWith('*') && hasUnclosedStandaloneAsterisk()) {
      index += 1;
      continue;
    }
    if (tail.startsWith('`') && hasOddTokenCount('`')) {
      index += 1;
      continue;
    }
    break;
  }

  return index;
}

function getRenderedMarkdownHiddenInlinePrefixStart(value: string, offset: number): number {
  const lineEndIndex = value.indexOf('\n', offset);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const prefix = value.slice(lineStart, offset);
  const suffix = value.slice(offset, lineEnd);
  if (prefix.endsWith('**') && suffix.includes('**')) return offset - 2;
  if (prefix.endsWith('~~') && suffix.includes('~~')) return offset - 2;
  if (prefix.endsWith('<u>') && suffix.includes('</u>')) return offset - '<u>'.length;
  if (prefix.endsWith('[[') && suffix.includes(']]')) return offset - 2;
  if (prefix.endsWith('[') && /^[^\]\n]+\]\([^)\n]*\)/.test(suffix)) return offset - 1;
  if (prefix.endsWith('`') && suffix.includes('`')) return offset - 1;
  if (prefix.endsWith('*') && hasUnclosedStandaloneAsterisk(prefix) && /(?<!\*)\*(?!\*)/.test(suffix)) return offset - 1;
  return offset;
}

function getRenderedMarkdownLineStartEditOffset(value: string, offset: number): number | null {
  const caret = Math.max(0, Math.min(value.length, offset));
  const lineStart = caret === 0 ? 0 : value.lastIndexOf('\n', caret - 1) + 1;
  if (caret === lineStart) return lineStart;
  const lineEndIndex = value.indexOf('\n', caret);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const visibleStart = getRenderedMarkdownBlockBodyStartForLine(value, lineStart);
  if (visibleStart === null || caret !== visibleStart) return null;
  return value.slice(visibleStart, lineEnd).trim().length > 0 ? lineStart : null;
}

export function getRenderedMarkdownEnterEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStartOffset = getRenderedMarkdownLineStartEditOffset(value, selectionStart);
  const openingOffset = getRenderedMarkdownHiddenInlinePrefixStart(value, lineStartOffset ?? selectionStart);
  const insertionOffset = openingOffset === selectionStart
    ? getRenderedMarkdownHiddenInlineSuffixEnd(value, selectionStart)
    : openingOffset;
  const keepCaretOnInsertedBlankLine = lineStartOffset === insertionOffset || openingOffset !== selectionStart;
  const listEnterEdit = lineStartOffset === insertionOffset
    ? null
    : (getCarrotListEnterEdit(value, insertionOffset, insertionOffset)
      ?? getMarkdownListEnterEdit(value, insertionOffset, insertionOffset));
  return listEnterEdit
    ?? {
      nextValue: `${value.slice(0, insertionOffset)}\n${value.slice(insertionOffset)}`,
      selectionStart: keepCaretOnInsertedBlankLine ? insertionOffset : insertionOffset + 1,
      selectionEnd: keepCaretOnInsertedBlankLine ? insertionOffset : insertionOffset + 1,
    };
}

function linePrefixAt(value: string, offset: number): string {
  const lineStart = value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  return value.slice(lineStart, offset);
}

function lineSuffixAt(value: string, offset: number): string {
  const lineEndIndex = value.indexOf('\n', offset);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  return value.slice(offset, lineEnd);
}

function hasUnclosedStandaloneAsterisk(prefix: string): boolean {
  return (prefix.match(/(?<!\*)\*(?!\*)/g)?.length ?? 0) % 2 === 1;
}

function isRenderedMarkdownOpeningBoundary(value: string, offset: number): boolean {
  const prefix = linePrefixAt(value, offset);
  const suffix = lineSuffixAt(value, offset);
  if (/^\s*(?:[-*+]\s+|\d+[.)]\s+|[-*+]\s+\[(?: |x|X)\]\s*|\[(?: |x|X)?\]\s*)$/.test(prefix)) {
    return true;
  }
  if (prefix.endsWith('**') && suffix.includes('**')) return true;
  if (prefix.endsWith('~~') && suffix.includes('~~')) return true;
  if (prefix.endsWith('<u>') && suffix.includes('</u>')) return true;
  if (prefix.endsWith('[[') && suffix.includes(']]')) return true;
  if (prefix.endsWith('[') && /^[^\]\n]+\]\([^)\n]*\)/.test(suffix)) return true;
  if (prefix.endsWith('`') && suffix.includes('`')) return true;
  return prefix.endsWith('*') && hasUnclosedStandaloneAsterisk(prefix) && /(?<!\*)\*(?!\*)/.test(suffix);
}

export function shouldSuppressRenderedMarkdownBoundaryDelete(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
): boolean {
  if (selectionStart !== selectionEnd) return false;
  const offset = Math.max(0, Math.min(selectionStart, value.length));
  if (key === 'Backspace') return isRenderedMarkdownOpeningBoundary(value, offset);
  if (key === 'Delete') return getRenderedMarkdownHiddenInlineSuffixEnd(value, offset) > offset;
  return false;
}

function expandRenderedMarkdownImageDeleteRange(value: string, start: number, end: number): { start: number; end: number } {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', end);
  const lineEnd = lineEndIndex >= 0 ? lineEndIndex : value.length;
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);
  if (before.trim() !== '' || after.trim() !== '') return { start, end };
  if (lineEndIndex >= 0) return { start: lineStart, end: lineEnd + 1 };
  if (lineStart > 0) return { start: lineStart - 1, end: lineEnd };
  return { start: lineStart, end: lineEnd };
}

const RENDERED_MARKDOWN_IMAGE_RE = /!\[[^\]\n]*\]\((?:<[^>\n]+>|[^)\n]*)\)/g;

type RenderedMarkdownImageDeleteRange = {
  start: number;
  end: number;
  deletedMarkdownImages: string[];
};

type RenderedMarkdownAtomicDeleteRange = {
  start: number;
  end: number;
};

function expandRenderedMarkdownBlockDeleteRange(value: string, start: number, end: number): RenderedMarkdownAtomicDeleteRange {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndIndex = value.indexOf('\n', end);
  const lineEnd = lineEndIndex >= 0 ? lineEndIndex : value.length;
  const before = value.slice(lineStart, start);
  const after = value.slice(end, lineEnd);
  if (before.trim() !== '' || after.trim() !== '') return { start, end };
  if (lineEndIndex >= 0) {
    const afterLineBreak = lineEnd + 1;
    return { start: lineStart, end: value[afterLineBreak] === '\n' ? afterLineBreak + 1 : afterLineBreak };
  }
  if (lineStart > 0) return { start: lineStart - 1, end: lineEnd };
  return { start: lineStart, end: lineEnd };
}

function getRenderedMarkdownInlineHtmlDeleteRange(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: 'Backspace' | 'Delete',
): RenderedMarkdownAtomicDeleteRange | null {
  const blocks = getRenderedMarkdownInlineHtmlBlockRanges(value);
  if (selectionStart !== selectionEnd) {
    const touched = blocks.filter((block) => selectionStart < block.to && selectionEnd > block.from);
    if (!touched.length) return null;
    const start = Math.min(selectionStart, ...touched.map((block) => expandRenderedMarkdownBlockDeleteRange(value, block.from, block.to).start));
    const end = Math.max(selectionEnd, ...touched.map((block) => expandRenderedMarkdownBlockDeleteRange(value, block.from, block.to).end));
    return { start, end };
  }

  const block = blocks.find((candidate) => (
    key === 'Backspace'
      ? candidate.from < selectionStart && selectionStart <= candidate.to
      : candidate.from <= selectionStart && selectionStart < candidate.to
  ));
  return block ? expandRenderedMarkdownBlockDeleteRange(value, block.from, block.to) : null;
}

function getAdjacentRenderedMarkdownImageDeleteRange(
  value: string,
  offset: number,
  direction: 'backward' | 'forward',
): RenderedMarkdownImageDeleteRange | null {
  for (const match of value.matchAll(RENDERED_MARKDOWN_IMAGE_RE)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (
      (direction === 'backward' && start < offset && offset <= end)
      || (direction === 'forward' && start <= offset && offset < end)
    ) {
      return {
        ...expandRenderedMarkdownImageDeleteRange(value, start, end),
        deletedMarkdownImages: [match[0]],
      };
    }
  }
  return null;
}

function getSelectedRenderedMarkdownImageDeleteRange(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): RenderedMarkdownImageDeleteRange | null {
  let deleteStart = selectionStart;
  let deleteEnd = selectionEnd;
  const deletedMarkdownImages: string[] = [];
  for (const match of value.matchAll(RENDERED_MARKDOWN_IMAGE_RE)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (selectionStart < end && selectionEnd > start) {
      const range = expandRenderedMarkdownImageDeleteRange(value, start, end);
      deleteStart = Math.min(deleteStart, range.start);
      deleteEnd = Math.max(deleteEnd, range.end);
      deletedMarkdownImages.push(match[0]);
    }
  }
  return deletedMarkdownImages.length
    ? { start: deleteStart, end: deleteEnd, deletedMarkdownImages }
    : null;
}

export function getRenderedMarkdownDeleteShortcutEdit(input: {
  event: KeyboardEvent;
  value: string;
  selectionStart: number;
  selectionEnd: number;
}): MarkdownTextEdit | null {
  const key = input.event.key;
  if (key !== 'Backspace' && key !== 'Delete') return null;
  if (input.event.ctrlKey || input.event.altKey || input.event.shiftKey) return null;

  const selectionStart = Math.max(0, Math.min(input.selectionStart, input.value.length));
  const selectionEnd = Math.max(selectionStart, Math.min(input.selectionEnd, input.value.length));
  const inlineHtmlRange = getRenderedMarkdownInlineHtmlDeleteRange(input.value, selectionStart, selectionEnd, key);
  if (inlineHtmlRange) {
    return {
      nextValue: `${input.value.slice(0, inlineHtmlRange.start)}${input.value.slice(inlineHtmlRange.end)}`,
      selectionStart: inlineHtmlRange.start,
      selectionEnd: inlineHtmlRange.start,
    };
  }

  if (selectionStart !== selectionEnd) {
    const imageRange = getSelectedRenderedMarkdownImageDeleteRange(input.value, selectionStart, selectionEnd);
    if (imageRange) {
      return {
        nextValue: `${input.value.slice(0, imageRange.start)}${input.value.slice(imageRange.end)}`,
        selectionStart: imageRange.start,
        selectionEnd: imageRange.start,
        deletedMarkdownImages: imageRange.deletedMarkdownImages,
      };
    }
    return {
      nextValue: `${input.value.slice(0, selectionStart)}${input.value.slice(selectionEnd)}`,
      selectionStart,
      selectionEnd: selectionStart,
    };
  }

  const emptyMarkerEdit = getEmptyMarkdownListMarkerDeleteEdit(input.value, selectionStart, selectionEnd);
  if (emptyMarkerEdit) return emptyMarkerEdit;

  const imageRange = getAdjacentRenderedMarkdownImageDeleteRange(
    input.value,
    selectionStart,
    key === 'Backspace' ? 'backward' : 'forward',
  );
  if (imageRange) {
    return {
      nextValue: `${input.value.slice(0, imageRange.start)}${input.value.slice(imageRange.end)}`,
      selectionStart: imageRange.start,
      selectionEnd: imageRange.start,
      deletedMarkdownImages: imageRange.deletedMarkdownImages,
    };
  }

  if (!input.event.metaKey) return null;

  let deleteStart = selectionStart;
  let deleteEnd = selectionEnd;
  if (key === 'Backspace') {
    deleteStart = input.value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
    if (deleteStart === deleteEnd && deleteStart > 0) deleteStart -= 1;
  } else {
    const lineEnd = input.value.indexOf('\n', selectionEnd);
    deleteEnd = lineEnd >= 0 ? lineEnd : input.value.length;
    if (deleteStart === deleteEnd && deleteEnd < input.value.length) deleteEnd += 1;
  }
  if (deleteStart === deleteEnd) return null;
  return {
    nextValue: `${input.value.slice(0, deleteStart)}${input.value.slice(deleteEnd)}`,
    selectionStart: deleteStart,
    selectionEnd: deleteStart,
  };
}

export function shouldLetRenderedCodeMirrorHandleLineBoundaryDelete(input: {
  event: KeyboardEvent;
  selectionStart: number;
  selectionEnd: number;
}): boolean {
  const key = input.event.key;
  return (key === 'Backspace' || key === 'Delete')
    && input.event.metaKey
    && !input.event.ctrlKey
    && !input.event.altKey
    && !input.event.shiftKey
    && input.selectionStart === input.selectionEnd;
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
  const splitClosePrefix = value.slice(end).match(/^\s*\n\s*/)?.[0] ?? null;
  if (
    value.slice(start - open.length, start) === open
    && splitClosePrefix !== null
    && value.slice(end + splitClosePrefix.length, end + splitClosePrefix.length + close.length) === close
  ) {
    const nextStart = start - open.length;
    const nextEnd = end - open.length;
    const closeStart = end + splitClosePrefix.length;
    return {
      nextValue: `${value.slice(0, nextStart)}${selected}${value.slice(end, closeStart)}${value.slice(closeStart + close.length)}`,
      selectionStart: nextStart,
      selectionEnd: nextEnd,
    };
  }

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

export function getRenderedTaskLinesByRenderedLine(content: string): Map<number, MarkdownTaskLine> {
  const body = removeEmptyMarkdownCommentPlaceholders(splitFrontmatter(content).body);
  const bodyStartLineIndex = getMarkdownRenderedBodyStartLineIndex(content);
  const sourceTaskLinesByIndex = new Map(
    getMarkdownTaskLines(content).map((taskLine) => [taskLine.lineIndex, taskLine]),
  );
  const renderedLinesByRenderedLine = new Map<number, MarkdownTaskLine>();
  const normalizedLines = normalizeMarkdownCarrotLists(normalizeMarkdownTodoLines(body)).split('\n');
  let inFence = false;
  let renderedLineIndex = 0;

  normalizedLines.forEach((line, bodyLineIndex) => {
    const sourceLineIndex = bodyStartLineIndex + bodyLineIndex;
    const taskLine = sourceTaskLinesByIndex.get(sourceLineIndex);
    if (taskLine) renderedLinesByRenderedLine.set(renderedLineIndex + 1, taskLine);

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      renderedLineIndex += 1;
      return;
    }

    if (!inFence && line.trim() === '') {
      const keepsSingleRenderedLine = (
        isNormalizedCarrotListLine(normalizedLines[bodyLineIndex - 1] ?? '')
        || isNormalizedCarrotListLine(normalizedLines[bodyLineIndex + 1] ?? '')
      );
      if (keepsSingleRenderedLine) {
        renderedLineIndex += 1;
        return;
      }
      renderedLineIndex += 3;
      return;
    }

    renderedLineIndex += 1;
  });

  return renderedLinesByRenderedLine;
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

function getClipboardImageFile(data: DataTransfer): File | null {
  const fileFromFiles = Array.from(data.files).find((file) => file.type.startsWith('image/'));
  if (fileFromFiles) return fileFromFiles;

  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (file) return file;
  }

  return null;
}

async function getPastedClipboardImagePath(data: DataTransfer): Promise<string | null> {
  const file = getClipboardImageFile(data);
  if (!file) {
    return window.clipboardAPI?.getClipboardImagePath?.() ?? null;
  }

  const buffer = await file.arrayBuffer();
  return window.clipboardAPI?.savePastedImageFile?.({
    name: file.name || null,
    type: file.type || null,
    data: new Uint8Array(buffer),
  }) ?? null;
}

function getClipboardMarkdownFileReferenceText(data: DataTransfer, pastedText: string): string {
  const filePaths = Array.from(data.files)
    .map((file) => (file as File & { path?: string }).path)
    .filter((path): path is string => !!path);
  if (filePaths.length > 0) return filePaths.join('\n');
  const uriList = data.getData('text/uri-list');
  return uriList.trim() ? uriList : pastedText;
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
  | { type: 'bookmarks' }
  | { type: 'ember' };

export type LibrarianEditorSession = {
  itemType: 'wiki' | 'artifact' | 'external';
  itemPath: string;
  contentMode: MarkdownContentMode;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

export type LibrarianNavigationEntry = {
  itemType: 'wiki' | 'artifact' | 'external' | 'ember';
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

export function getLibrarianBracketNavigationDirection(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'shiftKey' | 'ctrlKey' | 'altKey'>,
  input: { canNavigateBack: boolean; canNavigateForward: boolean },
): -1 | 0 | 1 | null {
  if (!event.metaKey || event.shiftKey || event.ctrlKey || event.altKey) return null;
  if (event.key === '[') return input.canNavigateBack ? -1 : 0;
  if (event.key === ']') return input.canNavigateForward ? 1 : 0;
  return null;
}

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
    if (parsed?.type === 'ember') {
      return { type: 'ember' };
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
      isMarkdownContentMode(parsed.contentMode)
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
  selectedItemType: LibrarianSelectedItemType,
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

export function resolveCurrentWikiCreateFolder(
  selectedItemType: LibrarianSelectedItemType,
  wikiSelectedRelPath: string | null
): string {
  if (selectedItemType !== 'wiki' || !wikiSelectedRelPath?.includes('/')) {
    return 'scratchpad';
  }
  return wikiSelectedRelPath.split('/').slice(0, -1).join('/') || 'scratchpad';
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

export function getLibrarianTitleFontSize(title: string, contentMode: MarkdownContentMode): number {
  const base = contentMode === 'markdown' ? 26 : 30;
  const length = title.trim().length;
  if (length <= 48) return base;
  if (length <= 96) return Math.max(18, Math.round((base - (length - 48) * 0.2) * 10) / 10);
  return Math.max(16, Math.round((base - 9.6 - (length - 96) * 0.1) * 10) / 10);
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

export function shouldRevealGroupedFocusChrome(input: {
  cursorClientY: number;
  paneClientTop: number;
  viewportHeight: number;
  revealDistancePx?: number;
}): boolean {
  return getGroupedFocusChromeProximityOpacity(input) > 0;
}

export function getGroupedFocusChromeProximityOpacity(input: {
  cursorClientY: number;
  paneClientTop: number;
  viewportHeight: number;
  revealDistancePx?: number;
  fullOpacityDistancePx?: number;
  topFullOpacityDistancePx?: number;
  bottomFullOpacityDistancePx?: number;
}): number {
  const revealDistancePx = Math.max(0, input.revealDistancePx ?? 128);
  const fullOpacityDistancePx = Math.max(0, Math.min(revealDistancePx, input.fullOpacityDistancePx ?? 28));
  const topFullOpacityDistancePx = Math.max(
    0,
    Math.min(revealDistancePx, input.topFullOpacityDistancePx ?? fullOpacityDistancePx),
  );
  const bottomFullOpacityDistancePx = Math.max(
    0,
    Math.min(revealDistancePx, input.bottomFullOpacityDistancePx ?? fullOpacityDistancePx),
  );
  if (
    !Number.isFinite(input.cursorClientY) ||
    !Number.isFinite(input.paneClientTop) ||
    !Number.isFinite(input.viewportHeight) ||
    input.viewportHeight <= 0 ||
    revealDistancePx <= 0
  ) {
    return 0;
  }

  const topDistance = input.cursorClientY - input.paneClientTop;
  const bottomDistance = input.viewportHeight - input.cursorClientY;
  const opacityForDistance = (distance: number, fullDistance: number) => {
    if (distance < 0 || distance > revealDistancePx) return 0;
    if (distance <= fullDistance) return 1;
    const fadeDistance = Math.max(1, revealDistancePx - fullDistance);
    return 1 - ((distance - fullDistance) / fadeDistance);
  };

  return Math.max(
    0,
    Math.min(1, Number(Math.max(
      opacityForDistance(topDistance, topFullOpacityDistancePx),
      opacityForDistance(bottomDistance, bottomFullOpacityDistancePx),
    ).toFixed(3))),
  );
}

export function getFocusChromeSurfaceOpacity(input: {
  isFocusChromeSurface: boolean;
  focusChromeActive: boolean;
}): number {
  if (!input.isFocusChromeSurface || !input.focusChromeActive) return 1;
  return 0;
}

export function getFocusChromeScopedItemOpacity(input: {
  focusChromeActive: boolean;
  visualOpacity: number;
}): number {
  if (!input.focusChromeActive) return 1;
  return Math.max(0, Math.min(1, input.visualOpacity));
}

export function shouldShowFocusToolbarControls(input: {
  focusChromeActive: boolean;
  focusChromePinnedVisible: boolean;
}): boolean {
  return !input.focusChromeActive || input.focusChromePinnedVisible;
}

export function getLibrarianContentTopPadding(input: {
  contentMode: MarkdownContentMode;
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

export function getLibrarianContentBottomScrollSpace(input: {
  contentMode: MarkdownContentMode;
  focusChromeActive: boolean;
}): number {
  if (input.contentMode === 'markdown') return 0;
  return LIBRARIAN_CONTENT_BOTTOM_SCROLL_SPACE_PX;
}

interface LibrarianViewProps {
  active?: boolean;
  onSwitchToClipboard: () => void;
  onSwitchToSettings?: () => void;
  onFullScreenChange?: (isFullScreen: boolean) => void;
  onFocusChromeActiveChange?: (active: boolean) => void;
  onBookmarksCanvasActiveChange?: (active: boolean) => void;
  onBookmarksCanvasToolbarTopChange?: (top: number | null) => void;
  onSelectedItemTypeChange?: (type: LibrarianSelectedItemType) => void;
  focusChromeGroupOpacity?: number;
  focusChromeEnabled?: boolean;
  onFocusChromeEnabledChange?: (enabled: boolean) => void;
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
  onFocusChromeContentCenterChange?: (centerX: number | null) => void;
  preserveCurrentSizeKey?: boolean;
  // Sidebar collapse state is owned by ClipboardHistory so the footer
  // toggle can drive it regardless of which view is active.
  sidebarCollapsed: boolean;
  sidebarToggleRequestKey?: number;
}

type MarkdownRenderNode = {
  type?: string;
  tagName?: unknown;
  value?: unknown;
  children?: unknown;
  position?: {
    start?: {
      line?: unknown;
      offset?: unknown;
    };
    end?: {
      offset?: unknown;
    };
  };
  properties?: {
    className?: unknown;
    checked?: unknown;
    type?: unknown;
  };
};

function getMarkdownSourceOffsetDebug(content: string | null, offset: number | null): Record<string, unknown> | null {
  if (typeof content !== 'string' || typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  const clampedOffset = Math.max(0, Math.min(content.length, offset));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < clampedOffset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  const nextLineBreak = content.indexOf('\n', clampedOffset);
  const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
  return {
    offset: clampedOffset,
    line,
    column: clampedOffset - lineStart + 1,
    lineStart,
    lineEnd,
    lineLength: lineEnd - lineStart,
    before: content.slice(Math.max(lineStart, clampedOffset - 40), clampedOffset),
    after: content.slice(clampedOffset, Math.min(lineEnd, clampedOffset + 40)),
  };
}

function isRenderedSelectionElementBoundary(selection: Record<string, unknown>): boolean {
  return selection.startNodeType !== Node.TEXT_NODE
    || selection.endNodeType !== Node.TEXT_NODE
    || selection.caretRect === null;
}

export function getRenderedMarkdownNodeStartLine(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null;
  const line = (node as MarkdownRenderNode).position?.start?.line;
  return typeof line === 'number' && Number.isFinite(line) ? line : null;
}

export function getRenderedTaskListItemChecked(node: unknown): boolean | null {
  if (!node || typeof node !== 'object') return null;
  const renderNode = node as MarkdownRenderNode;
  if (!Array.isArray(renderNode.children)) return null;
  for (const child of renderNode.children) {
    if (!child || typeof child !== 'object') continue;
    const childNode = child as MarkdownRenderNode;
    if (childNode.tagName !== 'input' || childNode.properties?.type !== 'checkbox') continue;
    return childNode.properties.checked === true;
  }
  return null;
}

export function isRenderedTaskListItem(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const className = (node as MarkdownRenderNode).properties?.className;
  if (Array.isArray(className)) return className.includes('task-list-item');
  if (className === 'task-list-item') return true;
  return getRenderedTaskListItemChecked(node) !== null;
}

function LibrarianView({ active = true, onSwitchToClipboard, onSwitchToSettings, onFullScreenChange, onFocusChromeActiveChange, onBookmarksCanvasActiveChange, onBookmarksCanvasToolbarTopChange, onSelectedItemTypeChange, focusChromeGroupOpacity = 0, focusChromeEnabled, onFocusChromeEnabledChange, initialReadingPath, initialOpenTarget, initialFullScreen, onInitialReadingConsumed, onInitialOpenTargetConsumed, autoPopArtifactPath, onAutoPopArtifactSuperseded, onOpenCommandPath, onFocusChromeShortcut, onActiveFileUpdatedChange, onFocusChromeContentCenterChange, preserveCurrentSizeKey = false, sidebarCollapsed, sidebarToggleRequestKey = 0 }: LibrarianViewProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();
  const restoredSelection = useMemo(() => restoreLibrarianSelection(localStorage), []);
  const hadInitialOpenTargetRef = useRef(Boolean(initialOpenTarget));
  const initialSelection = hadInitialOpenTargetRef.current ? null : restoredSelection;
  const restoredEditorSession = useMemo(() => restoreLibrarianEditorSession(localStorage), []);
  const restoredEditorSessionRef = useRef<LibrarianEditorSession | null>(restoredEditorSession);

  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(() => initialSelection?.type === 'artifact' ? initialSelection.path : null);
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
  const sharedContentSyncRef = useRef<{
    sharedId: string;
    content: string;
    expectedRevision: number;
    documentPath: string | null;
  } | null>(null);
  const sharedContentSyncTimerRef = useRef<number | null>(null);
  const sharedContentSyncInFlightRef = useRef(false);
  const sharedFileStatusRef = useRef<SharedFileStatus | null>(null);
  const sharedFileStatusPathRef = useRef<string | null>(null);
  // Tracks what's actually on disk. activeReading.content goes stale after
  // the first save (we intentionally don't re-fetch to preserve the
  // editor's undo stack), so comparing against it would miss the
  // "typed a char then deleted it" case.
  const lastSavedContentRef = useRef<string | null>(null);
  const lastSavedVersionRef = useRef<DocumentVersion | null>(null);
  const lastSeededPathRef = useRef<string | null>(null);
  const pendingCopiedImageDeletesRef = useRef<Array<{ documentPath: string; markdownImages: string[] }>>([]);
  const [textSize, setTextSize] = useState<LibrarianTextSizeId>(() => {
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
  const [maxwellItems, setMaxwellItems] = useState<LibrarianMaxwellItem[]>(() => (
    restoreLibrarianMaxwellItems(localStorage)
  ));
  const [blinkTextCursor, setBlinkTextCursor] = useState(() => restoreTextCursorBlink(localStorage));
  const [renderedTextCursorStyle, setRenderedTextCursorStyle] = useState<RenderedTextCursorStyle>(() => (
    restoreRenderedTextCursorStyle(localStorage)
  ));
  const [renderedBlockCursorOpacity, setRenderedBlockCursorOpacity] = useState(() => (
    restoreRenderedBlockCursorOpacity(localStorage)
  ));
  const [lineNumbersMode, setLineNumbersMode] = useState<'hidden' | 'visible' | 'faded'>(() => {
    const saved = localStorage.getItem(LINE_NUMBERS_STORAGE_KEY);
    return saved === 'visible' || saved === 'faded' ? saved : 'hidden';
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => {
    if (!initialSelection) return null;
    if (initialSelection.type === 'wiki') return `wiki:${initialSelection.relPath}`;
    if (initialSelection.type === 'artifact') return `artifact:${initialSelection.path}`;
    if (initialSelection.type === 'ember') return EMBER_ITEM_ID;
    return BOOKMARKS_ITEM_ID;
  });
  const selectedItemIdRef = useRef<string | null>(selectedItemId);
  const [selectedItemType, setSelectedItemType] = useState<LibrarianSelectedItemType>(() => initialSelection?.type ?? null);
  const selectedItemUsesLegacyImmersive = selectedItemType === 'bookmarks';
  const [isFullScreen, setIsFullScreen] = useState(() => (
    initialSelection?.type === 'bookmarks' ? initialFullScreen ?? false : false
  ));
  const [uncontrolledFocusImmersive, setUncontrolledFocusImmersive] = useState(false);
  const focusImmersive = focusChromeEnabled ?? uncontrolledFocusImmersive;
  const setFocusImmersive = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const nextValue = typeof next === 'function' ? next(focusImmersive) : next;
    if (focusChromeEnabled === undefined) {
      setUncontrolledFocusImmersive(nextValue);
    }
    onFocusChromeEnabledChange?.(nextValue);
  }, [focusChromeEnabled, focusImmersive, onFocusChromeEnabledChange]);
  const toggleImmersive = useCallback(() => {
    if (selectedItemUsesLegacyImmersive) {
      setIsFullScreen((prev) => !prev);
      return;
    }
    if (!focusImmersive) {
      onFocusChromeShortcut?.();
    }
    setFocusImmersive((prev) => !prev);
  }, [focusImmersive, onFocusChromeShortcut, selectedItemUsesLegacyImmersive, setFocusImmersive]);
  useLayoutEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);
  const [writingChromeHidden, setWritingChromeHidden] = useState(false);
  const markdownEditorEdgeFadesRef = useRef({ top: false, bottom: false });
  const [markdownDocumentTopFade, setMarkdownDocumentTopFade] = useState(false);
  const [renderedDocumentTopFade, setRenderedDocumentTopFade] = useState(false);
  const [markdownUrlPasteChoice, setMarkdownUrlPasteChoice] = useState<MarkdownUrlPasteEdit | null>(null);
  const [markdownWikiLinkCompletion, setMarkdownWikiLinkCompletion] = useState<MarkdownWikiLinkCompletionState | null>(null);
  const [markdownWikiLinkSuggestionIndex, setMarkdownWikiLinkSuggestionIndex] = useState(0);
  const [renderedImagePreview, setRenderedImagePreview] = useState<MarkdownCodeEditorImagePreview | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('librarian-sidebar-width');
    return saved ? parseInt(saved, 10) : 180;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const [isResizing, setIsResizing] = useState(false);
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
  const [sidebarHoverExpanded, setSidebarHoverExpanded] = useState(false);
  const collapsedSidebarHoverReveal = useCollapsedSidebarHoverReveal(setSidebarHoverExpanded);
  const wikiCreationRef = useRef<WikiCreationController | null>(null);
  const wikiArchiveRef = useRef<WikiArchiveController | null>(null);
  const readerPaneRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const renderedContentRef = useRef<HTMLDivElement | null>(null);
  const renderedMarkdownEditorRef = useRef<MarkdownCodeEditorHandle | null>(null);
  const activeReadingPathRef = useRef<string | null>(null);
  const activeReadingContentRef = useRef<string | null>(null);
  const renderedEditorDebugEntriesRef = useRef<RenderedEditorDebugEntry[]>([]);
  const markdownCodeEditorRef = useRef<MarkdownCodeEditorHandle | null>(null);
  const pendingMarkdownInsertionSelectionRef = useRef<{ value: string; start: number; end: number } | null>(null);
  const renderedSaveTimerRef = useRef<number | null>(null);
  const pendingRenderedSaveRef = useRef<(() => void) | null>(null);
  const renderedReactCommitTimerRef = useRef<number | null>(null);
  const pendingRenderedReactCommitRef = useRef<{ path: string; content: string } | null>(null);
  const renderedSaveInFlightRef = useRef(0);
  const lastRenderedEditAtRef = useRef(0);
  const activeRenderedCaretOffsetRef = useRef<number | null>(null);
  const latestRenderedContentRef = useRef<{ path: string; content: string } | null>(null);
  const renderedDisplayContentRef = useRef<{ path: string; content: string } | null>(null);
  const latestMarkdownCursorSnapshotRef = useRef<(MarkdownCodeEditorSelectionSnapshot & { timestamp: number; stage: string }) | null>(null);
  const editorCursorSettleTimerRef = useRef<number | null>(null);
  const pendingRenderedEditorSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const terminalReturnEditorSelectionRef = useRef<{ mode: MarkdownContentMode; start: number; end: number } | null>(null);

  const renderedScrollSamplerRef = useScrollFpsSampler('rendered');
  const sampleRenderedEditorInteraction = useInteractionFpsSampler('rendered-editor-input');
  const setContentScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      contentScrollRef.current = el;
      renderedScrollSamplerRef(el);
    },
    [renderedScrollSamplerRef],
  );
  const pendingRenderedEditSelectionRef = useRef<number | null>(null);
  const pendingRenderedEditSelectionEndRef = useRef<number | null>(null);
  const pendingTitleEditPathRef = useRef<string | null>(null);
  const titleCommitInFlightRef = useRef(false);
  const [editingTitlePath, setEditingTitlePath] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const focusMarkdownEditorOnOpenRef = useRef(false);
  const editorSessionPersistTimerRef = useRef<number | null>(null);
  const pendingScrollRatioRef = useRef<number | null>(null);
  const copyPathFeedbackTimerRef = useRef<number | null>(null);
  const markdownEditUndoStackRef = useRef<MarkdownUndoSnapshot[]>([]);
  const renderedEditUndoStackRef = useRef<MarkdownUndoSnapshot[]>([]);

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
  const [sharedFilesAvailable, setSharedFilesAvailable] = useState(false);
  const [sharedFilesCanWrite, setSharedFilesCanWrite] = useState(false);
  const [sharedFileStatus, setSharedFileStatus] = useState<SharedFileStatus | null>(null);
  const [sharedFilePresenceUsers, setSharedFilePresenceUsers] = useState<SharedFilePresenceUser[]>([]);
  const [isTogglingSharedFile, setIsTogglingSharedFile] = useState(false);
  const [sharedFileToggleHotkey, setSharedFileToggleHotkey] = useState(() => restoreSharedFileToggleHotkey(localStorage));
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyFeedbackLabel, setCopyFeedbackLabel] = useState<string | null>(null);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [bookmarksCanvasActive, setBookmarksCanvasActive] = useState<boolean>(() => localStorage.getItem('bookmarks-view-mode') !== 'list');

  useEffect(() => {
    let cancelled = false;
    const loadAvailability = async () => {
      const availability = await window.sharedFilesAPI?.getAvailability?.();
      const available = availability?.available === true;
      if (!cancelled) {
        setSharedFilesAvailable(available);
        setSharedFilesCanWrite(availability?.canWrite === true);
      }
      if (available) {
        void window.sharedFilesAPI?.sync?.()
          .then((result) => {
            if (result && (result.written > 0 || result.removed > 0 || result.created > 0)) {
              window.dispatchEvent(new Event(LOCAL_RIVER_CHANGED_EVENT));
            }
          })
          .catch((error) => {
            console.warn('[Librarian] River startup sync failed:', error);
          });
      }
    };
    void loadAvailability();
    const unsubscribe = window.teamAPI?.onTeamChanged?.(() => {
      void loadAvailability();
    });
    const unsubscribeAuth = window.authAPI?.onSessionChanged?.(() => {
      void loadAvailability();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    const handleSharedFileHotkeyChanged = () => {
      setSharedFileToggleHotkey(restoreSharedFileToggleHotkey(localStorage));
    };
    window.addEventListener('fieldtheory:shared-file-toggle-hotkey-changed', handleSharedFileHotkeyChanged);
    return () => window.removeEventListener('fieldtheory:shared-file-toggle-hotkey-changed', handleSharedFileHotkeyChanged);
  }, []);

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

  // Content mode: rendered prose, markdown source, or gated Typedown spike.
  const [contentMode, setContentMode] = useState<MarkdownContentMode>('rendered');
  const [codexTerminalVisible, setCodexTerminalVisible] = useState(() => (
    localStorage.getItem(CODEX_TERMINAL_VISIBLE_STORAGE_KEY) === 'true'
  ));
  const [codexTerminalFocusRequestKey, setCodexTerminalFocusRequestKey] = useState(0);
  const [codexTerminalFocused, setCodexTerminalFocused] = useState(false);
  const [codexTerminalDockSide, setCodexTerminalDockSide] = useState<CodexTerminalDockSide>(() => (
    localStorage.getItem(CODEX_TERMINAL_DOCK_STORAGE_KEY) === 'right' ? 'right' : 'bottom'
  ));
  const [responsivePanelSize, setResponsivePanelSize] = useState({ width: 0, height: 0 });
  const responsivePanelStateRef = useRef<ResponsivePanelState | undefined>(undefined);
  const [suppressAutoCollapseSidebar, setSuppressAutoCollapseSidebar] = useState(false);
  const [suppressAutoHideTerminal, setSuppressAutoHideTerminal] = useState(false);
  const [codexTerminalResizing, setCodexTerminalResizing] = useState(false);
  const previousSidebarCollapsedRef = useRef(sidebarCollapsed);
  const sidebarForcedVisibleForEmptySelection = !hadInitialOpenTargetRef.current && selectedItemId === null && !isFullScreen;
  const responsivePanelState = getResponsivePanelState({
    containerWidth: responsivePanelSize.width,
    containerHeight: responsivePanelSize.height,
    sidebarWidth,
    sidebarCollapsed,
    sidebarForcedVisible: sidebarForcedVisibleForEmptySelection,
    terminalVisible: codexTerminalVisible,
    terminalDockSide: codexTerminalDockSide,
    userResizing: isResizing || codexTerminalResizing,
    previous: responsivePanelStateRef.current,
  });
  responsivePanelStateRef.current = responsivePanelState;
  const effectiveSidebarCollapsed = sidebarCollapsed
    || (responsivePanelState.autoCollapseSidebar && !suppressAutoCollapseSidebar);
  const effectiveCodexTerminalDockSide: CodexTerminalDockSide =
    responsivePanelState.autoDockTerminalBottom ? 'bottom' : codexTerminalDockSide;
  const effectiveCodexTerminalVisible = codexTerminalVisible
    && !(responsivePanelState.autoHideTerminal && !suppressAutoHideTerminal);
  const animateResponsiveSidebar = shouldAnimateResponsiveSidebar({
    responsivePanelState,
    userResizing: isResizing || codexTerminalResizing,
  });
  useEffect(() => {
    if (sidebarToggleRequestKey > 0 && effectiveSidebarCollapsed && !isFullScreen) {
      setSidebarHoverExpanded((expanded) => !expanded);
    }
  }, [effectiveSidebarCollapsed, isFullScreen, sidebarToggleRequestKey]);
  const [renderedEditingActive, setRenderedEditingActive] = useState(false);
  const [renderedEditorDebugEnabled, setRenderedEditorDebugEnabled] = useState(() => (
    localStorage.getItem(RENDERED_EDITOR_DEBUG_STORAGE_KEY) === 'true'
  ));
  const renderedEditorDebugEnabledRef = useRef(renderedEditorDebugEnabled);
  const renderedEditingActiveRef = useRef(renderedEditingActive);
  const contentModeRef = useRef(contentMode);
  const editContentRef = useRef(editContent);
  useLayoutEffect(() => {
    contentModeRef.current = contentMode;
    editContentRef.current = editContent;
    renderedEditingActiveRef.current = renderedEditingActive;
    renderedEditorDebugEnabledRef.current = renderedEditorDebugEnabled;
  }, [contentMode, editContent, renderedEditingActive, renderedEditorDebugEnabled]);
  const getRenderedCursorDebugState = useCallback((label = 'cursor'): Record<string, unknown> => {
    const root = renderedContentRef.current;
    const editor = renderedMarkdownEditorRef.current;
    const content = activeReadingContentRef.current;
    const doc = root?.ownerDocument ?? document;
    const activeElement = doc.activeElement;
    const scrollEl = contentScrollRef.current;
    const editorSnapshot = editor?.getSelectionSnapshot() ?? null;
    const editorRange = editor?.getSelectionRange() ?? null;
    const activeOffset = editorSnapshot?.selectionHead ?? editorRange?.end ?? activeRenderedCaretOffsetRef.current;
    const selection = editorSnapshot
      ? {
          exists: true,
          surface: 'rendered-code-editor',
          selectionStart: editorSnapshot.selectionStart,
          selectionEnd: editorSnapshot.selectionEnd,
          selectionHead: editorSnapshot.selectionHead,
          isCollapsed: editorSnapshot.isCollapsed,
        }
      : root ? getRenderedSelectionDebug(root) : { exists: false, reason: 'no-rendered-root' };
    return {
      label,
      path: activeReadingPathRef.current,
      contentMode: contentModeRef.current,
      editingActive: renderedEditingActiveRef.current,
      rootExists: !!root,
      inputExists: !!editor,
      contentLength: content?.length ?? null,
      activeSourceOffset: activeOffset,
      activeSource: getMarkdownSourceOffsetDebug(content, activeOffset),
      selection,
      focus: {
        activeElement: getElementDebugSummary(activeElement),
        rootIsActiveElement: activeElement === root,
        rootContainsActiveElement: !!root && !!activeElement && root.contains(activeElement),
      },
      scroll: scrollEl ? {
        top: scrollEl.scrollTop,
        height: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
      } : null,
    };
  }, []);
  const getMarkdownCursorDebugState = useCallback((
    label = 'markdown-cursor',
    snapshot?: MarkdownCodeEditorSelectionSnapshot | null,
  ): Record<string, unknown> => {
    const editor = markdownCodeEditorRef.current;
    const latestSnapshot = latestMarkdownCursorSnapshotRef.current;
    const liveSnapshot = snapshot
      ?? editor?.getSelectionSnapshot()
      ?? latestSnapshot
      ?? null;
    const value = liveSnapshot?.value ?? editor?.getValue() ?? editContentRef.current;
    const selectionRange = editor?.getSelectionRange();
    const selectionStart = liveSnapshot?.selectionStart ?? selectionRange?.start ?? 0;
    const selectionEnd = liveSnapshot?.selectionEnd ?? selectionRange?.end ?? selectionStart;
    const selectionHead = liveSnapshot?.selectionHead ?? selectionEnd;
    const selectionAnchor = liveSnapshot?.selectionAnchor ?? selectionStart;
    const doc = document;
    const activeElement = doc.activeElement;
    return {
      label,
      path: activeReadingPathRef.current,
      contentMode: contentModeRef.current,
      live: !!editor,
      snapshotOnly: !editor && !!latestSnapshot,
      contentLength: value.length,
      snapshotAgeMs: latestSnapshot ? Date.now() - latestSnapshot.timestamp : null,
      snapshotStage: latestSnapshot?.stage ?? null,
      selectionStart,
      selectionEnd,
      selectionAnchor,
      selectionHead,
      isCollapsed: liveSnapshot?.isCollapsed ?? selectionStart === selectionEnd,
      selectionStartSource: liveSnapshot?.selectionStartSource ?? getMarkdownSourceOffsetDebug(value, selectionStart),
      selectionEndSource: liveSnapshot?.selectionEndSource ?? getMarkdownSourceOffsetDebug(value, selectionEnd),
      selectionHeadSource: liveSnapshot?.selectionHeadSource ?? getMarkdownSourceOffsetDebug(value, selectionHead),
      caretPosition: liveSnapshot?.caretPosition ?? null,
      caretRect: liveSnapshot?.caretRect ?? null,
      input: liveSnapshot
        ? {
            docChanged: liveSnapshot.docChanged,
            inputType: liveSnapshot.inputType ?? null,
            inputDataLength: liveSnapshot.inputData?.length ?? 0,
          }
        : null,
      focus: {
        activeElement: getElementDebugSummary(activeElement),
        activeElementIsCodeMirror: activeElement instanceof Element
          ? !!activeElement.closest('.cm-editor, .cm-content')
          : false,
      },
      scroll: liveSnapshot?.scroll ?? (editor ? {
        top: editor.scrollTop,
        height: editor.scrollHeight,
        clientHeight: editor.clientHeight,
      } : null),
    };
  }, []);
  const getEditorCursorDebugState = useCallback((
    label = 'editor-cursor',
    markdownSnapshot?: MarkdownCodeEditorSelectionSnapshot | null,
  ): Record<string, unknown> => {
    const markdown = getMarkdownCursorDebugState(`${label}-markdown`, markdownSnapshot);
    const rendered = getRenderedCursorDebugState(`${label}-rendered`);
    const markdownHead = typeof markdown.selectionHead === 'number' ? markdown.selectionHead : null;
    const renderedSource = typeof rendered.activeSourceOffset === 'number' ? rendered.activeSourceOffset : null;
    const activeSurface = contentModeRef.current === 'markdown' ? 'markdown' : 'rendered';
    return {
      label,
      path: activeReadingPathRef.current,
      contentMode: contentModeRef.current,
      activeSurface,
      activeCursor: {
        surface: activeSurface,
        sourceOffset: activeSurface === 'markdown' ? markdownHead : renderedSource,
        source: activeSurface === 'markdown' ? markdown.selectionHeadSource ?? null : rendered.activeSource ?? null,
      },
      markdown,
      rendered,
      sourceOffsetComparison: {
        markdownHead,
        markdownLive: markdown.live === true,
        renderedSource,
        renderedLive: rendered.rootExists === true,
        delta: typeof markdownHead === 'number' && typeof renderedSource === 'number'
          ? markdownHead - renderedSource
          : null,
      },
    };
  }, [getMarkdownCursorDebugState, getRenderedCursorDebugState]);
  const getRenderedEditorDebugState = useCallback((): Record<string, unknown> => {
    const root = renderedContentRef.current;
    const editor = renderedMarkdownEditorRef.current;
    const editorSnapshot = editor?.getSelectionSnapshot() ?? null;
    const doc = root?.ownerDocument ?? document;
    const activeElement = doc.activeElement;
    const scrollEl = contentScrollRef.current;
    return {
      enabled: localStorage.getItem(RENDERED_EDITOR_DEBUG_STORAGE_KEY) === 'true',
      path: activeReadingPathRef.current,
      contentMode: contentModeRef.current,
      editingActive: renderedEditingActiveRef.current,
      activeCaretOffset: activeRenderedCaretOffsetRef.current,
      pendingSave: !!pendingRenderedSaveRef.current,
      renderedSaveInFlight: renderedSaveInFlightRef.current,
      saveTimerActive: renderedSaveTimerRef.current !== null,
      activeElement: getElementDebugSummary(activeElement),
      renderedRoot: {
        exists: !!root,
        isActiveElement: activeElement === root,
        containsActiveElement: !!root && !!activeElement && root.contains(activeElement),
        tabIndex: root?.tabIndex ?? null,
        rect: getRectDebugSummary(root?.getBoundingClientRect()),
      },
      renderedInput: editor ? {
        isActiveElement: activeElement instanceof Element
          ? !!activeElement.closest('.cm-editor, .cm-content')
          : false,
        selectionStart: editorSnapshot?.selectionStart ?? editor.getSelectionRange().start,
        selectionEnd: editorSnapshot?.selectionEnd ?? editor.getSelectionRange().end,
        valueLength: editor.getValue().length,
      } : null,
      selection: root ? getRenderedSelectionDebug(root) : { exists: false, reason: 'no-rendered-root' },
      scroll: scrollEl ? {
        top: scrollEl.scrollTop,
        height: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
      } : null,
      recentStages: renderedEditorDebugEntriesRef.current.slice(-8).map((entry) => entry.stage),
      cursor: getRenderedCursorDebugState('state'),
      editorCursor: getEditorCursorDebugState('state'),
    };
  }, [getEditorCursorDebugState, getRenderedCursorDebugState]);
  const recordRenderedEditorDebug = useCallback((
    stage: string,
    details: Record<string, unknown> | (() => Record<string, unknown>) = {},
  ) => {
    if (!renderedEditorDebugEnabledRef.current) return null;
    const entry: RenderedEditorDebugEntry = {
      timestamp: Date.now(),
      stage,
      path: activeReadingPathRef.current,
      contentMode: contentModeRef.current,
      editingActive: renderedEditingActiveRef.current,
      scrollTop: contentScrollRef.current?.scrollTop ?? null,
      details: typeof details === 'function' ? details() : details,
    };
    renderedEditorDebugEntriesRef.current = [...renderedEditorDebugEntriesRef.current, entry].slice(-RENDERED_EDITOR_DEBUG_ENTRY_LIMIT);
    const api = (window as Window & { ftDebugRenderedEditor?: RenderedEditorDebugApi }).ftDebugRenderedEditor;
    void window.diagnosticsAPI?.appendRenderedEditorDebug?.(entry);
    if (api?.isEnabled()) {
      console.log('[RenderedEditor]', stage, entry);
    }
    window.dispatchEvent(new CustomEvent('fieldtheory:rendered-editor-debug', { detail: entry }));
    return entry;
  }, []);
  const getRenderedEditorTimingEntries = useCallback((limit = 80): RenderedEditorTimingEntry[] => {
    const safeLimit = Math.max(1, Math.min(RENDERED_EDITOR_DEBUG_ENTRY_LIMIT, Math.floor(limit)));
    const entries = renderedEditorDebugEntriesRef.current.slice(-safeLimit);
    return entries.map((entry, index) => {
      const detailStage = typeof entry.details.stage === 'string' ? entry.details.stage : null;
      const duration = entry.details.durationMs;
      const previous = index > 0 ? entries[index - 1] : null;
      return {
        index,
        timestamp: entry.timestamp,
        sincePreviousMs: previous ? entry.timestamp - previous.timestamp : null,
        stage: detailStage && entry.stage === 'rendered-editor-timing'
          ? detailStage
          : entry.stage,
        durationMs: typeof duration === 'number' ? duration : null,
        path: entry.path,
        contentMode: entry.contentMode,
        editingActive: entry.editingActive,
        details: entry.details,
      };
    });
  }, []);
  const logRenderedEditorTimingTable = useCallback((limit = 80): RenderedEditorTimingEntry[] => {
    const timings = getRenderedEditorTimingEntries(limit);
    console.table(timings.map((entry) => ({
      index: entry.index,
      stage: entry.stage,
      durationMs: entry.durationMs,
      sincePreviousMs: entry.sincePreviousMs,
      editingActive: entry.editingActive,
      contentMode: entry.contentMode,
      path: entry.path,
    })));
    return timings;
  }, [getRenderedEditorTimingEntries]);
  const scheduleEditorCursorSettledDebug = useCallback((
    reason: string,
    markdownSnapshot?: MarkdownCodeEditorSelectionSnapshot | null,
  ) => {
    latestMarkdownCursorSnapshotRef.current = markdownSnapshot
      ? { ...markdownSnapshot, timestamp: Date.now(), stage: reason }
      : latestMarkdownCursorSnapshotRef.current;
    if (editorCursorSettleTimerRef.current !== null) {
      window.clearTimeout(editorCursorSettleTimerRef.current);
    }
    recordRenderedEditorDebug('editor-cursor-observed', () => ({
      reason,
      cursor: getEditorCursorDebugState(`${reason}-observed`, markdownSnapshot),
    }));
    editorCursorSettleTimerRef.current = window.setTimeout(() => {
      editorCursorSettleTimerRef.current = null;
      recordRenderedEditorDebug('editor-cursor-settled', () => ({
        reason,
        cursor: getEditorCursorDebugState(`${reason}-settled`),
      }));
    }, 650);
  }, [getEditorCursorDebugState, recordRenderedEditorDebug]);
  useEffect(() => () => {
    if (editorCursorSettleTimerRef.current !== null) {
      window.clearTimeout(editorCursorSettleTimerRef.current);
      editorCursorSettleTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    const handleRenderedEditorTiming = (event: Event) => {
      const detail = event instanceof CustomEvent && typeof event.detail === 'object' && event.detail !== null
        ? event.detail as Record<string, unknown>
        : {};
      recordRenderedEditorDebug('rendered-editor-timing', detail);
    };
    window.addEventListener(RENDERED_MARKDOWN_EDITOR_TIMING_EVENT, handleRenderedEditorTiming);
    return () => window.removeEventListener(RENDERED_MARKDOWN_EDITOR_TIMING_EVENT, handleRenderedEditorTiming);
  }, [recordRenderedEditorDebug]);
  useEffect(() => {
    const isEnabled = () => localStorage.getItem(RENDERED_EDITOR_DEBUG_STORAGE_KEY) === 'true';
    const setEnabled = (enabled: boolean) => {
      localStorage.setItem(RENDERED_EDITOR_DEBUG_STORAGE_KEY, enabled ? 'true' : 'false');
      renderedEditorDebugEnabledRef.current = enabled;
      setRenderedEditorDebugEnabled(enabled);
    };
    const api: RenderedEditorDebugApi = {
      enable: () => {
        setEnabled(true);
        recordRenderedEditorDebug('debug-enabled', { state: getRenderedEditorDebugState() });
        console.log('[RenderedEditor]', 'debug enabled', {
          commands: [
            'window.ftDebugRenderedEditor.state()',
            'window.ftDebugRenderedEditor.cursor()',
            'window.ftDebugRenderedEditor.markdownCursor()',
            'window.ftDebugRenderedEditor.renderedCursor()',
            'window.ftDebugRenderedEditor.snapshot()',
            'window.ftDebugRenderedEditor.timings()',
            'window.ftDebugRenderedEditor.table()',
            'window.ftDebugRenderedEditor.slow(8)',
            'window.ftDebugRenderedEditor.mark("label")',
          ],
        });
      },
      disable: () => {
        recordRenderedEditorDebug('debug-disabled', { state: getRenderedEditorDebugState() });
        setEnabled(false);
        console.log('[RenderedEditor]', 'debug disabled');
      },
      isEnabled,
      state: getRenderedEditorDebugState,
      cursor: () => getEditorCursorDebugState('api-cursor'),
      markdownCursor: () => getMarkdownCursorDebugState('api-markdown-cursor'),
      renderedCursor: () => getRenderedCursorDebugState('api-rendered-cursor'),
      snapshot: () => [...renderedEditorDebugEntriesRef.current],
      timings: getRenderedEditorTimingEntries,
      slow: (thresholdMs = 8) => getRenderedEditorTimingEntries(RENDERED_EDITOR_DEBUG_ENTRY_LIMIT)
        .filter((entry) => (entry.durationMs ?? 0) >= thresholdMs),
      table: logRenderedEditorTimingTable,
      last: () => renderedEditorDebugEntriesRef.current[renderedEditorDebugEntriesRef.current.length - 1] ?? null,
      clear: () => {
        renderedEditorDebugEntriesRef.current = [];
        void window.diagnosticsAPI?.clearRenderedEditorDebugLog?.();
        recordRenderedEditorDebug('debug-cleared');
      },
      mark: (label = 'manual') => recordRenderedEditorDebug('debug-mark', {
        label,
        state: getRenderedEditorDebugState(),
      }),
      root: () => renderedContentRef.current,
    };
    const debugWindow = window as Window & { ftDebugRenderedEditor?: RenderedEditorDebugApi };
    debugWindow.ftDebugRenderedEditor = api;
    if (api.isEnabled()) {
      setRenderedEditorDebugEnabled(true);
      recordRenderedEditorDebug('debug-api-installed', { state: getRenderedEditorDebugState() });
    }
    return () => {
      if (debugWindow.ftDebugRenderedEditor === api) {
        delete debugWindow.ftDebugRenderedEditor;
      }
    };
  }, [getEditorCursorDebugState, getMarkdownCursorDebugState, getRenderedCursorDebugState, getRenderedEditorDebugState, getRenderedEditorTimingEntries, logRenderedEditorTimingTable, recordRenderedEditorDebug]);
  useEffect(() => {
    const handleDocumentKeyDownCapture = (event: KeyboardEvent) => {
      if (!renderedEditorDebugEnabledRef.current) return;
      const beforeScrollTop = contentScrollRef.current?.scrollTop ?? null;
      recordRenderedEditorDebug('document-keydown-capture', () => ({
        key: event.key,
        code: event.code,
        defaultPrevented: event.defaultPrevented,
        target: getElementDebugSummary(event.target instanceof Element ? event.target : null),
        state: getRenderedEditorDebugState(),
      }));
      window.setTimeout(() => {
        const afterScrollTop = contentScrollRef.current?.scrollTop ?? null;
        recordRenderedEditorDebug('document-keydown-after-default', () => ({
          key: event.key,
          code: event.code,
          defaultPrevented: event.defaultPrevented,
          beforeScrollTop,
          afterScrollTop,
          scrollDelta: typeof beforeScrollTop === 'number' && typeof afterScrollTop === 'number'
            ? afterScrollTop - beforeScrollTop
            : null,
          state: getRenderedEditorDebugState(),
        }));
      }, 0);
    };
    window.addEventListener('keydown', handleDocumentKeyDownCapture, true);
    return () => window.removeEventListener('keydown', handleDocumentKeyDownCapture, true);
  }, [getRenderedEditorDebugState, recordRenderedEditorDebug]);
  const clearRenderedEditingState = useCallback((reason = 'clear') => {
    recordRenderedEditorDebug('clear', { reason });
    renderedDisplayContentRef.current = null;
    renderedEditingActiveRef.current = false;
    setRenderedEditingActive(false);
    activeRenderedCaretOffsetRef.current = null;
  }, [recordRenderedEditorDebug]);

  const activateRenderedEditing = useCallback(() => {
    const path = activeReadingPathRef.current;
    const content = activeReadingContentRef.current;
    if (path && content !== null && renderedDisplayContentRef.current?.path !== path) {
      renderedDisplayContentRef.current = { path, content };
    }
    renderedEditingActiveRef.current = true;
    setRenderedEditingActive(true);
  }, []);
  const canUseFocusImmersive = selectedItemType === 'wiki' || selectedItemType === 'artifact' || selectedItemType === 'external';
  const isFocusedWritingMode = canUseFocusImmersive && !isFullScreen && effectiveSidebarCollapsed && contentMode === 'markdown';
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
      sidebarCollapsed: effectiveSidebarCollapsed,
      focusImmersive,
      isFocusedWritingMode,
      writingChromeHidden,
    });
  const focusChromeUsesProximityFade = focusChromeActive;
  const [focusToolbarMenuOpen, setFocusToolbarMenuOpen] = useState(false);
  const focusChromePinnedVisible = fileFindOpen || focusToolbarMenuOpen;
  const focusChromeProximityOpacity = focusChromeUsesProximityFade ? focusChromeGroupOpacity : 0;
  const focusChromeVisualOpacity = !focusChromeUsesProximityFade || focusChromePinnedVisible
    ? 1
    : focusChromeProximityOpacity;
  const focusChromeVisualVisible = focusChromeVisualOpacity > 0;
  const focusChromeScopedItemOpacity = getFocusChromeScopedItemOpacity({
    focusChromeActive,
    visualOpacity: focusChromeVisualOpacity,
  });
  const focusChromeScopedItemVisible = !focusChromeActive || focusChromeVisualVisible;
  const focusToolbarControlsVisible = shouldShowFocusToolbarControls({
    focusChromeActive,
    focusChromePinnedVisible,
  });
  const contentTopPadding = getLibrarianContentTopPadding({
    contentMode,
    focusChromeActive,
    isFullScreen,
  });
  const contentBottomScrollSpace = getLibrarianContentBottomScrollSpace({ contentMode, focusChromeActive });
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

  useEffect(() => {
    sharedFileStatusRef.current = sharedFileStatus;
  }, [sharedFileStatus]);

  const runSharedContentSync = useCallback(async () => {
    if (sharedContentSyncInFlightRef.current) return;
    const pending = sharedContentSyncRef.current;
    if (!pending) return;

    sharedContentSyncRef.current = null;
    sharedContentSyncInFlightRef.current = true;
    let shouldRetryPending = false;
    const currentStatus = sharedFileStatusRef.current;
    const expectedRevision = currentStatus?.sharedId === pending.sharedId
      ? currentStatus.revision ?? pending.expectedRevision
      : pending.expectedRevision;

    try {
      const sharedResult = await window.sharedFilesAPI?.updateContent(
        pending.sharedId,
        pending.content,
        expectedRevision,
        pending.documentPath,
      );
      if (sharedResult?.ok && sharedResult.cachePath && sharedResult.cachePath === pending.documentPath) {
        const refreshed = await window.externalAPI?.open(sharedResult.cachePath);
        if (activeReadingPathRef.current === pending.documentPath && refreshed?.documentVersion) {
          lastSavedVersionRef.current = refreshed.documentVersion;
        }
      }
      if (sharedResult?.revision !== undefined) {
        setSharedFileStatus((prev) => {
          if (!prev || prev.sharedId !== pending.sharedId) return prev;
          return { ...prev, revision: sharedResult.revision, cachePath: sharedResult.cachePath ?? prev.cachePath };
        });
      }
      if (sharedResult?.conflictPath) {
        console.warn('[Librarian] River edit saved as private conflict copy:', sharedResult.conflictPath);
      }
    } catch (error) {
      shouldRetryPending = true;
      console.warn('[Librarian] River background sync failed:', error);
    } finally {
      if (shouldRetryPending && !sharedContentSyncRef.current) {
        sharedContentSyncRef.current = pending;
      }
      sharedContentSyncInFlightRef.current = false;
      if (sharedContentSyncRef.current && sharedContentSyncTimerRef.current === null) {
        sharedContentSyncTimerRef.current = window.setTimeout(() => {
          sharedContentSyncTimerRef.current = null;
          void runSharedContentSync();
        }, 1200);
      }
    }
  }, []);

  const scheduleSharedContentSync = useCallback((status: SharedFileStatus | null | undefined, content: string) => {
    if (!status?.shared || !status.sharedId) return;
    sharedContentSyncRef.current = {
      sharedId: status.sharedId,
      content,
      expectedRevision: status.revision ?? 0,
      documentPath: activeReadingPathRef.current,
    };
    if (sharedContentSyncTimerRef.current !== null) {
      window.clearTimeout(sharedContentSyncTimerRef.current);
    }
    sharedContentSyncTimerRef.current = window.setTimeout(() => {
      sharedContentSyncTimerRef.current = null;
      void runSharedContentSync();
    }, 1200);
  }, [runSharedContentSync]);

  useEffect(() => () => {
    if (sharedContentSyncTimerRef.current !== null) {
      window.clearTimeout(sharedContentSyncTimerRef.current);
      sharedContentSyncTimerRef.current = null;
    }
    sharedContentSyncRef.current = null;
  }, []);

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
  const [bookmarksEverShown, setBookmarksEverShown] = useState<boolean>(() => initialSelection?.type === 'bookmarks');
  const [emberEverShown, setEmberEverShown] = useState<boolean>(() => initialSelection?.type === 'ember');
  const [wikiSelectedRelPath, setWikiSelectedRelPath] = useState<string | null>(() => initialSelection?.type === 'wiki' ? initialSelection.relPath : null);
  const [wikiSelectedPage, setWikiSelectedPage] = useState<Reading | null>(null);
  // Local agent kickoff modal — opened by the toolbar agent button. Dispatches
  // the user's locally-installed Claude Code or Codex CLI against the active
  // markdown file and appends a summary footer on success.
  const [agentKickoffOpen, setAgentKickoffOpen] = useState(false);
  const [inlineDrawInsertion, setInlineDrawInsertion] = useState<InlineDrawInsertion | null>(null);
  const [inlineDrawSaving, setInlineDrawSaving] = useState(false);
  const [activeMeetingSession, setActiveMeetingSession] = useState<MeetingToolbarSession | null>(null);
  const [meetingToolbarBusy, setMeetingToolbarBusy] = useState(false);
  // External markdown files opened via macOS file-association (`open-file`)
  // whose canonical path falls outside the wiki root. Stored in Reading shape
  // so activeReading can unify over it; save branches on selectedItemType.
  const [externalOpenFile, setExternalOpenFile] = useState<Reading | null>(null);
  // Flat list of every wiki page for resolving [[wikilinks]] by title or
  // relPath. Refreshed from getTree() on mount and on `onPageChanged`.
  const [wikiIndexPages, setWikiIndexPages] = useState<WikiIndexInput[]>([]);
  const [markdownLinkRelationDocuments, setMarkdownLinkRelationDocuments] = useState<MarkdownLinkRelationDocument[]>([]);
  const [commandIndexPages, setCommandIndexPages] = useState<WikiIndexInput[]>([]);
  const wikiIndexRef = useRef<ReturnType<typeof buildWikiIndex> | null>(null);
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
  // file is a no-op — preserves the editor's undo stack.
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
    setContentMode(getLibraryDocumentDefaultContentMode(getLibraryDocumentViewKind(file.path, 'external')));
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
    if (selectedItemType === 'ember') {
      return { itemType: 'ember', itemPath: EMBER_ITEM_ID };
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
    } else if (entry.itemType === 'ember') {
      setSelectedItemId(EMBER_ITEM_ID);
      setSelectedItemType('ember');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
      setExternalOpenFile(null);
      setContentMode('rendered');
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
    persistLibrarianMaxwellItems(localStorage, maxwellItems);
  }, [maxwellItems]);

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
    const syncRenderedTextCursorStyle = () => setRenderedTextCursorStyle(restoreRenderedTextCursorStyle(localStorage));
    window.addEventListener('storage', syncRenderedTextCursorStyle);
    window.addEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, syncRenderedTextCursorStyle);
    return () => {
      window.removeEventListener('storage', syncRenderedTextCursorStyle);
      window.removeEventListener(RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT, syncRenderedTextCursorStyle);
    };
  }, []);

  useEffect(() => {
    const syncRenderedBlockCursorOpacity = () => setRenderedBlockCursorOpacity(restoreRenderedBlockCursorOpacity(localStorage));
    window.addEventListener('storage', syncRenderedBlockCursorOpacity);
    window.addEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, syncRenderedBlockCursorOpacity);
    return () => {
      window.removeEventListener('storage', syncRenderedBlockCursorOpacity);
      window.removeEventListener(RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT, syncRenderedBlockCursorOpacity);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LINE_NUMBERS_STORAGE_KEY, lineNumbersMode);
  }, [lineNumbersMode]);

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
    if (selectedItemType === 'ember' && !emberEverShown) {
      setEmberEverShown(true);
    }
  }, [selectedItemType, bookmarksEverShown, emberEverShown]);

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
    if (selectedItemType === 'ember') {
      persistLibrarianSelection(localStorage, { type: 'ember' });
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
    const previous = previousSidebarCollapsedRef.current;
    if (previous !== sidebarCollapsed) {
      if (!sidebarCollapsed && responsivePanelState.autoCollapseSidebar) {
        setSuppressAutoCollapseSidebar(true);
      }
      if (sidebarCollapsed) {
        setSuppressAutoCollapseSidebar(false);
      }
      previousSidebarCollapsedRef.current = sidebarCollapsed;
      return;
    }
    if (!responsivePanelState.autoCollapseSidebar) {
      setSuppressAutoCollapseSidebar(false);
    }
  }, [responsivePanelState.autoCollapseSidebar, sidebarCollapsed]);

  useEffect(() => {
    if (!responsivePanelState.autoHideTerminal) {
      setSuppressAutoHideTerminal(false);
    }
  }, [responsivePanelState.autoHideTerminal]);

  useEffect(() => {
    if (!canUseFocusImmersive && focusChromeEnabled === undefined) setFocusImmersive(false);
  }, [canUseFocusImmersive, focusChromeEnabled, setFocusImmersive]);

  useEffect(() => {
    onFocusChromeActiveChange?.(active && focusChromeActive);
  }, [active, focusChromeActive, onFocusChromeActiveChange]);

  useLayoutEffect(() => {
    let frame: number | null = null;
    let settleTimer: number | null = null;
    const refreshEditorLayout = () => {
      markdownCodeEditorRef.current?.refreshLayout();
      renderedMarkdownEditorRef.current?.refreshLayout();
      updateMarkdownEditorFades(markdownCodeEditorRef.current);
      updateRenderedDocumentTopFade(contentScrollRef.current);
    };
    const updateResponsivePanelSize = () => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      const width = Math.round(containerRect.width);
      const height = Math.round(containerRect.height);
      setResponsivePanelSize((previous) => {
        if (previous.width === width && previous.height === height) return previous;
        return { width, height };
      });
    };
    const updateCenter = () => {
      frame = null;
      updateResponsivePanelSize();
      refreshEditorLayout();
      if (!active || !focusChromeActive) {
        onFocusChromeContentCenterChange?.(null);
        return;
      }
      const readerPane = readerPaneRef.current;
      if (!readerPane) return;
      const readerRect = readerPane.getBoundingClientRect();
      const terminalRect = readerPane
        .querySelector<HTMLElement>('[data-ft-codex-terminal-panel="true"]')
        ?.getBoundingClientRect() ?? null;
      onFocusChromeContentCenterChange?.(getFocusChromeContentCenterX({
        readerLeft: readerRect.left,
        readerRight: readerRect.right,
        terminalLeft: terminalRect?.left ?? null,
        terminalDockedRight: effectiveCodexTerminalDockSide === 'right',
        terminalVisible: effectiveCodexTerminalVisible,
      }));
    };
    const scheduleUpdateCenter = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(updateCenter);
    };
    const scheduleSettledUpdate = () => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        scheduleUpdateCenter();
      }, 80);
    };
    const scheduleResizeUpdate = () => {
      scheduleUpdateCenter();
      scheduleSettledUpdate();
    };

    updateCenter();
    scheduleUpdateCenter();
    const resizeObserver = new ResizeObserver(scheduleResizeUpdate);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    if (readerPaneRef.current) resizeObserver.observe(readerPaneRef.current);
    for (const element of readerPaneRef.current?.querySelectorAll<HTMLElement>('[data-ft-codex-terminal-panel="true"]') ?? []) {
      resizeObserver.observe(element);
    }
    window.addEventListener('resize', scheduleResizeUpdate);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleResizeUpdate);
    };
  }, [active, effectiveCodexTerminalDockSide, effectiveCodexTerminalVisible, focusChromeActive, onFocusChromeContentCenterChange, updateMarkdownEditorFades, updateRenderedDocumentTopFade]);

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
  const documentMaxWidth = resolveLibrarianDocumentMaxWidth(typographyPreset.maxWidth, textSize);

  const activeReading: Reading | null =
    selectedItemType === 'wiki' ? wikiSelectedPage :
    selectedItemType === 'external' ? externalOpenFile :
    selectedReading;
  const activeReadingPath = activeReading?.path ?? null;
  const activeDocumentKind = getLibraryDocumentViewKind(activeReadingPath, selectedItemType);
  const activeIsMarkdownDocument = activeDocumentKind === 'markdown';
  const activeIsHtmlDocument = activeDocumentKind === 'html';
  const activeIsSourceOnlyDocument = activeDocumentKind === 'css';
  const sidebarHidden = isFullScreen;
  const latestRenderedContent = latestRenderedContentRef.current;
  const activeReadingContent = activeReadingPath && latestRenderedContent?.path === activeReadingPath
    ? latestRenderedContent.content
    : activeReading?.content ?? null;
  const codexTerminalPageContext = useMemo<CodexTerminalPageContextInput | null>(() => {
    if (!activeReading) return null;
    const kind: CodexTerminalPageContextInput['kind'] =
      selectedItemType === 'wiki' || selectedItemType === 'artifact' || selectedItemType === 'external'
        ? selectedItemType
        : 'unknown';
    const selectionText = window.getSelection()?.toString().trim() || undefined;
    return {
      title: activeReading.title,
      path: activeReading.path,
      kind,
      contentMode,
      content: contentMode === 'markdown' ? editContent : activeReadingContent ?? activeReading.content,
      selectionText,
    };
  }, [activeReading, activeReadingContent, contentMode, editContent, selectedItemType]);
  useLayoutEffect(() => {
    pendingScrollRatioRef.current = null;
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
      updateRenderedDocumentTopFade(contentScrollRef.current);
    }
    if (markdownCodeEditorRef.current) {
      markdownCodeEditorRef.current.scrollTop = 0;
      updateMarkdownEditorFades(markdownCodeEditorRef.current);
    }
  }, [activeReadingPath, updateMarkdownEditorFades, updateRenderedDocumentTopFade]);
  const activeMaxwellItem = useMemo<LibrarianMaxwellItem | null>(() => {
    if (!activeReading || !activeReadingPath || !activeIsMarkdownDocument) return null;
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      return {
        id: `wiki:${wikiSelectedRelPath}`,
        type: 'wiki',
        title: activeReading.title,
        path: activeReadingPath,
        relPath: wikiSelectedRelPath,
      };
    }
    if (selectedItemType === 'artifact') {
      return {
        id: `artifact:${activeReadingPath}`,
        type: 'artifact',
        title: activeReading.title,
        path: activeReadingPath,
      };
    }
    if (selectedItemType === 'external') {
      return {
        id: `external:${activeReadingPath}`,
        type: 'external',
        title: activeReading.title,
        path: activeReadingPath,
      };
    }
    return null;
  }, [activeIsMarkdownDocument, activeReading, activeReadingPath, selectedItemType, wikiSelectedRelPath]);
  const showSelectPageState = useCallback(() => {
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
  const openDocumentTargetInWindow = useCallback((
    target: { kind: 'wiki' | 'artifact' | 'external'; path: string; contentMode?: MarkdownContentMode; sidebarCollapsed?: boolean },
    clearSource = true
  ) => {
    void (async () => {
      await flushCurrentEdit();
      const result = await window.libraryAPI?.openDocumentWindow?.(target);
      if (clearSource && result?.success) showSelectPageState();
    })();
  }, [flushCurrentEdit, showSelectPageState]);
  const openActiveDocumentInWindow = useCallback(() => {
    if (!activeReadingPath) return;
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      openDocumentTargetInWindow({ kind: 'wiki', path: wikiSelectedRelPath, contentMode });
      return;
    }
    if (selectedItemType === 'artifact') {
      openDocumentTargetInWindow({ kind: 'artifact', path: activeReadingPath, contentMode });
      return;
    }
    if (selectedItemType === 'external') {
      openDocumentTargetInWindow({ kind: 'external', path: activeReadingPath, contentMode });
    }
  }, [activeReadingPath, contentMode, openDocumentTargetInWindow, selectedItemType, wikiSelectedRelPath]);
  const isSidebarItemActiveDocument = useCallback((item: UnifiedItem): boolean => {
    if (item.type === 'wiki') return selectedItemType === 'wiki' && item.relPath === wikiSelectedRelPath;
    if (item.type === 'artifact') return selectedItemType === 'artifact' && item.absPath === activeReadingPath;
    if (item.type === 'external') return selectedItemType === 'external' && item.absPath === activeReadingPath;
    return false;
  }, [activeReadingPath, selectedItemType, wikiSelectedRelPath]);
  const maxwellToolbarItems = useMemo(() => maxwellItems.map((item) => ({
    id: item.id,
    title: item.title,
    subtitle: item.relPath ?? item.path,
  })), [maxwellItems]);
  const addActivePageToMaxwell = useCallback(() => {
    if (!activeMaxwellItem) return;
    setMaxwellItems((prev) => [
      activeMaxwellItem,
      ...prev.filter((item) => item.id !== activeMaxwellItem.id),
    ].slice(0, 20));
  }, [activeMaxwellItem]);
  const removeMaxwellItem = useCallback((id: string) => {
    setMaxwellItems((prev) => prev.filter((item) => item.id !== id));
  }, []);
  const visitMaxwellItem = useCallback((id: string) => {
    const item = maxwellItems.find((candidate) => candidate.id === id);
    if (!item) return;
    void (async () => {
      await flushCurrentEdit();
      if (item.type === 'wiki' && item.relPath) {
        openWikiPage(item.relPath);
      } else if (item.type === 'artifact') {
        selectArtifactPath(item.path);
      } else {
        await selectExternalFile(item.path);
      }
      setContentMode('rendered');
    })();
  }, [flushCurrentEdit, maxwellItems, openWikiPage, selectArtifactPath, selectExternalFile]);
  const getActiveMaxwellSelection = useCallback((): MaxwellToolbarSelection => {
    const editor = contentModeRef.current === 'markdown'
      ? markdownCodeEditorRef.current
      : renderedMarkdownEditorRef.current;
    const selection = editor?.getSelectionRange() ?? null;
    if (!selection) return null;
    return { start: selection.start, end: selection.end };
  }, []);
  const runMaxwellItem = useCallback((id: string) => {
    const item = maxwellItems.find((candidate) => candidate.id === id);
    if (!item) return;
    void (async () => {
      let instruction: string | null = null;
      if (item.type === 'wiki' && item.relPath) {
        instruction = (await window.wikiAPI?.getPage(item.relPath))?.content ?? null;
      } else if (item.type === 'artifact') {
        instruction = (await window.librarianAPI?.getReading(item.path))?.content ?? null;
      } else {
        instruction = (await window.externalAPI?.open(item.path))?.content ?? null;
      }
      const trimmed = instruction?.trim();
      if (!trimmed) return;
      await window.commandsAPI?.runLocalCommand?.({
        customInstruction: trimmed,
        ...getMaxwellToolbarRunMode(getActiveMaxwellSelection()),
      });
    })().catch((err) => {
      console.warn('[Librarian] Maxwell toolbar run failed:', err);
    });
  }, [getActiveMaxwellSelection, maxwellItems]);
  const activeReadingToolbarHasBreadcrumb = !focusChromeActive
    && (selectedItemType === 'wiki' || selectedItemType === 'external')
    && Boolean(activeReadingPath);
  const meetingToolbarStatus = activeMeetingSession?.status ?? 'idle';
  const meetingToolbarRecording = meetingToolbarStatus === 'recording';
  const meetingToolbarFinalizing = meetingToolbarStatus === 'starting'
    || meetingToolbarStatus === 'transcribing'
    || meetingToolbarStatus === 'summarizing';
  const meetingToolbarVisible = focusToolbarControlsVisible
    && activeIsMarkdownDocument
    && Boolean(activeReadingPath)
    && (selectedItemType === 'wiki' || selectedItemType === 'external');
  const meetingToolbarDisabled = meetingToolbarBusy || meetingToolbarFinalizing;
  const meetingToolbarTitle = meetingToolbarFinalizing
    ? 'Meeting recording is finalizing'
    : meetingToolbarRecording ? 'Stop meeting recording' : 'Start meeting recording';
  const showActiveReadingInFolder = () => {
    if (activeReadingPath) {
      window.shellAPI?.showItemInFolder(activeReadingPath);
    }
  };
  const handleMeetingToolbarClick = useCallback(async () => {
    setMeetingToolbarBusy(true);
    try {
      const result = meetingToolbarRecording
        ? await window.commandsAPI?.stopMeeting?.()
        : await window.commandsAPI?.startMeetingHere?.();
      if (!result) {
        console.warn('[Librarian] Meeting toolbar action is unavailable');
        return;
      }
      if (!result.success) {
        console.warn('[Librarian] Meeting toolbar action failed:', result.error ?? result.summaryError);
        return;
      }
      setActiveMeetingSession(isMeetingToolbarActiveSession(result.session) ? result.session : null);
    } catch (err) {
      console.warn('[Librarian] Meeting toolbar action failed:', err);
    } finally {
      setMeetingToolbarBusy(false);
    }
  }, [meetingToolbarRecording]);
  activeReadingPathRef.current = activeReadingPath;
  const liveRenderedReadingContent = contentMode === 'rendered'
    && renderedEditingActive
    && activeReadingPath
    && latestRenderedContentRef.current?.path === activeReadingPath
    ? latestRenderedContentRef.current.content
    : activeReadingContent;
  activeReadingContentRef.current = liveRenderedReadingContent;
  if (typeof liveRenderedReadingContent === 'string' && liveRenderedReadingContent !== activeReadingContent) {
    editContentRef.current = liveRenderedReadingContent;
  }
  const renderedDisplayReadingContent = getRenderedDisplayReadingContent({
    contentMode,
    renderedEditingActive,
    activeReadingPath,
    renderedDisplayContent: renderedDisplayContentRef.current,
    activeReadingContent,
  });
  const activeTitlePath =
    activeReading && (selectedItemType === 'wiki' || selectedItemType === 'external')
      ? activeReading.path
      : null;

  useEffect(() => {
    onActiveFileUpdatedChange?.(activeReading
      ? { path: activeReading.path, title: activeReading.title, mtime: activeReading.mtime }
      : null);
  }, [activeReading?.mtime, activeReading?.path, activeReading?.title, onActiveFileUpdatedChange]);

  useEffect(() => {
    if (activeIsSourceOnlyDocument && contentMode !== 'markdown') {
      setContentMode('markdown');
    }
  }, [activeIsSourceOnlyDocument, contentMode]);

  useEffect(() => {
    if (!active || !activeReading || !activeIsMarkdownDocument || (selectedItemType !== 'wiki' && selectedItemType !== 'external' && selectedItemType !== 'artifact')) {
      void window.commandsAPI?.setActiveLibraryFileContext?.(null);
      return;
    }

    const sidebarItem = flatItemsRef.current.find((item) => (
      item.id === selectedItemId || item.absPath === activeReading.path
    ));
    if (!sidebarItem?.rootPath || !sidebarItem.relPath || (sidebarItem.type !== 'wiki' && sidebarItem.type !== 'external')) {
      if (selectedItemType === 'wiki' && wikiSelectedRelPath && activeReading.path) {
        void window.commandsAPI?.setActiveLibraryFileContext?.({
          type: 'wiki',
          rootPath: '',
          relPath: wikiSelectedRelPath,
          filePath: activeReading.path,
          title: activeReading.title,
        });
        return;
      }
      if (selectedItemType === 'external' && activeReading.path) {
        void window.commandsAPI?.setActiveLibraryFileContext?.({
          type: 'external',
          rootPath: '',
          relPath: activeReading.path,
          filePath: activeReading.path,
          title: activeReading.title,
        });
        return;
      }
      if (selectedItemType === 'artifact' && activeReading.path) {
        void window.commandsAPI?.setActiveLibraryFileContext?.({
          type: 'external',
          rootPath: '',
          relPath: activeReading.path,
          filePath: activeReading.path,
          title: activeReading.title,
        });
        return;
      }
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
  }, [active, activeIsMarkdownDocument, activeReading?.path, activeReading?.title, selectedItemId, selectedItemType, wikiSelectedRelPath]);

  useEffect(() => {
    if (!active) {
      setActiveMeetingSession(null);
      return;
    }

    let cancelled = false;
    const updateActiveMeetingSession = (session: MeetingToolbarSession | null | undefined) => {
      if (!cancelled) {
        setActiveMeetingSession(isMeetingToolbarActiveSession(session) ? session : null);
      }
    };

    void window.commandsAPI?.getActiveMeeting?.().then(updateActiveMeetingSession).catch((err) => {
      console.warn('[Librarian] Failed to read active meeting session:', err);
    });
    const unsubscribe = window.commandsAPI?.onMeetingStatus?.(updateActiveMeetingSession);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [active]);

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

  const focusActiveDocumentBody = useCallback(() => {
    if (contentMode !== 'markdown') {
      const currentContent = activeReadingContentRef.current ?? activeReading?.content ?? '';
      const bodyEnd = removeEmptyMarkdownCommentPlaceholders(splitFrontmatter(currentContent).body).length;
      const selection = { start: bodyEnd, end: bodyEnd };
      pendingRenderedEditorSelectionRef.current = selection;
      activateRenderedEditing();
      requestAnimationFrame(() => {
        const editor = renderedMarkdownEditorRef.current;
        if (!editor) return;
        const valueLength = editor.getValue().length;
        const offset = Math.max(0, Math.min(bodyEnd, valueLength));
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(offset, offset);
        activeRenderedCaretOffsetRef.current = offset;
      });
      return;
    }
    requestAnimationFrame(() => {
      markdownCodeEditorRef.current?.focus({ preventScroll: true });
    });
  }, [activeReading?.content, activateRenderedEditing, contentMode]);

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
      if (options.focusBody) focusActiveDocumentBody();
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

    if (options.focusBody) focusActiveDocumentBody();
  }, [
    activateRenderedEditing,
    activeReading,
    activeTitlePath,
    focusActiveDocumentBody,
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

  const rememberSavedDocumentContent = useCallback((
    targetPath: string | null,
    content: string,
    version: DocumentVersion | null,
  ) => {
    if (targetPath) {
      latestRenderedContentRef.current = { path: targetPath, content };
    }
    if (activeReadingPathRef.current === targetPath) {
      activeReadingContentRef.current = content;
      editContentRef.current = content;
    }
    lastSavedContentRef.current = content;
    if (version) lastSavedVersionRef.current = version;
  }, []);

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
    rememberSavedDocumentContent(targetPath, content, version);

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

    const relationTarget: WikiLinkTarget | null = targetType === 'wiki' && wikiSelectedRelPath
      ? { kind: 'wiki', relPath: wikiSelectedRelPath }
      : targetType === 'artifact' && targetPath
        ? { kind: 'artifact', path: targetPath }
        : null;
    const currentWikiIndex = wikiIndexRef.current;
    if (relationTarget && currentWikiIndex) {
      setMarkdownLinkRelationDocuments((prev) => upsertMarkdownLinkRelationDocument(prev, {
        target: relationTarget,
        title: fallbackTitle,
        content,
        linkHits: getMarkdownEditorLinkHits(content, currentWikiIndex),
      }));
    }

  }, [rememberSavedDocumentContent, wikiSelectedRelPath]);

  const handleSidebarItemContentChanged = useCallback((item: UnifiedItem, content: string, version: DocumentVersion | null) => {
    if (item.type !== 'wiki' && item.type !== 'external') return;
    if (activeReadingPathRef.current !== item.absPath) return;

    applySavedDocumentState(item.type, item.absPath, content, version, item.title);
    setEditContent(contentModeRef.current === 'markdown'
      ? removeEmptyMarkdownCommentPlaceholders(content)
      : content);
  }, [applySavedDocumentState]);

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

  const applyLiveDiskDocumentState = useCallback((
    targetType: LibrarianSelectedItemType,
    targetPath: string | null,
    reading: Reading,
  ): boolean => {
    if (documentVersionsEqual(reading.documentVersion, lastSavedVersionRef.current)) {
      return false;
    }

    const currentContentMode = contentModeRef.current;
    if (!shouldApplyLiveMarkdownFileUpdate({
      contentMode: currentContentMode,
      editContent: editContentRef.current,
      lastSavedContent: lastSavedContentRef.current,
      hasPendingRenderedSave: pendingRenderedSaveRef.current !== null,
      hasRenderedSaveInFlight: renderedSaveInFlightRef.current > 0,
    })) {
      return false;
    }

    if (currentContentMode === 'rendered' && targetPath) {
      renderedDisplayContentRef.current = { path: targetPath, content: reading.content };
    }
    applySavedDocumentState(targetType, targetPath, reading.content, reading.documentVersion, reading.title);
    const nextEditContent = currentContentMode === 'markdown'
      ? removeEmptyMarkdownCommentPlaceholders(reading.content)
      : reading.content;
    setEditContent(nextEditContent);
    if (currentContentMode === 'markdown') {
      lastSavedContentRef.current = nextEditContent;
    }
    return true;
  }, [applySavedDocumentState]);

  const refreshActiveAgentFile = useCallback(async (filePath: string) => {
    if (activeReading?.path !== filePath) return;

    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (!page || page.absPath !== filePath) return;
      const reading = readingFromWikiPage(page);
      applyLiveDiskDocumentState('wiki', reading.path, reading);
      return;
    }

    if (selectedItemType === 'external') {
      const file = await window.externalAPI?.open(filePath);
      if (!file) return;
      const reading = readingFromExternalMarkdownFile(file);
      applyLiveDiskDocumentState('external', reading.path, reading);
    }
  }, [activeReading?.path, applyLiveDiskDocumentState, selectedItemType, wikiSelectedRelPath]);

  const refreshActiveDiskDocument = useCallback(async () => {
    const activePath = activeReading?.path;
    if (!activePath) return;

    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      const page = await window.wikiAPI?.getPage(wikiSelectedRelPath);
      if (!page || page.absPath !== activePath) return;
      const reading = readingFromWikiPage(page);
      applyLiveDiskDocumentState('wiki', reading.path, reading);
      return;
    }

    if (selectedItemType === 'external') {
      const file = await window.externalAPI?.open(activePath);
      if (!file) return;
      const reading = readingFromExternalMarkdownFile(file);
      applyLiveDiskDocumentState('external', reading.path, reading);
      return;
    }

    if (selectedItemType === 'artifact' && selectedPath) {
      const reading = await window.librarianAPI?.getReading(selectedPath);
      if (!reading) return;
      applyLiveDiskDocumentState('artifact', reading.path, reading);
    }
  }, [activeReading?.path, applyLiveDiskDocumentState, selectedItemType, selectedPath, wikiSelectedRelPath]);

  useEffect(() => {
    const unsubscribe = window.agentKickoffAPI?.onStatus((event) => {
      void refreshActiveAgentFile(event.absPath);
    });
    return () => unsubscribe?.();
  }, [refreshActiveAgentFile]);

  useEffect(() => {
    if (
      !active
      || !activeReading?.path
      || (selectedItemType !== 'wiki' && selectedItemType !== 'external' && selectedItemType !== 'artifact')
    ) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void refreshActiveDiskDocument();
    };
    refresh();
    const intervalId = window.setInterval(refresh, ACTIVE_MARKDOWN_FILE_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [active, activeReading?.path, refreshActiveDiskDocument, selectedItemType]);

  useEffect(() => {
    if (!activeReading || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) return;
    updateSelectedSidebarTodoState(splitFrontmatter(activeReading.content).todoState);
  }, [activeReading, selectedItemType, updateSelectedSidebarTodoState]);

  const clearSelectedLibraryItem = useCallback(() => {
    showSelectPageState();
  }, [showSelectPageState]);

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
  const activeReadingToolbarIdentityVisible = activeReadingToolbarHasBreadcrumb || topFadeActive;
  const activeReadingToolbarIdentityPinned = topFadeActive && focusChromeActive;
  const activeReadingBreadcrumbLabel = selectedItemType === 'wiki' || selectedItemType === 'external'
    ? formatBreadcrumb(selectedItemType, activeReading, wikiSelectedRelPath)
    : selectedItemType === 'artifact'
      ? 'Artifact'
      : '';

  const markdownDisplay = useMemo(() => {
    if (!activeIsMarkdownDocument || (selectedItemType !== 'wiki' && selectedItemType !== 'external' && selectedItemType !== 'artifact') || !activeReading) return null;
    return splitFrontmatter(renderedDisplayReadingContent ?? activeReading.content);
  }, [activeIsMarkdownDocument, selectedItemType, activeReading, renderedDisplayReadingContent]);

  const wikiIndex = useMemo(() => buildWikiIndex([
    ...wikiIndexPages,
    ...readings.map((reading) => ({
      relPath: reading.path,
      title: reading.title,
      artifactPath: reading.path,
    })),
    ...commandIndexPages,
  ]), [commandIndexPages, readings, wikiIndexPages]);
  wikiIndexRef.current = wikiIndex;

  const activeMarkdownLinkTarget = useMemo<WikiLinkTarget | null>(() => {
    if (selectedItemType === 'wiki' && wikiSelectedRelPath) {
      return { kind: 'wiki', relPath: wikiSelectedRelPath };
    }
    if (selectedItemType === 'artifact' && activeReading?.path) {
      return { kind: 'artifact', path: activeReading.path };
    }
    return null;
  }, [activeReading?.path, selectedItemType, wikiSelectedRelPath]);

  const linkedDocumentsResult = useMemo<{
    links: MarkdownLinkedDocument[];
    timing: Record<string, unknown>;
  }>(() => {
    const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    const emptyTiming = (reason: string): Record<string, unknown> => ({
      stage: 'linked-documents-compute',
      durationMs: startedAt > 0 ? performance.now() - startedAt : null,
      reason,
      linkCount: 0,
      relationDocumentCount: markdownLinkRelationDocuments.length,
      contentLength: activeReadingContent?.length ?? activeReading?.content.length ?? 0,
    });
    if (!activeReading || !activeIsMarkdownDocument || selectedItemType === 'bookmarks' || selectedItemType === 'ember') {
      return { links: [], timing: emptyTiming('inactive') };
    }
    const links = getMarkdownLinkedDocuments(
      activeMarkdownLinkTarget,
      activeReadingContent ?? activeReading.content,
      markdownLinkRelationDocuments,
      wikiIndex,
    );
    return {
      links,
      timing: {
        stage: 'linked-documents-compute',
        durationMs: startedAt > 0 ? performance.now() - startedAt : null,
        linkCount: links.length,
        relationDocumentCount: markdownLinkRelationDocuments.length,
        contentLength: (activeReadingContent ?? activeReading.content).length,
      },
    };
  }, [
    activeMarkdownLinkTarget,
    activeReading,
    activeReadingContent,
    activeIsMarkdownDocument,
    markdownLinkRelationDocuments,
    selectedItemType,
    wikiIndex,
  ]);
  const linkedDocuments = linkedDocumentsResult.links;
  useEffect(() => {
    if (!renderedEditorDebugEnabledRef.current) return;
    recordRenderedEditorDebug('typing-hotpath', linkedDocumentsResult.timing);
  }, [linkedDocumentsResult, recordRenderedEditorDebug]);

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

  const rawDisplaySourceBody = markdownDisplay ? markdownDisplay.body : (renderedDisplayReadingContent ?? activeReading?.content ?? '');
  const displaySourceBody = useMemo(() => (
    removeEmptyMarkdownCommentPlaceholders(rawDisplaySourceBody)
  ), [rawDisplaySourceBody]);
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
              linkHits: getMarkdownEditorLinkHits(fullPage.content, wikiIndex),
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
              linkHits: getMarkdownEditorLinkHits(fullReading.content, wikiIndex),
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
              linkHits: getMarkdownEditorLinkHits(fullCommand.content, wikiIndex),
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
  }, [active, commandIndexPages, readings, wikiIndex, wikiIndexPages]);

  const flushPendingCopiedImageDeletes = useCallback((documentPath: string, remainingContent: string) => {
    const pending = pendingCopiedImageDeletesRef.current;
    const matching = pending.filter((item) => item.documentPath === documentPath);
    if (matching.length === 0) return;
    pendingCopiedImageDeletesRef.current = pending.filter((item) => item.documentPath !== documentPath);
    void window.markdownImagesAPI?.deleteUnusedCopiedImages(
      documentPath,
      matching.flatMap((item) => item.markdownImages).join('\n'),
      remainingContent,
    );
  }, []);

  const saveRenderedContent = useCallback(async (nextContent: string) => {
    const saveStartedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    if (!activeReading) {
      recordRenderedEditorDebug('save-skipped', { reason: 'no-active-reading' });
      return;
    }
    let normalizedContent = removeEmptyMarkdownCommentPlaceholders(nextContent);
    const expectedVersion = lastSavedVersionRef.current ?? activeReading.documentVersion;
    const targetType = selectedItemType;
    const targetPath = activeReading.path;
    const targetTitle = activeReading.title;
    const targetSharedFileStatus = sharedFileStatus;
    const deferReactState = contentModeRef.current === 'rendered'
      && renderedEditingActiveRef.current
      && activeReadingPathRef.current === targetPath;
    recordRenderedEditorDebug('save-start', {
      targetType,
      contentLength: normalizedContent.length,
      expectedVersion,
      deferReactState,
      cursor: getRenderedCursorDebugState('save-start'),
    });
    if (!deferReactState) setSaveStatus('saving');
    renderedSaveInFlightRef.current += 1;
    try {
      const previousSavedContent = lastSavedContentRef.current;
      const portableImagesChanged = markdownPortableImagesChanged(previousSavedContent, normalizedContent);
      if (portableImagesChanged) {
        const portableImagesStartedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
        const portableResult = await window.markdownImagesAPI?.makeImagesPortable(targetPath, normalizedContent);
        normalizedContent = portableResult?.content ?? normalizedContent;
        recordRenderedEditorDebug('save-phase', {
          stage: 'portable-images',
          durationMs: portableImagesStartedAt > 0 ? performance.now() - portableImagesStartedAt : null,
          copied: portableResult?.copied ?? 0,
          rewritten: portableResult?.rewritten ?? 0,
          missing: portableResult?.missing ?? 0,
          contentLength: normalizedContent.length,
        });
      } else {
        recordRenderedEditorDebug('save-phase', {
          stage: 'portable-images-skipped',
          durationMs: 0,
          reason: markdownContentMayNeedPortableImages(normalizedContent)
            ? 'image-references-unchanged'
            : 'no-markdown-images',
          previousContentLength: previousSavedContent?.length ?? null,
          contentLength: normalizedContent.length,
        });
      }
      let result: DocumentSaveResult | null | undefined;
      let overwrite: (version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>;
      const documentSaveStartedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
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
        recordRenderedEditorDebug('save-skipped', { reason: 'no-target-path', targetType });
        return;
      }
      recordRenderedEditorDebug('save-phase', {
        stage: 'document-save',
        durationMs: documentSaveStartedAt > 0 ? performance.now() - documentSaveStartedAt : null,
        targetType,
        resultOk: isDocumentSaveOk(result),
        resultReason: result && !isDocumentSaveOk(result) ? result.reason : null,
      });

      if (isDocumentSaveConflict(result)) {
        recordRenderedEditorDebug('save-conflict', { targetType });
        const resolved = await resolveSaveConflict(result, targetType, targetPath, normalizedContent, targetTitle, overwrite);
        setSaveStatus(resolved ? 'saved' : 'idle');
        recordRenderedEditorDebug('save-conflict-resolved', { resolved });
        return;
      }
      if (!isDocumentSaveOk(result)) throw new Error('save failed');
      const nextVersion = getDocumentSaveVersion(result);
      const currentSharedFileStatus = sharedFileStatusPathRef.current === targetPath
        ? sharedFileStatusRef.current
        : targetSharedFileStatus;
      scheduleSharedContentSync(currentSharedFileStatus, normalizedContent);
      if (deferReactState) {
        rememberSavedDocumentContent(targetPath, normalizedContent, nextVersion);
        flushPendingCopiedImageDeletes(targetPath, normalizedContent);
        recordRenderedEditorDebug('save-ok', {
          stage: 'save-rendered-content',
          durationMs: saveStartedAt > 0 ? performance.now() - saveStartedAt : null,
          targetType,
          nextVersion,
          deferredReactState: true,
          cursor: getRenderedCursorDebugState('save-ok-deferred'),
        });
        return;
      }
      applySavedDocumentState(targetType, targetPath, normalizedContent, nextVersion, targetTitle);
      setEditContent(normalizedContent);
      setSaveStatus('saved');
      flushPendingCopiedImageDeletes(targetPath, normalizedContent);
      recordRenderedEditorDebug('save-ok', {
        stage: 'save-rendered-content',
        durationMs: saveStartedAt > 0 ? performance.now() - saveStartedAt : null,
        targetType,
        nextVersion,
        cursor: getRenderedCursorDebugState('save-ok'),
      });
    } catch (error) {
      if (!deferReactState) setSaveStatus('idle');
      recordRenderedEditorDebug('save-error', {
        stage: 'save-rendered-content',
        durationMs: saveStartedAt > 0 ? performance.now() - saveStartedAt : null,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      renderedSaveInFlightRef.current = Math.max(0, renderedSaveInFlightRef.current - 1);
    }
  }, [activeReading, applySavedDocumentState, flushPendingCopiedImageDeletes, getRenderedCursorDebugState, recordRenderedEditorDebug, rememberSavedDocumentContent, resolveSaveConflict, scheduleSharedContentSync, selectedItemType, sharedFileStatus, wikiSelectedRelPath]);

  const applyRenderedContentLocalState = useCallback((
    nextContent: string,
    options: { updateRenderedDisplayContent?: boolean; updateReactState?: boolean } = {},
  ) => {
    const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    const normalizedContent = removeEmptyMarkdownCommentPlaceholders(nextContent);
    const activePath = activeReadingPathRef.current;
    const shouldUpdateReactState = options.updateReactState !== false;
    recordRenderedEditorDebug('local-content-state-apply', () => ({
      targetType: selectedItemType,
      activePath,
      nextLength: normalizedContent.length,
      updateRenderedDisplayContent: options.updateRenderedDisplayContent === true,
      updateReactState: shouldUpdateReactState,
      cursorBeforeApply: getRenderedCursorDebugState('local-content-state-before-apply'),
    }));
    if (activePath) {
      latestRenderedContentRef.current = { path: activePath, content: normalizedContent };
      if (options.updateRenderedDisplayContent) {
        renderedDisplayContentRef.current = { path: activePath, content: normalizedContent };
      }
    }
    activeReadingContentRef.current = normalizedContent;
    editContentRef.current = normalizedContent;
    if (!shouldUpdateReactState) {
      if (startedAt > 0) {
        recordRenderedEditorDebug('local-content-state-scheduled', {
          durationMs: performance.now() - startedAt,
          updateRenderedDisplayContent: options.updateRenderedDisplayContent === true,
          updateReactState: shouldUpdateReactState,
          contentLength: normalizedContent.length,
        });
      }
      return;
    }
    if (selectedItemType === 'wiki') {
      setWikiSelectedPage((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    } else if (selectedItemType === 'external') {
      setExternalOpenFile((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    } else {
      setSelectedReading((prev) => prev ? { ...prev, content: normalizedContent } : prev);
    }
    setEditContent(normalizedContent);
    if (startedAt > 0) {
      recordRenderedEditorDebug('local-content-state-scheduled', {
        durationMs: performance.now() - startedAt,
        updateRenderedDisplayContent: options.updateRenderedDisplayContent === true,
        updateReactState: shouldUpdateReactState,
        contentLength: normalizedContent.length,
      });
    }
  }, [getRenderedCursorDebugState, recordRenderedEditorDebug, selectedItemType]);

  const cancelPendingRenderedReactCommit = useCallback(() => {
    if (renderedReactCommitTimerRef.current !== null) {
      window.clearTimeout(renderedReactCommitTimerRef.current);
      renderedReactCommitTimerRef.current = null;
    }
    pendingRenderedReactCommitRef.current = null;
  }, []);

  const scheduleRenderedReactCommit = useCallback((nextContent: string) => {
    const activePath = activeReadingPathRef.current;
    if (!activePath) return;
    if (renderedReactCommitTimerRef.current !== null) {
      window.clearTimeout(renderedReactCommitTimerRef.current);
    }
    pendingRenderedReactCommitRef.current = { path: activePath, content: nextContent };
    recordRenderedEditorDebug('react-state-commit-scheduled', {
      delayMs: 250,
      contentLength: nextContent.length,
    });
    renderedReactCommitTimerRef.current = window.setTimeout(() => {
      renderedReactCommitTimerRef.current = null;
      const pending = pendingRenderedReactCommitRef.current;
      pendingRenderedReactCommitRef.current = null;
      if (!pending) return;
      if (activeReadingPathRef.current !== pending.path) {
        recordRenderedEditorDebug('react-state-commit-skipped', { reason: 'path-changed' });
        return;
      }
      const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
      applyRenderedContentLocalState(pending.content, { updateRenderedDisplayContent: true });
      recordRenderedEditorDebug('react-state-commit-fired', {
        stage: 'react-state-commit',
        durationMs: startedAt > 0 ? performance.now() - startedAt : null,
        contentLength: pending.content.length,
      });
    }, 250);
  }, [applyRenderedContentLocalState, recordRenderedEditorDebug]);

  useEffect(() => () => {
    if (renderedReactCommitTimerRef.current !== null) {
      window.clearTimeout(renderedReactCommitTimerRef.current);
    }
  }, []);

  const flushPendingRenderedSave = useCallback(() => {
    if (renderedSaveTimerRef.current !== null) {
      window.clearTimeout(renderedSaveTimerRef.current);
      renderedSaveTimerRef.current = null;
    }
    const pending = pendingRenderedSaveRef.current;
    pendingRenderedSaveRef.current = null;
    if (pending) recordRenderedEditorDebug('save-flush');
    pending?.();
  }, [recordRenderedEditorDebug]);

  const requestRenderedContentSave = useCallback((nextContent: string) => {
    if (renderedSaveTimerRef.current !== null) {
      window.clearTimeout(renderedSaveTimerRef.current);
    }
    pendingRenderedSaveRef.current = () => {
      void saveRenderedContent(nextContent);
    };
    recordRenderedEditorDebug('save-scheduled', () => ({
      contentLength: nextContent.length,
      delayMs: RENDERED_SAVE_INITIAL_DELAY_MS,
      cursor: getRenderedCursorDebugState('save-scheduled'),
    }));
    const scheduleSaveTimer = (delayMs: number) => {
      renderedSaveTimerRef.current = window.setTimeout(() => {
        renderedSaveTimerRef.current = null;
        const pending = pendingRenderedSaveRef.current;
        if (!pending) return;
        if (contentModeRef.current === 'rendered' && renderedEditingActiveRef.current) {
          const quietForMs = Date.now() - lastRenderedEditAtRef.current;
          if (quietForMs < RENDERED_SAVE_QUIET_DELAY_MS) {
            const nextDelayMs = Math.max(50, RENDERED_SAVE_QUIET_DELAY_MS - quietForMs);
            recordRenderedEditorDebug('save-rescheduled-active-typing', {
              quietForMs,
              delayMs: nextDelayMs,
            });
            scheduleSaveTimer(nextDelayMs);
            return;
          }
        }
        if (renderedSaveInFlightRef.current > 0) {
          recordRenderedEditorDebug('save-rescheduled-in-flight', {
            inFlight: renderedSaveInFlightRef.current,
            delayMs: RENDERED_SAVE_IN_FLIGHT_RETRY_MS,
          });
          scheduleSaveTimer(RENDERED_SAVE_IN_FLIGHT_RETRY_MS);
          return;
        }
        pendingRenderedSaveRef.current = null;
        recordRenderedEditorDebug('save-timer-fired');
        pending();
      }, delayMs);
    };
    scheduleSaveTimer(RENDERED_SAVE_INITIAL_DELAY_MS);
  }, [getRenderedCursorDebugState, recordRenderedEditorDebug, saveRenderedContent]);

  const focusRenderedEditor = useCallback((selection?: { start: number; end: number } | null) => {
    requestAnimationFrame(() => {
      const editor = renderedMarkdownEditorRef.current;
      if (!editor) return;
      editor.focus({ preventScroll: true });
      const targetSelection = selection ?? pendingRenderedEditorSelectionRef.current;
      pendingRenderedEditorSelectionRef.current = null;
      if (!targetSelection) return;
      const valueLength = editor.getValue().length;
      const start = Math.max(0, Math.min(targetSelection.start, valueLength));
      const end = Math.max(start, Math.min(targetSelection.end, valueLength));
      editor.setSelectionRange(start, end);
      activeRenderedCaretOffsetRef.current = end;
    });
  }, []);

  const activateRenderedTextEditing = useCallback((selection?: { start: number; end: number } | null) => {
    if (!activeReading) return;
    const bodyLength = displaySourceBody.length;
    const targetSelection = selection ?? { start: bodyLength, end: bodyLength };
    pendingRenderedEditorSelectionRef.current = targetSelection;
    activateRenderedEditing();
    focusRenderedEditor(targetSelection);
  }, [activateRenderedEditing, activeReading, displaySourceBody.length, focusRenderedEditor]);

  const focusActiveFileBodyAtEnd = useCallback(() => {
    if (!activeReading) return;
    deactivateSidebarKeyboard();
    if (contentMode === 'markdown') {
      requestAnimationFrame(() => {
        const editor = markdownCodeEditorRef.current;
        if (!editor) return;
        const length = editor.getValue().length;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(length, length);
      });
      return;
    }
    activateRenderedTextEditing({ start: displaySourceBody.length, end: displaySourceBody.length });
  }, [activateRenderedTextEditing, activeReading, contentMode, deactivateSidebarKeyboard, displaySourceBody.length]);

  const captureTerminalReturnEditorSelection = useCallback(() => {
    if (contentMode === 'markdown') {
      const selection = markdownCodeEditorRef.current?.getSelectionRange();
      terminalReturnEditorSelectionRef.current = {
        mode: 'markdown',
        start: selection?.start ?? editContentRef.current.length,
        end: selection?.end ?? selection?.start ?? editContentRef.current.length,
      };
      return;
    }
    const selection = renderedMarkdownEditorRef.current?.getSelectionRange();
    const offset = selection?.end ?? activeRenderedCaretOffsetRef.current ?? displaySourceBody.length;
    terminalReturnEditorSelectionRef.current = {
      mode: 'rendered',
      start: selection?.start ?? offset,
      end: selection?.end ?? offset,
    };
  }, [contentMode, displaySourceBody.length]);

  const restoreTerminalReturnEditorSelection = useCallback(() => {
    const target = terminalReturnEditorSelectionRef.current;
    deactivateSidebarKeyboard();
    if (target?.mode === 'markdown') {
      setContentMode('markdown');
      requestAnimationFrame(() => {
        const editor = markdownCodeEditorRef.current;
        if (!editor) return;
        const length = editor.getValue().length;
        const start = Math.max(0, Math.min(target.start, length));
        const end = Math.max(start, Math.min(target.end, length));
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(start, end);
      });
      return;
    }
    const selection = target
      ? { start: target.start, end: target.end }
      : { start: activeRenderedCaretOffsetRef.current ?? displaySourceBody.length, end: activeRenderedCaretOffsetRef.current ?? displaySourceBody.length };
    activateRenderedTextEditing(selection);
  }, [activateRenderedTextEditing, deactivateSidebarKeyboard, displaySourceBody.length]);

  const handleCodexTerminalVisibleChange = useCallback((nextVisible: boolean) => {
    if (nextVisible && responsivePanelState.autoHideTerminal) {
      setSuppressAutoHideTerminal(true);
    }
    if (!nextVisible) {
      setSuppressAutoHideTerminal(false);
    }
    setCodexTerminalVisible(nextVisible);
  }, [responsivePanelState.autoHideTerminal]);

  const toggleTerminalEditorFocus = useCallback((options?: { restoreEditorFocus?: boolean }) => {
    if (shouldRestoreEditorWhenTogglingTerminalFocus({
      terminalVisible: codexTerminalVisible,
      terminalFocused: codexTerminalFocused,
      restoreEditorFocus: options?.restoreEditorFocus,
    })) {
      setCodexTerminalFocused(false);
      restoreTerminalReturnEditorSelection();
      return;
    }
    captureTerminalReturnEditorSelection();
    handleCodexTerminalVisibleChange(true);
    setCodexTerminalFocusRequestKey((key) => key + 1);
  }, [
    captureTerminalReturnEditorSelection,
    codexTerminalFocused,
    codexTerminalVisible,
    handleCodexTerminalVisibleChange,
    restoreTerminalReturnEditorSelection,
  ]);

  const closeCodexTerminalPanel = useCallback((options?: { restoreEditorFocus?: boolean }) => {
    setCodexTerminalFocused(false);
    setSuppressAutoHideTerminal(false);
    setCodexTerminalVisible(false);
    if (options?.restoreEditorFocus) {
      window.requestAnimationFrame(() => restoreTerminalReturnEditorSelection());
    }
  }, [restoreTerminalReturnEditorSelection]);

  const toggleCodexTerminalPanel = useCallback((options?: { restoreEditorFocus?: boolean }) => {
    if (codexTerminalVisible) {
      if (shouldRestoreEditorWhenTogglingTerminalPanel({
        terminalVisible: codexTerminalVisible,
        terminalFocused: codexTerminalFocused,
        restoreEditorFocus: options?.restoreEditorFocus,
      })) {
        closeCodexTerminalPanel({ restoreEditorFocus: true });
      } else {
        closeCodexTerminalPanel();
      }
      return;
    }
    captureTerminalReturnEditorSelection();
    handleCodexTerminalVisibleChange(true);
  }, [captureTerminalReturnEditorSelection, closeCodexTerminalPanel, codexTerminalFocused, codexTerminalVisible, handleCodexTerminalVisibleChange]);

  const handleCodexTerminalLauncherTargetSessionChange = useCallback((sessionId: string | null) => {
    void window.codexTerminalAPI?.setLauncherTargetSession?.(sessionId);
  }, []);

  const toggleLineNumbers = useCallback((mode?: 'visible' | 'faded') => {
    setLineNumbersMode((current) => {
      if (mode) return current === mode ? 'hidden' : mode;
      return current === 'hidden' ? 'visible' : 'hidden';
    });
  }, []);

  const applyRenderedEditorBody = useCallback((
    nextBody: string,
    options: { selectionStart?: number | null; selectionEnd?: number | null; preserveUndo?: boolean } = {},
  ) => {
    if (!activeReading || contentMode !== 'rendered') return;
    const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    const previousContent = activeReadingContentRef.current ?? activeReading.content;
    if (!options.preserveUndo) {
      const editor = renderedMarkdownEditorRef.current;
      const selection = editor?.getSelectionRange() ?? { start: activeRenderedCaretOffsetRef.current ?? 0, end: activeRenderedCaretOffsetRef.current ?? 0 };
      renderedEditUndoStackRef.current.push({
        value: displaySourceBody,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      });
    }
    const nextContent = replaceMarkdownBodyPreservingFrontmatter(previousContent, nextBody);
    const selectionStart = options.selectionStart ?? null;
    const selectionEnd = options.selectionEnd ?? selectionStart;
    if (typeof selectionEnd === 'number') activeRenderedCaretOffsetRef.current = selectionEnd;
    markWritingActive();
    lastRenderedEditAtRef.current = Date.now();
    const deferReactState = options.preserveUndo === true && renderedEditingActiveRef.current;
    applyRenderedContentLocalState(nextContent, {
      updateRenderedDisplayContent: true,
      updateReactState: !deferReactState,
    });
    if (deferReactState) {
      scheduleRenderedReactCommit(nextContent);
    } else {
      cancelPendingRenderedReactCommit();
    }
    setMarkdownWikiLinkCompletion(null);
    requestRenderedContentSave(nextContent);
    if (startedAt > 0) {
      recordRenderedEditorDebug('apply-rendered-editor-body', {
        durationMs: performance.now() - startedAt,
        bodyLength: nextBody.length,
        contentLength: nextContent.length,
        deferReactState,
        preserveUndo: options.preserveUndo === true,
        selectionStart,
        selectionEnd,
      });
    }
  }, [
    activeReading,
    applyRenderedContentLocalState,
    cancelPendingRenderedReactCommit,
    contentMode,
    displaySourceBody,
    markWritingActive,
    recordRenderedEditorDebug,
    requestRenderedContentSave,
    scheduleRenderedReactCommit,
  ]);

  const handleRenderedEditorChange = useCallback((nextBody: string) => {
    const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    sampleRenderedEditorInteraction();
    const selection = renderedMarkdownEditorRef.current?.getSelectionRange() ?? null;
    applyRenderedEditorBody(nextBody, {
      selectionStart: selection?.start ?? null,
      selectionEnd: selection?.end ?? null,
      preserveUndo: true,
    });
    if (startedAt > 0) {
      recordRenderedEditorDebug('handle-rendered-editor-change', {
        durationMs: performance.now() - startedAt,
        bodyLength: nextBody.length,
        selectionStart: selection?.start ?? null,
        selectionEnd: selection?.end ?? null,
      });
    }
  }, [applyRenderedEditorBody, recordRenderedEditorDebug, sampleRenderedEditorInteraction]);

  const applyRenderedWikiLinkSuggestion = useCallback((
    suggestion: MarkdownWikiLinkSuggestion,
    completionFallback: MarkdownWikiLinkCompletion | null,
  ) => {
    const editor = renderedMarkdownEditorRef.current;
    const currentValue = editor?.getValue() ?? displaySourceBody;
    const selection = editor?.getSelectionRange();
    const liveCompletion = selection
      ? getActiveMarkdownWikiLinkCompletion(currentValue, selection.start, selection.end)
      : null;
    const completion = liveCompletion ?? completionFallback;
    if (!completion) return;
    const edit = getMarkdownWikiLinkCompletionReplacement(currentValue, completion, suggestion.title);
    if (!edit) return;

    applyRenderedEditorBody(edit.nextValue, {
      selectionStart: edit.selectionStart,
      selectionEnd: edit.selectionEnd,
    });
    setMarkdownWikiLinkCompletion(null);
    pendingRenderedEditorSelectionRef.current = {
      start: edit.selectionStart,
      end: edit.selectionEnd,
    };
    focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
  }, [applyRenderedEditorBody, displaySourceBody, focusRenderedEditor]);

  const restoreRenderedEditorProgrammaticUndo = useCallback((): boolean => {
    const snapshot = renderedEditUndoStackRef.current.pop();
    if (!snapshot) return false;
    applyRenderedEditorBody(snapshot.value, {
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
      preserveUndo: true,
    });
    pendingRenderedEditorSelectionRef.current = {
      start: snapshot.selectionStart,
      end: snapshot.selectionEnd,
    };
    focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
    return true;
  }, [applyRenderedEditorBody, focusRenderedEditor]);

	  const handleRenderedEditorKeyDown = useCallback((event: KeyboardEvent) => {
	    const completion = markdownWikiLinkCompletion;
	    if (completion) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMarkdownWikiLinkCompletion(null);
        return true;
      }

      if (
        (event.key === 'Backspace' || event.key === 'Delete')
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
      ) {
        const editor = renderedMarkdownEditorRef.current;
        const currentValue = editor?.getValue() ?? displaySourceBody;
        const selection = editor?.getSelectionRange();
        const liveCompletion = selection
          ? getActiveMarkdownWikiLinkCompletion(currentValue, selection.start, selection.end)
          : null;
        const edit = getMarkdownWikiLinkCompletionDeleteEdit(currentValue, liveCompletion ?? completion, event.key);
        if (edit) {
          event.preventDefault();
          event.stopPropagation();
          applyRenderedEditorBody(edit.nextValue, {
            selectionStart: edit.selectionStart,
            selectionEnd: edit.selectionEnd,
          });
          pendingRenderedEditorSelectionRef.current = {
            start: edit.selectionStart,
            end: edit.selectionEnd,
          };
          focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
          setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
            edit.nextValue,
            edit.selectionStart,
            edit.selectionEnd,
            { top: completion.top, left: completion.left },
          ));
          return true;
        }
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
          applyRenderedWikiLinkSuggestion(suggestion, completion);
          return true;
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const editor = renderedMarkdownEditorRef.current;
        const currentValue = editor?.getValue() ?? displaySourceBody;
        const selection = editor?.getSelectionRange();
        const liveCompletion = selection
          ? getActiveMarkdownWikiLinkCompletion(currentValue, selection.start, selection.end)
          : null;
        const edit = getMarkdownWikiLinkCompletionCommitEdit(currentValue, liveCompletion ?? completion);
        if (!edit) return true;
        applyRenderedEditorBody(edit.nextValue, {
          selectionStart: edit.selectionStart,
          selectionEnd: edit.selectionEnd,
        });
        setMarkdownWikiLinkCompletion(null);
        pendingRenderedEditorSelectionRef.current = {
          start: edit.selectionStart,
          end: edit.selectionEnd,
        };
        focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
        return true;
      }
    }

    if (isImmersiveToggleShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleFocusChromeShortcut();
      return true;
    }

    if (isLineNumbersToggleShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleLineNumbers('visible');
      return true;
    }

    if (isFadedLineNumbersShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleLineNumbers('faded');
      return true;
    }

    if (isLineNumbersToggleShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleLineNumbers('visible');
      return true;
    }

    if (isFadedLineNumbersShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleLineNumbers('faded');
      return true;
    }

    const navigationDirection = getLibrarianBracketNavigationDirection(event, { canNavigateBack, canNavigateForward });
    if (navigationDirection !== null && navigationDirection !== 0) {
      event.preventDefault();
      event.stopPropagation();
      navigateHistory(navigationDirection);
      return true;
    }

    if (event.key.toLowerCase() === 'z' && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
      if (restoreRenderedEditorProgrammaticUndo()) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearRenderedEditingState('escape');
      return true;
    }

    if (!activeReading) return false;

    const editor = renderedMarkdownEditorRef.current;
    if (!editor) return false;
    const selection = editor.getSelectionRange();
    const applyRenderedShortcutEdit = (edit: MarkdownTextEdit): true => {
      event.preventDefault();
      event.stopPropagation();
      applyRenderedEditorBody(edit.nextValue, {
        selectionStart: edit.selectionStart,
        selectionEnd: edit.selectionEnd,
      });
      pendingRenderedEditorSelectionRef.current = {
        start: edit.selectionStart,
        end: edit.selectionEnd,
      };
      if (edit.deletedMarkdownImages?.length) {
        pendingCopiedImageDeletesRef.current.push({
          documentPath: activeReading.path,
          markdownImages: edit.deletedMarkdownImages,
        });
      }
      focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
      return true;
    };

    const value = editor.getValue();
    if (
      isRenderedMarkdownSelectionInsideInlineHtmlBlock(value, selection.start, selection.end)
      && event.key !== 'Backspace'
      && event.key !== 'Delete'
      && event.key !== 'Escape'
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const indentEdit = getMarkdownListIndentEdit(value, selection.start, selection.end, event.shiftKey ? 'out' : 'in');
      if (indentEdit) return applyRenderedShortcutEdit(indentEdit);
    }

    if (!shouldLetRenderedCodeMirrorHandleLineBoundaryDelete({
      event,
      selectionStart: selection.start,
      selectionEnd: selection.end,
    })) {
      const deleteEdit = getRenderedMarkdownDeleteShortcutEdit({
        event,
        value,
        selectionStart: selection.start,
        selectionEnd: selection.end,
      });
      if (deleteEdit) return applyRenderedShortcutEdit(deleteEdit);
    }

    if (
      (event.key === 'Backspace' || event.key === 'Delete')
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && shouldSuppressRenderedMarkdownBoundaryDelete(value, selection.start, selection.end, event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const drawEdit = getMarkdownDrawCommandEdit(value, selection.start, selection.end);
      if (drawEdit) {
        event.preventDefault();
        event.stopPropagation();
        applyRenderedEditorBody(drawEdit.nextValue, {
          selectionStart: drawEdit.selectionStart,
          selectionEnd: drawEdit.selectionEnd,
        });
        pendingRenderedEditorSelectionRef.current = {
          start: drawEdit.selectionStart,
          end: drawEdit.selectionEnd,
        };
        focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
        setInlineDrawInsertion({
          mode: 'rendered',
          documentPath: activeReading.path,
          insertionStart: drawEdit.selectionStart,
        });
        return true;
      }

      const enterEdit = getRenderedMarkdownEnterEdit(value, selection.start, selection.end);
      if (enterEdit) return applyRenderedShortcutEdit(enterEdit);
    }

    const edit = getRenderedMarkdownShortcutEdit({
      event,
      value,
      selectionStart: selection.start,
      selectionEnd: selection.end,
      unorderedListMarker,
    });
    return edit ? applyRenderedShortcutEdit(edit) : false;
  }, [
    activeReading,
    applyRenderedEditorBody,
    applyRenderedWikiLinkSuggestion,
    clearRenderedEditingState,
    canNavigateBack,
    canNavigateForward,
    displaySourceBody,
    focusRenderedEditor,
    markdownWikiLinkCompletion,
    markdownWikiLinkSuggestionIndex,
    markdownWikiLinkSuggestions,
    navigateHistory,
    restoreRenderedEditorProgrammaticUndo,
    toggleFocusChromeShortcut,
    toggleLineNumbers,
    unorderedListMarker,
  ]);

  const updateRenderedEditorWikiLinkCompletion = useCallback((
    snapshot: MarkdownCodeEditorSelectionSnapshot,
  ) => {
    const startedAt = renderedEditorDebugEnabledRef.current ? performance.now() : 0;
    const completionPosition = snapshot.caretPosition ?? { top: 0, left: 0 };
    const autoCloseEdit = snapshot.docChanged && snapshot.inputType === 'insertText' && snapshot.inputData === '['
      ? getMarkdownWikiLinkAutoCloseEdit(snapshot.value, snapshot.selectionStart, snapshot.selectionEnd)
      : null;
    if (autoCloseEdit) {
      applyRenderedEditorBody(autoCloseEdit.nextValue, {
        selectionStart: autoCloseEdit.selectionStart,
        selectionEnd: autoCloseEdit.selectionEnd,
      });
      pendingRenderedEditorSelectionRef.current = {
        start: autoCloseEdit.selectionStart,
        end: autoCloseEdit.selectionEnd,
      };
      focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
      setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
        autoCloseEdit.nextValue,
        autoCloseEdit.selectionStart,
        autoCloseEdit.selectionEnd,
        completionPosition,
      ));
      if (startedAt > 0) {
        recordRenderedEditorDebug('rendered-wiki-link-completion', {
          durationMs: performance.now() - startedAt,
          autoClose: true,
          valueLength: autoCloseEdit.nextValue.length,
        });
      }
      return;
    }

    setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
      snapshot.value,
      snapshot.selectionStart,
      snapshot.selectionEnd,
      completionPosition,
    ));
    if (startedAt > 0) {
      recordRenderedEditorDebug('rendered-wiki-link-completion', {
        durationMs: performance.now() - startedAt,
        autoClose: false,
        docChanged: snapshot.docChanged,
        inputType: snapshot.inputType ?? null,
        valueLength: snapshot.value.length,
      });
    }
  }, [applyRenderedEditorBody, focusRenderedEditor, recordRenderedEditorDebug]);

  const handleRenderedEditorSelectionChange = useCallback((snapshot: MarkdownCodeEditorSelectionSnapshot) => {
    activeRenderedCaretOffsetRef.current = snapshot.selectionHead;
    updateRenderedEditorWikiLinkCompletion(snapshot);
  }, [updateRenderedEditorWikiLinkCompletion]);

  const handleRenderedEditorMouseDown = useCallback((event: MouseEvent, offset: number): boolean => {
    if (!isRenderedMarkdownLinkEventTarget(event.target)) return false;
    const action = getMarkdownEditorLinkActionAtOffset(displaySourceBody, offset, wikiIndex);
    if (action.kind === 'noop') return false;
    if (!shouldOpenMarkdownLinkFromMouseDown({
      button: event.button,
      metaKey: event.metaKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      renderedEditingActive: renderedEditingActiveRef.current,
      actionKind: action.kind,
    })) return false;
    event.preventDefault();
    event.stopPropagation();
    openLinkAction(action);
    return true;
  }, [displaySourceBody, openLinkAction, wikiIndex]);

  const applyRenderedTextInsertion = useCallback((
    text: string,
    options: { convertLocalImagePaths?: boolean } = {},
  ) => {
    if (!text || !activeReading || contentMode !== 'rendered') return;
    const editor = renderedMarkdownEditorRef.current;
    const currentValue = editor?.getValue() ?? displaySourceBody;
    const selection = editor?.getSelectionRange();
    const selectionStart = selection?.start ?? currentValue.length;
    const selectionEnd = selection?.end ?? selectionStart;
    const shouldConvertLocalImagePaths = options.convertLocalImagePaths !== false;
    const insertedText = shouldConvertLocalImagePaths
      ? formatPastedLocalImageMarkdown(text) ?? text
      : text;
    const pasteEdit = getRenderedMarkdownPasteTextEdit(currentValue, selectionStart, selectionEnd, insertedText);
    if (pasteEdit) {
      applyRenderedEditorBody(pasteEdit.nextValue, {
        selectionStart: pasteEdit.selectionStart,
        selectionEnd: pasteEdit.selectionEnd,
      });
      pendingRenderedEditorSelectionRef.current = {
        start: pasteEdit.selectionStart,
        end: pasteEdit.selectionEnd,
      };
      focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
      return;
    }
    const nextValue = `${currentValue.slice(0, selectionStart)}${insertedText}${currentValue.slice(selectionEnd)}`;
    const nextSelection = selectionStart + insertedText.length;
    applyRenderedEditorBody(nextValue, {
      selectionStart: nextSelection,
      selectionEnd: nextSelection,
    });
    pendingRenderedEditorSelectionRef.current = {
      start: nextSelection,
      end: nextSelection,
    };
    focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
  }, [activeReading, applyRenderedEditorBody, contentMode, displaySourceBody, focusRenderedEditor]);

  const insertPastedClipboardImagePathInRenderedEditor = useCallback(async (clipboardData: DataTransfer) => {
    const imagePath = await getPastedClipboardImagePath(clipboardData);
    if (!imagePath) return;
    const portable = activeReading?.path
      ? await window.markdownImagesAPI?.copyImageForDocument(activeReading.path, imagePath, 'Image')
      : null;
    applyRenderedTextInsertion(portable?.markdown ?? formatLocalImageMarkdown(imagePath));
  }, [activeReading?.path, applyRenderedTextInsertion]);

  const handleRenderedEditorPaste = useCallback((event: ClipboardEvent): boolean => {
    const clipboardData = event.clipboardData;
    const pastedText = clipboardData?.getData('text/plain') ?? '';
    if (clipboardData && shouldInsertClipboardImagePathForPaste({ pastedText, hasImage: clipboardDataHasImage(clipboardData) })) {
      void insertPastedClipboardImagePathInRenderedEditor(clipboardData);
      return true;
    }
    if (!pastedText) return false;

    const localImageMarkdown = formatPastedLocalImageMarkdown(pastedText);
    applyRenderedTextInsertion(localImageMarkdown ?? pastedText);
    return true;
  }, [applyRenderedTextInsertion, insertPastedClipboardImagePathInRenderedEditor]);

  useEffect(() => {
    clearRenderedEditingState('path-or-mode-changed');
  }, [activeReading?.path, clearRenderedEditingState, contentMode]);

  useEffect(() => {
    setRenderedImagePreview(null);
  }, [activeReading?.path]);

  useEffect(() => {
    return () => {
      flushPendingRenderedSave();
    };
  }, [activeReading?.path, contentMode, flushPendingRenderedSave]);

  const cycleSelectedMarkdownTodoState = useCallback(async (direction: 'forward' | 'backward' = 'forward'): Promise<boolean> => {
    if (!activeReading || (selectedItemType !== 'wiki' && selectedItemType !== 'external')) return false;
    if (selectedItemType === 'wiki' && !wikiSelectedRelPath) return false;

    const sourceContent = contentMode === 'markdown' ? editContent : activeReadingContentRef.current ?? activeReading.content;
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
    if (!root || contentMode === 'markdown' || activeIsMarkdownDocument) return;
    if (!fileFindOpen) {
      clearFileFindMarks(root);
      return;
    }
    highlightFileFindMatches(root, fileFindQuery);
    return () => clearFileFindMarks(root);
  }, [activeIsMarkdownDocument, contentMode, displaySourceBody, fileFindOpen, fileFindQuery]);

  const captureContentScrollRatio = useCallback(() => {
    const scrollEl = contentMode === 'markdown' ? markdownCodeEditorRef.current : contentScrollRef.current;
    if (!scrollEl) return;
    pendingScrollRatioRef.current = getScrollRatio(
      scrollEl.scrollTop,
      scrollEl.scrollHeight,
      scrollEl.clientHeight,
    );
  }, [contentMode]);

  const exitEditMode = useCallback(async () => {
    captureContentScrollRatio();
    await flushCurrentEdit();
    setContentMode('rendered');
  }, [captureContentScrollRatio, flushCurrentEdit]);

  const switchToTypedownMode = useCallback(async () => {
    if (!FEATURE_TYPEDOWN_ENABLED) return;
    captureContentScrollRatio();
    await flushCurrentEdit();
    setContentMode('typedown');
  }, [captureContentScrollRatio, flushCurrentEdit]);

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

  const handleInlineDrawClose = useCallback(() => {
    setInlineDrawInsertion(null);
    setInlineDrawSaving(false);
    if (contentMode === 'markdown') {
      requestAnimationFrame(() => markdownCodeEditorRef.current?.focus({ preventScroll: true }));
    } else {
      focusRenderedEditor();
    }
  }, [contentMode, focusRenderedEditor]);

  const handleInlineDrawSave = useCallback(async (imageData: { dataUrl: string; width: number; height: number }) => {
    const insertion = inlineDrawInsertion;
    if (!insertion || inlineDrawSaving) return;
    setInlineDrawSaving(true);
    try {
      const copied = await window.markdownImagesAPI?.copyImageDataUrlForDocument(
        insertion.documentPath,
        imageData.dataUrl,
        'Drawing',
      );
      if (!copied?.markdown) {
        alert('Failed to save drawing. Please try again.');
        setInlineDrawSaving(false);
        return;
      }

      if (insertion.mode === 'rendered') {
        const editor = renderedMarkdownEditorRef.current;
        const currentValue = editor?.getValue() ?? displaySourceBody;
        const edit = typeof insertion.replaceFrom === 'number' && typeof insertion.replaceTo === 'number'
          ? {
              nextValue: `${currentValue.slice(0, insertion.replaceFrom)}${copied.markdown}${currentValue.slice(insertion.replaceTo)}`,
              selectionStart: insertion.replaceFrom + copied.markdown.length,
              selectionEnd: insertion.replaceFrom + copied.markdown.length,
            }
          : insertMarkdownBlockAt(currentValue, insertion.insertionStart, copied.markdown);
        applyRenderedEditorBody(edit.nextValue, {
          selectionStart: edit.selectionStart,
          selectionEnd: edit.selectionEnd,
        });
        pendingRenderedEditorSelectionRef.current = {
          start: edit.selectionStart,
          end: edit.selectionEnd,
        };
        focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
      } else {
        const editor = markdownCodeEditorRef.current;
        const currentValue = editor?.getValue() ?? editContent;
        const edit = typeof insertion.replaceFrom === 'number' && typeof insertion.replaceTo === 'number'
          ? {
              nextValue: `${currentValue.slice(0, insertion.replaceFrom)}${copied.markdown}${currentValue.slice(insertion.replaceTo)}`,
              selectionStart: insertion.replaceFrom + copied.markdown.length,
              selectionEnd: insertion.replaceFrom + copied.markdown.length,
            }
          : insertMarkdownBlockAt(currentValue, insertion.insertionStart, copied.markdown);
        applyMarkdownCodeEditorTextEdit(edit);
      }

      setInlineDrawInsertion(null);
      setInlineDrawSaving(false);
    } catch {
      alert('Failed to save drawing. Please try again.');
      setInlineDrawSaving(false);
    }
  }, [
    applyMarkdownCodeEditorTextEdit,
    applyRenderedEditorBody,
    displaySourceBody,
    editContent,
    focusRenderedEditor,
    inlineDrawInsertion,
    inlineDrawSaving,
  ]);

  const openRenderedDrawingEditor = useCallback(async (preview: MarkdownCodeEditorImagePreview): Promise<boolean> => {
    if (!isRenderedMarkdownDrawingAlt(preview.alt) || !activeReading?.path || preview.sourceFrom === null || preview.sourceTo === null) return false;
    try {
      const response = await fetch(preview.src);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 800, height: img.naturalHeight || 600 });
        img.onerror = reject;
        img.src = dataUrl;
      });
      setRenderedImagePreview(null);
      setInlineDrawInsertion({
        mode: 'rendered',
        documentPath: activeReading.path,
        insertionStart: preview.sourceFrom,
        replaceFrom: preview.sourceFrom,
        replaceTo: preview.sourceTo,
        backgroundImage: {
          dataUrl,
          width: dimensions.width,
          height: dimensions.height,
        },
      });
      return true;
    } catch {
      alert('Failed to open drawing. Please try again.');
      return true;
    }
  }, [activeReading?.path]);

  const handleRenderedImageAction = useCallback((preview: MarkdownCodeEditorImagePreview) => {
    void (async () => {
      const handled = await openRenderedDrawingEditor(preview);
      if (!handled) setRenderedImagePreview(preview);
    })();
  }, [openRenderedDrawingEditor]);

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

  const handleMarkdownCodeEditorSelectionChange = useCallback((
    snapshot: MarkdownCodeEditorSelectionSnapshot,
  ) => {
    const reason = snapshot.docChanged ? 'markdown-input' : 'markdown-selection';
    latestMarkdownCursorSnapshotRef.current = { ...snapshot, timestamp: Date.now(), stage: reason };
    recordRenderedEditorDebug('markdown-cursor-change', () => ({
      reason,
      cursor: getMarkdownCursorDebugState(reason, snapshot),
      editorCursor: getEditorCursorDebugState(reason, snapshot),
    }));
    scheduleEditorCursorSettledDebug(reason, snapshot);
    updateMarkdownCodeEditorWikiLinkCompletion(snapshot);
  }, [
    getEditorCursorDebugState,
    getMarkdownCursorDebugState,
    recordRenderedEditorDebug,
    scheduleEditorCursorSettledDebug,
    updateMarkdownCodeEditorWikiLinkCompletion,
  ]);

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

  const applyMarkdownTextInsertion = useCallback((
    text: string,
    options: { convertLocalImagePaths?: boolean } = {},
  ) => {
    if (!text) return;
    markWritingActive();
    setMarkdownUrlPasteChoice(null);
    setMarkdownWikiLinkCompletion(null);

    const editor = markdownCodeEditorRef.current;
    const currentValue = editor?.getValue() ?? editContent;
    const selection = editor?.getSelectionRange();
    const selectionStart = selection?.start ?? currentValue.length;
    const selectionEnd = selection?.end ?? selectionStart;
    const shouldConvertLocalImagePaths = options.convertLocalImagePaths !== false;
    const insertedText = shouldConvertLocalImagePaths
      ? formatPastedLocalImageMarkdown(text) ?? text
      : text;
    const nextValue = `${currentValue.slice(0, selectionStart)}${insertedText}${currentValue.slice(selectionEnd)}`;
    const nextSelection = selectionStart + insertedText.length;
    pendingMarkdownInsertionSelectionRef.current = {
      value: nextValue,
      start: nextSelection,
      end: nextSelection,
    };

    setEditContent(nextValue);
    scheduleEditorSessionPersist();

    requestAnimationFrame(() => {
      const nextEditor = markdownCodeEditorRef.current;
      if (!nextEditor || nextEditor.getValue() !== nextValue) return;
      pendingMarkdownInsertionSelectionRef.current = null;
      nextEditor.focus({ preventScroll: true });
      nextEditor.setSelectionRange(nextSelection, nextSelection);
    });
  }, [editContent, markWritingActive, scheduleEditorSessionPersist]);

  const replaceSelectedMarkdownText = useCallback((request: ReplaceSelectedMarkdownTextRequest): boolean => {
    if (contentMode === 'rendered') {
      const editor = renderedMarkdownEditorRef.current;
      const selection = editor?.getSelectionRange();
      if (!editor || !selection) return false;
      const edit = getVerifiedMarkdownSelectionReplacement(
        editor.getValue(),
        selection.start,
        selection.end,
        request.expectedText,
        request.replacementText,
      );
      if (!edit) return false;
      applyRenderedEditorBody(edit.nextValue, {
        selectionStart: edit.selectionStart,
        selectionEnd: edit.selectionEnd,
      });
      pendingRenderedEditorSelectionRef.current = {
        start: edit.selectionStart,
        end: edit.selectionEnd,
      };
      focusRenderedEditor(pendingRenderedEditorSelectionRef.current);
      return true;
    }

    if (contentMode !== 'markdown') return false;
    const editor = markdownCodeEditorRef.current;
    const selection = editor?.getSelectionRange();
    if (!editor || !selection) return false;
    const edit = getVerifiedMarkdownSelectionReplacement(
      editor.getValue(),
      selection.start,
      selection.end,
      request.expectedText,
      request.replacementText,
    );
    if (!edit) return false;
    applyMarkdownCodeEditorTextEdit(edit);
    return true;
  }, [applyMarkdownCodeEditorTextEdit, applyRenderedEditorBody, contentMode, focusRenderedEditor]);

  const insertMarkdownText = useCallback((text: string) => {
    if (contentMode === 'rendered') {
      applyRenderedTextInsertion(text);
      return;
    }
    if (contentMode !== 'markdown') {
      setContentMode('markdown');
      requestAnimationFrame(() => applyMarkdownTextInsertion(text));
      return;
    }
    applyMarkdownTextInsertion(text);
  }, [applyMarkdownTextInsertion, applyRenderedTextInsertion, contentMode]);

  const insertPlainMarkdownText = useCallback((text: string) => {
    const options = { convertLocalImagePaths: false };
    if (contentMode === 'rendered') {
      applyRenderedTextInsertion(text, options);
      return;
    }
    if (contentMode !== 'markdown') {
      setContentMode('markdown');
      requestAnimationFrame(() => applyMarkdownTextInsertion(text, options));
      return;
    }
    applyMarkdownTextInsertion(text, options);
  }, [applyMarkdownTextInsertion, applyRenderedTextInsertion, contentMode]);

  useLayoutEffect(() => {
    if (contentMode !== 'markdown') return;
    const frame = requestAnimationFrame(() => {
      const pending = pendingMarkdownInsertionSelectionRef.current;
      const editor = markdownCodeEditorRef.current;
      if (!pending || !editor || editor.getValue() !== pending.value) return;
      pendingMarkdownInsertionSelectionRef.current = null;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(pending.start, pending.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [contentMode, editContent]);

  const insertPastedClipboardImagePath = useCallback(async (clipboardData: DataTransfer) => {
    const imagePath = await getPastedClipboardImagePath(clipboardData);
    if (!imagePath) return;
    const portable = activeReading?.path
      ? await window.markdownImagesAPI?.copyImageForDocument(activeReading.path, imagePath, 'Image')
      : null;
    insertMarkdownText(portable?.markdown ?? formatLocalImageMarkdown(imagePath));
  }, [activeReading?.path, insertMarkdownText]);

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
      void insertPastedClipboardImagePath(clipboardData);
      return true;
    }
    if (!pastedText) return false;

    const localImageMarkdown = formatPastedLocalImageMarkdown(pastedText);
    if (localImageMarkdown) {
      insertMarkdownText(localImageMarkdown);
      return true;
    }

    if (clipboardData) {
      const wikiLinkPasteText = getMarkdownWikiLinkPasteText(
        getClipboardMarkdownFileReferenceText(clipboardData, pastedText),
        wikiIndex,
      );
      if (wikiLinkPasteText) {
        insertMarkdownText(wikiLinkPasteText);
        return true;
      }
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
  }, [applyMarkdownUrlPasteEdit, insertMarkdownText, insertPastedClipboardImagePath, wikiIndex]);

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

    if (event.key === 'Escape' && !markdownWikiLinkCompletion) {
      event.preventDefault();
      event.stopPropagation();
      void exitEditMode();
      return true;
    }

    if (isImmersiveToggleShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleFocusChromeShortcut();
      return true;
    }

    const navigationDirection = getLibrarianBracketNavigationDirection(event, { canNavigateBack, canNavigateForward });
    if (navigationDirection !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (navigationDirection !== 0) navigateHistory(navigationDirection);
      return true;
    }

    if (event.key.toLowerCase() === 'i' && event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        await flushCurrentEdit();
        await window.commandsAPI?.runLocalCommand?.({
          commandName: 'improve',
          mode: 'selection',
          selection: {
            start: selection.start,
            end: selection.end,
          },
        });
      })().catch(() => {});
      return true;
    }

    if (event.key.toLowerCase() === 'z' && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
      if (restoreMarkdownCodeEditorProgrammaticUndo()) {
        event.preventDefault();
        return true;
      }
    }

    if (event.key === 'Backspace' && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const edit = getMarkdownWordDeleteBackwardPreservingListMarkerEdit(value, selection.start, selection.end);
      if (edit) {
        event.preventDefault();
        applyMarkdownCodeEditorTextEdit(edit);
        return true;
      }
    }

    const formattingKind = getMarkdownFormattingShortcut(event);
    if (formattingKind) {
      const edit = getMarkdownFormattingEdit(value, selection.start, selection.end, formattingKind);
      event.preventDefault();
      applyMarkdownCodeEditorTextEdit(edit);
      return true;
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

      const listShortcutKind = getMarkdownListShortcutKind(event);
      if (listShortcutKind) {
        const edit = getMarkdownListToggleEdit(
          value,
          selection.start,
          selection.end,
          listShortcutKind,
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

      if (
        (event.key === 'Backspace' || event.key === 'Delete')
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
      ) {
        const editor = markdownCodeEditorRef.current;
        const currentValue = editor?.getValue() ?? editContent;
        const liveSelection = editor?.getSelectionRange();
        const liveCompletion = liveSelection
          ? getActiveMarkdownWikiLinkCompletion(currentValue, liveSelection.start, liveSelection.end)
          : null;
        const edit = getMarkdownWikiLinkCompletionDeleteEdit(currentValue, liveCompletion ?? completion, event.key);
        if (edit) {
          event.preventDefault();
          event.stopPropagation();
          applyMarkdownCodeEditorTextEdit(edit, { preserveCompletion: true });
          setMarkdownWikiLinkCompletion(getMarkdownWikiLinkCompletionState(
            edit.nextValue,
            edit.selectionStart,
            edit.selectionEnd,
            { top: completion.top, left: completion.left },
          ));
          return true;
        }
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
      } else if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const editor = markdownCodeEditorRef.current;
        const currentValue = editor?.getValue() ?? editContent;
        const liveSelection = editor?.getSelectionRange();
        const liveCompletion = liveSelection
          ? getActiveMarkdownWikiLinkCompletion(currentValue, liveSelection.start, liveSelection.end)
          : null;
        const edit = getMarkdownWikiLinkCompletionCommitEdit(currentValue, liveCompletion ?? completion);
        if (!edit) return true;
        applyMarkdownCodeEditorTextEdit(edit);
        setMarkdownWikiLinkCompletion(null);
        return true;
      }
    }

    if (event.key === 'Enter') {
      const drawEdit = getMarkdownDrawCommandEdit(value, selection.start, selection.end);
      if (drawEdit && activeReading?.path) {
        event.preventDefault();
        event.stopPropagation();
        applyMarkdownCodeEditorTextEdit(drawEdit);
        setInlineDrawInsertion({
          mode: 'markdown',
          documentPath: activeReading.path,
          insertionStart: drawEdit.selectionStart,
        });
        return true;
      }

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
    activeReading,
    applyMarkdownCodeEditorTextEdit,
    applyMarkdownWikiLinkSuggestion,
    editContent,
    exitEditMode,
    canNavigateBack,
    canNavigateForward,
    flushCurrentEdit,
    markdownWikiLinkCompletion,
    markdownWikiLinkSuggestionIndex,
    markdownWikiLinkSuggestions,
    navigateHistory,
    restoreMarkdownCodeEditorProgrammaticUndo,
    scheduleEditorSessionPersist,
    toggleLineNumbers,
    toggleFocusChromeShortcut,
    unorderedListMarker,
  ]);

  const handleMarkdownCodeEditorMouseDown = useCallback((event: MouseEvent, offset: number): boolean => {
    if (!shouldOpenMarkdownEditorLinkFromMouseDown(event)) return false;
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
  }, [contentMode, displaySourceBody, lineHeightId, textSize, typographyPresetId, updateRenderedDocumentTopFade]);

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
    renderedEditUndoStackRef.current = [];
  }, [activeReading?.path, contentMode]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.librarianAPI?.onInsertMarkdownText(insertMarkdownText);
    return () => unsubscribe?.();
  }, [active, insertMarkdownText]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.librarianAPI?.onInsertPlainMarkdownText?.(insertPlainMarkdownText);
    return () => unsubscribe?.();
  }, [active, insertPlainMarkdownText]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.librarianAPI?.onReplaceSelectedMarkdownText?.(replaceSelectedMarkdownText);
    return () => unsubscribe?.();
  }, [active, replaceSelectedMarkdownText]);

  useEffect(() => {
    if (!active) return;
    const unsubscribe = window.commandsAPI?.onToggleLineNumbersFromLauncher?.(() => {
      toggleLineNumbers('visible');
    });
    return () => unsubscribe?.();
  }, [active, toggleLineNumbers]);

  useEffect(() => {
    return () => window.librarianAPI?.setMarkdownEditorFocused(false);
  }, []);

  const enterEditMode = useCallback((selectionStart?: number | null) => {
    captureContentScrollRatio();
    const hadPendingRenderedSave = pendingRenderedSaveRef.current !== null;
    flushPendingRenderedSave();
    const activePath = activeReadingPathRef.current;
    const latestRenderedContent = latestRenderedContentRef.current;
    const shouldUseLatestRenderedContent = !!activePath && latestRenderedContent?.path === activePath;
    const nextEditContent = shouldUseLatestRenderedContent
      ? latestRenderedContent.content
      : activeReading?.content;
    if (activePath && typeof nextEditContent === 'string') {
      const normalizedContent = removeEmptyMarkdownCommentPlaceholders(nextEditContent);
      setEditContent(normalizedContent);
      editContentRef.current = normalizedContent;
      lastSeededPathRef.current = activePath;
    }
    recordRenderedEditorDebug('enter-markdown-source', {
      selectionStart: typeof selectionStart === 'number' ? selectionStart : null,
      usedLatestRenderedContent: shouldUseLatestRenderedContent,
      flushedPendingRenderedSave: hadPendingRenderedSave,
    });
    focusMarkdownEditorOnOpenRef.current = true;
    pendingRenderedEditSelectionRef.current = typeof selectionStart === 'number' ? selectionStart : null;
    pendingRenderedEditSelectionEndRef.current = typeof selectionStart === 'number' ? selectionStart : null;
    setContentMode('markdown');
  }, [activeReading?.content, captureContentScrollRatio, flushPendingRenderedSave, recordRenderedEditorDebug]);

  useEffect(() => {
    if (contentMode !== 'markdown' || !focusMarkdownEditorOnOpenRef.current) return;
    const frame = requestAnimationFrame(() => {
      focusMarkdownEditorOnOpenRef.current = false;
      const selectionStart = pendingRenderedEditSelectionRef.current;
      const selectionEnd = pendingRenderedEditSelectionEndRef.current ?? selectionStart;
      pendingRenderedEditSelectionRef.current = null;
      pendingRenderedEditSelectionEndRef.current = null;

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

  // Debounced auto-save. Fires ~400ms after the last keystroke and doesn't
  // round-trip the saved content back into React state, so the editor's
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
    const targetSharedFileStatus = sharedFileStatus;
    let done = false;
    const doSave = async () => {
      if (done) return;
      done = true;
      setSaveStatus('saving');
      try {
        const portableContent = targetReadingPath
          ? (await window.markdownImagesAPI?.makeImagesPortable(targetReadingPath, targetContent))?.content ?? targetContent
          : targetContent;
        let result: DocumentSaveResult | null | undefined;
        let overwrite: (version: DocumentVersion) => Promise<DocumentSaveResult | null | undefined>;
        if (targetType === 'wiki' && targetWikiPath) {
          result = await window.wikiAPI?.save(targetWikiPath, portableContent, targetVersion);
          overwrite = (version) => window.wikiAPI?.save(targetWikiPath, portableContent, version) ?? Promise.resolve(undefined);
        } else if (targetType === 'external' && targetReadingPath) {
          result = await window.externalAPI?.save(targetReadingPath, portableContent, targetVersion);
          overwrite = (version) => window.externalAPI?.save(targetReadingPath, portableContent, version) ?? Promise.resolve(undefined);
        } else if (targetReadingPath) {
          result = await window.librarianAPI?.saveReading(targetReadingPath, portableContent, targetVersion);
          overwrite = (version) => window.librarianAPI?.saveReading(targetReadingPath, portableContent, version) ?? Promise.resolve(undefined);
        } else {
          return;
        }

        if (isDocumentSaveConflict(result)) {
          const resolved = await resolveSaveConflict(result, targetType, targetReadingPath, portableContent, targetTitle, overwrite);
          setSaveStatus(resolved ? 'saved' : 'idle');
          return;
        }
        if (!isDocumentSaveOk(result)) throw new Error('save failed');
        applySavedDocumentState(targetType, targetReadingPath, portableContent, getDocumentSaveVersion(result), targetTitle);
        const currentSharedFileStatus = sharedFileStatusPathRef.current === targetReadingPath
          ? sharedFileStatusRef.current
          : targetSharedFileStatus;
        scheduleSharedContentSync(currentSharedFileStatus, portableContent);
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
  }, [activeReading, applySavedDocumentState, contentMode, editContent, resolveSaveConflict, scheduleSharedContentSync, selectedItemType, sharedFileStatus, wikiSelectedRelPath]);

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
        setContentMode(getLibraryDocumentDefaultContentMode(getLibraryDocumentViewKind(page.absPath, 'external')));
        return page;
      }
      return false;
    }

    const page = await window.wikiAPI?.createFile(location.relPath, fileName.trim());
    if (page) {
      dispatchLocalWikiAdded(page);
      openWikiPage(page.relPath);
      setContentMode(getLibraryDocumentDefaultContentMode(getLibraryDocumentViewKind(page.absPath, 'wiki')));
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
    setContentMode(getLibraryDocumentDefaultContentMode(getLibraryDocumentViewKind(page.absPath, 'wiki')));
  }, [openWikiPage]);

  useEffect(() => {
    if (!initialOpenTarget) return;
    if (initialOpenTarget.kind === 'wiki') {
      void (async () => {
        setSearchQuery('');
        openWikiPage(initialOpenTarget.path);
        const requestedContentMode = coerceMarkdownContentMode(initialOpenTarget.contentMode, {
          typedownEnabled: FEATURE_TYPEDOWN_ENABLED,
          fallback: 'rendered',
        });
        if (requestedContentMode === 'markdown') {
          setContentMode('markdown');
          setFocusImmersive(true);
          focusMarkdownEditorOnOpenRef.current = true;
          const page = await window.wikiAPI?.getPage(initialOpenTarget.path);
          if (page) {
            const selectionStart = typeof initialOpenTarget.selectionStart === 'number'
              ? initialOpenTarget.selectionStart
              : page.content.length;
            const selectionEnd = typeof initialOpenTarget.selectionEnd === 'number'
              ? initialOpenTarget.selectionEnd
              : selectionStart;
            pendingRenderedEditSelectionRef.current = selectionStart;
            pendingRenderedEditSelectionEndRef.current = selectionEnd;
            dispatchLocalWikiAdded(page);
            setWikiSelectedPage(readingFromWikiPage(page));
            setEditContent(page.content);
            lastSavedContentRef.current = page.content;
            lastSavedVersionRef.current = page.documentVersion;
          }
        } else if (requestedContentMode === 'typedown') {
          setContentMode('typedown');
        } else {
          setContentMode('rendered');
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
    } else if (initialOpenTarget.kind === 'bookmarks') {
      setSearchQuery('');
      setSelectedItemId(BOOKMARKS_ITEM_ID);
      setSelectedItemType('bookmarks');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
      setExternalOpenFile(null);
      setContentMode('rendered');
      onInitialOpenTargetConsumed?.();
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

  const createDefaultWikiFileInFolder = useCallback(async (folderRelPath: string, openInNewWindow: boolean) => {
    const page = await window.wikiAPI?.createFileWithDefaultTitle(folderRelPath);
    if (!page) return false;
    dispatchLocalWikiAdded(page);
    if (openInNewWindow) {
      openDocumentTargetInWindow({ kind: 'wiki', path: page.relPath, contentMode: 'rendered' });
      return true;
    }
    openPageForTitleEdit(page);
    return true;
  }, [openDocumentTargetInWindow, openPageForTitleEdit]);

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
    selectedItemIdRef.current = item.id;
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
    } else if (item.type === 'bookmarks') {
      setSelectedItemId(BOOKMARKS_ITEM_ID);
      setSelectedItemType('bookmarks');
      setSelectedPath(null);
      setWikiSelectedRelPath(null);
      setExternalOpenFile(null);
      setContentMode('rendered');
    } else if (item.type === 'ember') {
      setSelectedItemId(EMBER_ITEM_ID);
      setSelectedItemType('ember');
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

  const handleOpenSidebarItemInWindow = useCallback((item: UnifiedItem, options: { sidebarCollapsed?: boolean } = {}) => {
    const clearSource = isSidebarItemActiveDocument(item);
    if (item.type === 'wiki' && item.relPath) {
      openDocumentTargetInWindow({ kind: 'wiki', path: item.relPath, contentMode: 'rendered', sidebarCollapsed: options.sidebarCollapsed }, clearSource);
    } else if (item.type === 'artifact') {
      openDocumentTargetInWindow({ kind: 'artifact', path: item.absPath, contentMode: 'rendered', sidebarCollapsed: options.sidebarCollapsed }, clearSource);
    } else if (item.type === 'external') {
      openDocumentTargetInWindow({ kind: 'external', path: item.absPath, contentMode: 'rendered', sidebarCollapsed: options.sidebarCollapsed }, clearSource);
    }
  }, [isSidebarItemActiveDocument, openDocumentTargetInWindow]);

  const openEmberPerson = useCallback((relPath: string) => {
    openWikiPage(relPath);
    setContentMode('rendered');
  }, [openWikiPage]);

  const handleDeletedLibraryItem = useCallback((item: UnifiedItem) => {
    const deletedSelection = deletedLibraryItemMatchesSelection(item, {
      selectedItemId,
      selectedItemType,
      wikiSelectedRelPath,
      selectedPath,
    });
    if (deletedSelection) clearSelectedLibraryItem();
  }, [clearSelectedLibraryItem, selectedItemId, selectedItemType, selectedPath, wikiSelectedRelPath]);

  useEffect(() => {
    if (!activeReading || contentMode === 'markdown') return;
    const normalizedContent = removeEmptyMarkdownCommentPlaceholders(activeReading.content);
    setEditContent(normalizedContent);
    lastSavedContentRef.current = normalizedContent;
    lastSavedVersionRef.current = activeReading.documentVersion;
  }, [activeReading?.path, contentMode]);

  // Seed editContent when the user enters markdown mode on a file, or when
  // they switch to a different file while editing. Guarded by path so that
  // activeReading updates caused by our own save don't clobber in-progress
  // edits (setWikiSelectedPage after a write produces a new object but the
  // path is unchanged).
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

  const flashCopyFeedback = useCallback((label: string) => {
    setCopyFeedbackLabel(label);
    if (copyPathFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyPathFeedbackTimerRef.current);
    }
    copyPathFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedbackLabel(null);
      copyPathFeedbackTimerRef.current = null;
    }, COPY_PATH_FEEDBACK_MS);
  }, []);

  const handleToggleSharedFile = useCallback(async () => {
    if (!sharedFilesAvailable || !activeReading || !activeReadingPath || !activeIsMarkdownDocument) return;
    if (!sharedFileStatus?.shared && !sharedFilesCanWrite) {
      flashCopyFeedback('Accept team invite to share');
      return;
    }

    setIsTogglingSharedFile(true);
    try {
      await flushCurrentEdit();
      if (sharedFileStatus?.shared) {
        const success = await window.sharedFilesAPI?.unshare(activeReadingPath);
        if (success) {
          setSharedFileStatus({ shared: false });
          window.dispatchEvent(new Event(LOCAL_RIVER_CHANGED_EVENT));
          flashCopyFeedback('Removed from River');
        } else {
          flashCopyFeedback('River remove failed');
        }
        return;
      }

      const content = activeReadingContentRef.current ?? activeReading.content;
      const status = await window.sharedFilesAPI?.share({
        filePath: activeReadingPath,
        title: activeReading.title,
        content,
        type: inferSharedFileTypeForActiveReading(activeReadingPath),
      });
      const nextStatus = status ?? { shared: false, error: 'River share failed' };
      setSharedFileStatus(nextStatus);
      if (nextStatus.shared) {
        window.dispatchEvent(new Event(LOCAL_RIVER_CHANGED_EVENT));
        flashCopyFeedback('Added to River');
      } else {
        flashCopyFeedback(nextStatus.error ?? 'River share failed');
      }
    } catch (err) {
      console.error('[Librarian] River sharing error:', err);
      flashCopyFeedback('River share failed');
    } finally {
      setIsTogglingSharedFile(false);
    }
  }, [activeIsMarkdownDocument, activeReading, activeReadingPath, flashCopyFeedback, flushCurrentEdit, sharedFileStatus?.shared, sharedFilesAvailable, sharedFilesCanWrite]);

  const copyShareLink = useCallback(async () => {
    if (!shareStatus?.url) return;
    await navigator.clipboard.writeText(shareStatus.url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }, [shareStatus?.url]);

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

  const getActiveReadingCopyPayload = useCallback((): { text: string; label: string } | null => {
    const text = getActiveReadingCopyText();
    if (!text) return null;
    return {
      text,
      label: text === activeReading?.path ? 'Copied file path' : 'Copied segment',
    };
  }, [activeReading?.path, getActiveReadingCopyText]);

  const copyActiveReadingTextOrPath = useCallback(async () => {
    const payload = getActiveReadingCopyPayload();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload.text);
      flashCopyFeedback(payload.label);
    } catch (err) {
      console.warn('[Librarian] Failed to copy text or path:', err);
    }
  }, [flashCopyFeedback, getActiveReadingCopyPayload]);

  const copyActiveReadingPath = useCallback(async () => {
    if (!activeReading?.path) return;
    try {
      await navigator.clipboard.writeText(activeReading.path);
      flashCopyFeedback('Copied file path');
    } catch (err) {
      console.warn('[Librarian] Failed to copy path:', err);
    }
  }, [activeReading?.path, flashCopyFeedback]);

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
        message: `Move "${selectedReading.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          if (shareStatus?.shared) {
            await window.librarianAPI?.unshareReading(selectedPath);
          }
          const success = await window.librarianAPI?.deleteReading(selectedPath);
          if (success) clearSelectedLibraryItem();
        },
      });
      return;
    }

    if (selectedItemType === 'external') {
      if (!activeReading?.path) return;
      confirmDelete({
        title: 'Delete file?',
        message: `Move "${activeReading.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          const success = await window.externalAPI?.delete(activeReading.path);
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
      if (page) {
        const reading = readingFromWikiPage(page);
        applyLiveDiskDocumentState('wiki', reading.path, reading);
        return;
      }
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
  }, [applyLiveDiskDocumentState, contentMode, editContent, wikiSelectedRelPath]);

  useEffect(() => {
    if (selectedItemType !== 'external' || !externalOpenFile?.path) return;
    let cancelled = false;
    const previousPath = externalOpenFile.path;
    const unsubscribe = window.libraryAPI?.onRootsChanged(async () => {
      const file = await window.externalAPI?.open(previousPath);
      if (file) {
        const reading = readingFromExternalMarkdownFile(file);
        applyLiveDiskDocumentState('external', reading.path, reading);
        return;
      }
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
  }, [applyLiveDiskDocumentState, contentMode, editContent, externalOpenFile?.path, selectedItemType]);

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
          (initialSelection?.type === 'artifact' ? initialSelection.path : null);

        if (preferredArtifactPath && result.some((reading) => reading.path === preferredArtifactPath)) {
          selectArtifactPath(preferredArtifactPath);
        } else if (result.length > 0 && !initialSelection && !hadInitialOpenTargetRef.current) {
          // Only default to the first artifact on a fresh session. Any
          // restored/initial selection (wiki, bookmarks, or an artifact that's since
          // been deleted) takes precedence and should not be clobbered.
          selectArtifactPath(result[0].path);
        }
      }
      setLoading(false);
    }
    loadReadings();
  }, [initialReadingPath, initialSelection, selectArtifactPath]);

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

  useEffect(() => {
    let cancelled = false;
    async function loadSharedFileStatus() {
      if (!sharedFilesAvailable || !activeReadingPath || !activeIsMarkdownDocument) {
        sharedFileStatusPathRef.current = null;
        setSharedFileStatus(null);
        return;
      }
      const status = await window.sharedFilesAPI?.getStatus(activeReadingPath);
      if (!cancelled) {
        const nextStatus = status ?? { shared: false };
        sharedFileStatusPathRef.current = activeReadingPath;
        sharedFileStatusRef.current = nextStatus;
        setSharedFileStatus(nextStatus);
      }
    }
    void loadSharedFileStatus();
    return () => {
      cancelled = true;
    };
  }, [activeIsMarkdownDocument, activeReadingPath, sharedFilesAvailable]);

  useEffect(() => {
    const sharedId = sharedFileStatus?.shared ? sharedFileStatus.sharedId ?? null : null;
    if (!active || !sharedId) {
      setSharedFilePresenceUsers([]);
      void window.sharedFilesAPI?.setActivePresence(null);
      return;
    }

    let cancelled = false;
    const unsubscribe = window.sharedFilesAPI?.onPresenceChanged((payload) => {
      if (payload.sharedId === sharedId) setSharedFilePresenceUsers(payload.users);
    });
    void window.sharedFilesAPI?.setActivePresence(sharedId).then((users) => {
      if (!cancelled) setSharedFilePresenceUsers(users ?? []);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      void window.sharedFilesAPI?.setActivePresence(null);
    };
  }, [active, sharedFileStatus?.shared, sharedFileStatus?.sharedId]);

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
          if (result) {
            applyLiveDiskDocumentState('artifact', result.path, result);
          } else {
            setSelectedReading(null);
          }
        });
      }
    });

    return () => unsubscribe?.();
  }, [applyLiveDiskDocumentState, selectedPath]);

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
      if (isTerminalPanelVisibilityToggleShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleCodexTerminalPanel({ restoreEditorFocus: isCodexTerminalEventTarget(e.target) });
        return;
      }

      if (isTerminalEditorFocusToggleShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleTerminalEditorFocus({ restoreEditorFocus: isCodexTerminalEventTarget(e.target) });
        return;
      }

      if (isImmersiveToggleShortcut(e)) {
        e.preventDefault();
        toggleFocusChromeShortcut();
        return;
      }
      if (isLineNumbersToggleShortcut(e)) {
        e.preventDefault();
        toggleLineNumbers('visible');
        return;
      }
      if (isFadedLineNumbersShortcut(e)) {
        e.preventDefault();
        toggleLineNumbers('faded');
        return;
      }
      // Cmd+; - cycles the available markdown content modes.
      if (isMarkdownModeToggleShortcut(e)) {
        e.preventDefault();
        const nextMode = getNextMarkdownContentMode(contentMode, {
          typedownEnabled: activeIsMarkdownDocument && FEATURE_TYPEDOWN_ENABLED,
        });
        if (nextMode === 'rendered') {
          void exitEditMode();
        } else if (nextMode === 'markdown' && activeReading) {
          enterEditMode();
        } else if (nextMode === 'typedown') {
          void switchToTypedownMode();
        }
        return;
      }

      if (sharedFilesAvailable && (sharedFilesCanWrite || sharedFileStatus?.shared) && isSharedFileToggleShortcut(e, sharedFileToggleHotkey) && activeReading?.path && activeIsMarkdownDocument) {
        e.preventDefault();
        void handleToggleSharedFile();
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

      // Cmd+N - create new file in the current wiki directory.
      if (e.key === 'n' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const folder = resolveCurrentWikiCreateFolder(selectedItemType, wikiSelectedRelPath);
        wikiCreationRef.current?.beginCreateFile(folder);
        return;
      }

      // Cmd+Shift+N - create a default page in the current wiki directory and pop it out.
      if (e.key === 'n' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        const folder = resolveCurrentWikiCreateFolder(selectedItemType, wikiSelectedRelPath);
        void createDefaultWikiFileInFolder(folder, true);
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
      const navigationDirection = getLibrarianBracketNavigationDirection(e, { canNavigateBack, canNavigateForward });
      if (navigationDirection !== null && navigationDirection !== 0) {
        e.preventDefault();
        navigateHistory(navigationDirection);
        return;
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

      if (
        isCommandDeleteShortcut(e)
        && sidebarKeyboardActiveRef.current
        && (selectedItemType === 'wiki' || selectedItemType === 'artifact' || selectedItemType === 'external')
      ) {
        e.preventDefault();
        if (wikiArchiveRef.current?.hasExplicitSelection() && wikiArchiveRef.current.deleteSelectedItems()) {
          return;
        }
        handleDelete();
        return;
      }

      if (shouldHandleMarkdownTodoTabShortcut({ key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, selectedItemType })) {
        e.preventDefault();
        if (wikiArchiveRef.current?.hasExplicitSelection()) {
          void wikiArchiveRef.current.cycleSelectedTodoState(e.shiftKey ? 'backward' : 'forward');
          return;
        }
        void cycleSelectedMarkdownTodoState(e.shiftKey ? 'backward' : 'forward');
        return;
      }

      if (
        sidebarKeyboardActiveRef.current
        && e.key.toLowerCase() === 'z'
        && e.metaKey
        && !e.shiftKey
        && !e.ctrlKey
        && !e.altKey
        && wikiArchiveRef.current?.hasArchiveUndo()
      ) {
        e.preventDefault();
        void wikiArchiveRef.current.undoArchive();
        return;
      }

      if (
        sidebarKeyboardActiveRef.current
        && e.key.toLowerCase() === 'e'
        && !e.metaKey
        && !e.shiftKey
        && !e.ctrlKey
        && !e.altKey
        && wikiArchiveRef.current?.canArchiveSelected()
      ) {
        e.preventDefault();
        void wikiArchiveRef.current.toggleSelectedArchive();
        return;
      }

      if (
        sidebarKeyboardActiveRef.current
        && e.key.toLowerCase() === 'x'
        && !e.metaKey
        && !e.shiftKey
        && !e.ctrlKey
        && !e.altKey
        && wikiArchiveRef.current?.toggleFocusedSelection(selectedItemIdRef.current)
      ) {
        e.preventDefault();
        return;
      }

      if (
        sidebarKeyboardActiveRef.current
        && e.key === 'Tab'
        && !e.metaKey
        && !e.shiftKey
        && !e.ctrlKey
        && !e.altKey
      ) {
        e.preventDefault();
        focusActiveFileBodyAtEnd();
        return;
      }

      if (
        sidebarKeyboardActiveRef.current
        && e.key === 'Enter'
        && !e.metaKey
        && !e.shiftKey
        && !e.ctrlKey
        && !e.altKey
        && wikiArchiveRef.current?.renameFocusedItem(selectedItemIdRef.current)
      ) {
        e.preventDefault();
        return;
      }

      if (!isSidebarNavigationKey) return;
      if (!sidebarKeyboardActiveRef.current) return;

      // Arrow key / j/k navigation through the current sidebar folder.
      const items = flatItemsRef.current;
      if (items.length > 0) {
        const currentIdx = items.findIndex((i) => i.id === selectedItemIdRef.current);
        if (currentIdx < 0) return;
        if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          const newIdx = Math.max(0, currentIdx - 1);
          if (newIdx === currentIdx) return;
          selectedItemIdRef.current = items[newIdx].id;
          handleSelectItem(items[newIdx]);
        } else if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          const newIdx = Math.min(items.length - 1, currentIdx + 1);
          if (newIdx === currentIdx) return;
          selectedItemIdRef.current = items[newIdx].id;
          handleSelectItem(items[newIdx]);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, readings, selectedPath, isFullScreen, focusImmersive, contentMode, activeReading, activeIsMarkdownDocument, onSwitchToClipboard, enterEditMode, exitEditMode, switchToTypedownMode, flushCurrentEdit, handleCreateFile, handleCreateDir, selectedItemId, handleSelectItem, selectedItemType, handleDelete, handleToggleSharedFile, cycleSelectedMarkdownTodoState, focusActiveFileBodyAtEnd, isOnAutoPopArtifact, toggleFocusChromeShortcut, toggleImmersive, toggleLineNumbers, toggleTerminalEditorFocus, toggleCodexTerminalPanel, canNavigateBack, canNavigateForward, navigateHistory, openFileFind, copyActiveReadingTextOrPath, copyActiveReadingPath, sharedFileToggleHotkey, sharedFileStatus?.shared, sharedFilesAvailable, sharedFilesCanWrite, shortcutsHelpOpen, createDefaultWikiFileInFolder, wikiSelectedRelPath]);

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
        folders.flatMap((f) => f.files.map((p) => ({ relPath: p.relPath, title: p.title, absPath: p.absPath }))),
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

  const renderMarkdownWikiLinkSuggestionMenu = (
    onSelectSuggestion: (
      suggestion: MarkdownWikiLinkSuggestion,
      completion: MarkdownWikiLinkCompletion,
    ) => void,
  ) => {
    const completion = markdownWikiLinkCompletion;
    if (!completion || markdownWikiLinkSuggestions.length === 0) return null;

    return (
      <div
        role="listbox"
        aria-label="Wiki link suggestions"
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position: 'absolute',
          top: `${completion.top}px`,
          left: `${completion.left}px`,
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
              onClick={() => onSelectSuggestion(suggestion, completion)}
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
    );
  };

  const sidebarForcedVisible = sidebarForcedVisibleForEmptySelection || (!hadInitialOpenTargetRef.current && !activeReading && !isFullScreen);
  const sidebarTemporarilyExpanded = effectiveSidebarCollapsed && sidebarHoverExpanded && !isFullScreen && !sidebarForcedVisible;
  const sidebarVisible = !effectiveSidebarCollapsed || sidebarTemporarilyExpanded || sidebarForcedVisible;
  const handleCollapsedSidebarSurfaceMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarTemporarilyExpanded) return;
    const target = event.target;
    if (target instanceof Node && sidebarPaneRef.current?.contains(target)) return;
    setSidebarHoverExpanded(false);
  }, [sidebarTemporarilyExpanded]);

  const inlineDrawDialog = inlineDrawInsertion ? (
    <div
      role="dialog"
      aria-label="Draw"
      style={{
        position: 'absolute',
        top: '42px',
        bottom: '32px',
        left: 0,
        right: 0,
        zIndex: 40,
        display: 'flex',
        overflow: 'hidden',
        borderRadius: '8px',
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.isDark ? '#111' : '#fff',
        boxShadow: theme.isDark ? '0 24px 70px rgba(0,0,0,0.55)' : '0 24px 70px rgba(0,0,0,0.22)',
      }}
    >
      {inlineDrawSaving && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: '10px',
            right: '12px',
            zIndex: 2,
            padding: '4px 8px',
            borderRadius: '5px',
            fontSize: '11px',
            color: theme.textSecondary,
            backgroundColor: theme.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)',
            border: `1px solid ${theme.border}`,
          }}
        >
          Saving...
        </div>
      )}
      <Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textSecondary }}>Loading...</div>}>
        <SketchView
          onSave={handleInlineDrawSave}
          onClose={handleInlineDrawClose}
          existingSketch={null}
          backgroundImage={inlineDrawInsertion.backgroundImage ?? null}
        />
      </Suspense>
    </div>
  ) : null;

  // Setup wizard - shown on first visit
  if (!loading && setupComplete === false) {
    return <LibrarianSetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseDownCapture={handleCollapsedSidebarSurfaceMouseDownCapture}
      onMouseMove={collapsedSidebarHoverReveal.handleSurfaceMouseMove}
      onMouseLeave={collapsedSidebarHoverReveal.handleSurfaceMouseLeave}
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
      {effectiveSidebarCollapsed && !sidebarHidden && !sidebarTemporarilyExpanded && !sidebarForcedVisible && (
        <div
          aria-hidden="true"
          data-fieldtheory-collapsed-sidebar-hover-strip="true"
          onMouseOver={collapsedSidebarHoverReveal.handleHoverStripMouseOver}
          onClick={collapsedSidebarHoverReveal.handleHoverStripClick}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${collapsedSidebarHoverReveal.hoverStripWidth}px`,
            zIndex: 25,
            cursor: 'pointer',
            opacity: collapsedSidebarHoverReveal.affordanceOpacity,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
            boxShadow: theme.isDark ? 'inset 1px 0 rgba(255,255,255,0.16)' : 'inset 1px 0 rgba(0,0,0,0.14)',
            transition: 'opacity 120ms ease',
          }}
        />
      )}
      <style>
        {`
          @keyframes ftMarkdownEditorFadeIn {
            from { opacity: 0.72; }
            to { opacity: 1; }
          }
        `}
      </style>
      {/* Sidebar - hidden in full-screen mode but kept in DOM for instant collapse */}
      <div
        ref={sidebarPaneRef}
        data-fieldtheory-collapsed-sidebar-pane="true"
        style={{
          width: sidebarVisible ? `${sidebarWidth}px` : '0px',
          minWidth: sidebarVisible ? `${sidebarWidth}px` : '0px',
          display: sidebarHidden ? 'none' : 'block',
          overflow: 'hidden',
          userSelect: isResizing ? 'none' : 'auto',
          flexShrink: 0,
          zIndex: sidebarTemporarilyExpanded ? 30 : undefined,
          boxShadow: sidebarTemporarilyExpanded ? (theme.isDark ? '12px 0 24px rgba(0,0,0,0.36)' : '12px 0 24px rgba(0,0,0,0.12)') : undefined,
          transition: animateResponsiveSidebar ? 'width 0.18s ease, min-width 0.18s ease' : 'none',
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
            pointerEvents: sidebarVisible ? 'auto' : 'none',
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
            archiveControllerRef={wikiArchiveRef}
            onOpenItemInNewWindow={handleOpenSidebarItemInWindow}
            onSidebarItemContentChanged={handleSidebarItemContentChanged}
            onDeletedItem={handleDeletedLibraryItem}
            onKeyboardScopeActive={activateSidebarKeyboard}
          />
        </div>
      </div>
      {/* Resize handle - hidden in full-screen mode but kept in DOM */}
      <div
        data-fieldtheory-sidebar-resize-handle="true"
        onMouseDown={handleResizeMouseDown}
        style={{
          width: sidebarVisible ? '4px' : '0px',
          minWidth: sidebarVisible ? '4px' : '0px',
          cursor: 'col-resize',
          backgroundColor: isResizing ? theme.accent : 'transparent',
          borderRight: sidebarVisible && !sidebarTemporarilyExpanded ? `1px solid ${theme.border}` : '0 solid transparent',
          transition: animateResponsiveSidebar ? 'width 0.18s ease, min-width 0.18s ease, background-color 0.15s ease' : 'background-color 0.15s ease',
          flexShrink: 0,
          display: sidebarHidden ? 'none' : 'block',
          pointerEvents: sidebarVisible ? 'auto' : 'none',
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
          flexDirection: effectiveCodexTerminalVisible && effectiveCodexTerminalDockSide === 'right' ? 'row' : 'column',
          overflow: focusChromeActive && effectiveCodexTerminalVisible && effectiveCodexTerminalDockSide === 'right' ? 'visible' : 'hidden',
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
              minWidth: 0,
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
        {emberEverShown && (
          <div
            style={{
              flex: 1,
              display: selectedItemType === 'ember' ? 'flex' : 'none',
              flexDirection: 'column',
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <EmberPane
              active={active && selectedItemType === 'ember'}
              onOpenPerson={openEmberPerson}
              onPersonCreated={dispatchLocalWikiAdded}
            />
          </div>
        )}
        {selectedItemType !== 'bookmarks' && selectedItemType !== 'ember' && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
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
              backgroundColor: focusChromeActive && !activeReadingToolbarIdentityPinned ? 'transparent' : theme.bg,
              flexShrink: 0,
              position: focusChromeActive ? 'absolute' : 'relative',
              top: focusChromeActive ? 0 : undefined,
              left: focusChromeActive ? 0 : undefined,
              right: focusChromeActive ? 0 : undefined,
              zIndex: focusChromeActive ? 20 : undefined,
              boxSizing: 'border-box',
              opacity: 1,
              pointerEvents: focusChromeActive ? 'none' : 'auto',
            }}
          >
            {/* Inner container - always matches the centered document width. */}
            <div
              style={{
                maxWidth: documentMaxWidth,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Nav: back (only visible in fullscreen). Copy-path moved to
                  the right of the immersive toggle inside ContentToolbar. */}
              {isFullScreen && !focusChromeActive && (
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
              {activeReadingToolbarIdentityVisible && activeReading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    flexShrink: 1,
                    opacity: activeReadingToolbarIdentityPinned ? 1 : focusChromeScopedItemOpacity,
                    pointerEvents: activeReadingToolbarIdentityPinned || focusChromeScopedItemVisible ? 'auto' : 'none',
                    transition: 'opacity 90ms linear',
                    // @ts-ignore - opt the breadcrumb out of the drag region so
                    // clicks on the External chip's title tooltip land.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={activeReading.path}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1px', marginRight: '2px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => navigateHistory(-1)}
                      disabled={!canNavigateBack}
                      title="Back"
                      aria-label="Back"
                      style={{
                        width: '22px',
                        height: '24px',
                        padding: 0,
                        color: theme.textSecondary,
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: canNavigateBack ? 'pointer' : 'default',
                        opacity: canNavigateBack ? 1 : 0.32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M10.354 3.146a.5.5 0 0 1 0 .708L6.207 8l4.147 4.146a.5.5 0 0 1-.708.708l-4.5-4.5a.5.5 0 0 1 0-.708l4.5-4.5a.5.5 0 0 1 .708 0z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateHistory(1)}
                      disabled={!canNavigateForward}
                      title="Forward"
                      aria-label="Forward"
                      style={{
                        width: '22px',
                        height: '24px',
                        padding: 0,
                        color: theme.textSecondary,
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: canNavigateForward ? 'pointer' : 'default',
                        opacity: canNavigateForward ? 1 : 0.32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.646 3.146a.5.5 0 0 0 0 .708L9.793 8l-4.147 4.146a.5.5 0 0 0 .708.708l4.5-4.5a.5.5 0 0 0 0-.708l-4.5-4.5a.5.5 0 0 0-.708 0z" />
                      </svg>
                    </button>
                  </div>
                  {!focusChromeActive && (
                    <ContentToolbarFolderButton onShowInFolder={showActiveReadingInFolder} />
                  )}
                  <span
                    data-ft-active-document-identity="true"
                    style={{
                      fontSize: '11px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'system-ui, sans-serif',
                      minWidth: 0,
                    }}
                  >
                    {topFadeActive ? (
                      <>
                        <span
                          data-ft-active-document-scrolled-title="true"
                          style={{
                            color: theme.text,
                            fontWeight: 600,
                          }}
                        >
                          {activeReading.title}
                        </span>
                        {activeReadingBreadcrumbLabel && (
                          <span style={{ color: theme.textSecondary }}>
                            {' · '}
                            {activeReadingBreadcrumbLabel}
                          </span>
                        )}
                      </>
                    ) : (
                      activeReadingBreadcrumbLabel
                    )}
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
              {focusToolbarControlsVisible && (
                <ContentToolbar
                  filePath={activeReading?.path || undefined}
                  isFullScreen={isFullScreen}
                  dragSpacer={!focusChromeActive}
                  textSize={textSize}
                  onTextSizeChange={setTextSize}
                  showTextSize
                  typographyPreset={typographyPresetId}
                  typographyPresetOptions={LIBRARIAN_TYPOGRAPHY_PRESETS}
                  onTypographyPresetChange={(preset) => {
                    if (isLibrarianTypographyPresetId(preset)) {
                      setTypographyPresetId(preset);
                    }
                  }}
                  lineHeight={lineHeightId}
                  lineHeightOptions={LIBRARIAN_LINE_HEIGHT_OPTIONS}
                  onLineHeightChange={(lineHeight) => {
                    if (isLibrarianLineHeightId(lineHeight)) {
                      setLineHeightId(lineHeight);
                    }
                  }}
                  unorderedListMarker={unorderedListMarker}
                  onUnorderedListMarkerChange={setUnorderedListMarker}
                  todoMarker={todoMarker}
                  onTodoMarkerChange={setTodoMarker}
                  onTypographyMenuOpenChange={setFocusToolbarMenuOpen}
                  onDelete={handleDelete}
                  showDelete
                  onShowInFolder={activeReadingPath ? showActiveReadingInFolder : undefined}
                  showFolder={!activeReadingToolbarIdentityVisible}
                  onCopy={shareStatus?.shared ? copyShareLink : undefined}
                  showCopy={!!shareStatus?.shared}
                  onCopyPath={activeReading?.path ? copyActiveReadingTextOrPath : undefined}
                  copyPathTitle="Copy selected text or file path (⌘C)"
                />
              )}
              {sharedFileStatus?.shared && sharedFilePresenceUsers.length > 0 && (
                <div
                  aria-label="River viewers"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    marginLeft: '4px',
                    flexShrink: 0,
                  }}
                >
                  {sharedFilePresenceUsers.slice(0, 4).map((user) => (
                    <span
                      key={user.userId}
                      title={user.email ?? 'Viewing this River file'}
                      style={{
                        minWidth: '22px',
                        height: '22px',
                        padding: '0 5px',
                        borderRadius: '999px',
                        border: `1px solid ${theme.border}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 700,
                        color: theme.textSecondary,
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      }}
                    >
                      {user.initials}
                    </span>
                  ))}
                </div>
              )}

              {meetingToolbarVisible && (
                <button
                  type="button"
                  onClick={() => void handleMeetingToolbarClick()}
                  disabled={meetingToolbarDisabled}
                  title={meetingToolbarTitle}
                  aria-label={meetingToolbarTitle}
                  style={{
                    width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    padding: 0,
                    color: meetingToolbarRecording ? '#dc2626' : theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: meetingToolbarDisabled ? 'default' : 'pointer',
                    opacity: meetingToolbarDisabled ? 0.65 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.15s ease, color 0.15s ease',
                    // @ts-ignore - opt out of the drag region so the click lands.
                    WebkitAppRegion: 'no-drag',
                  }}
                  onMouseEnter={(e) => {
                    if (meetingToolbarDisabled) return;
                    e.currentTarget.style.backgroundColor = meetingToolbarRecording
                      ? 'rgba(220,38,38,0.08)'
                      : theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
                    e.currentTarget.style.color = meetingToolbarRecording ? '#b91c1c' : theme.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = meetingToolbarRecording ? '#dc2626' : theme.textSecondary;
                  }}
                >
                  {meetingToolbarRecording ? (
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <rect x="4" y="4" width="8" height="8" rx="1.5" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="8" cy="8" r="2.25" fill="currentColor" />
                    </svg>
                  )}
                </button>
              )}

              {focusToolbarControlsVisible && (
                <ContentToolbarMaxwellButton
                  items={maxwellToolbarItems}
                  canAddCurrent={!!activeMaxwellItem}
                  currentItemId={activeMaxwellItem?.id ?? null}
                  onAddCurrent={addActivePageToMaxwell}
                  onVisitItem={visitMaxwellItem}
                  onRunItem={runMaxwellItem}
                  onRemoveItem={removeMaxwellItem}
                />
              )}

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
                    width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    padding: 0,
                    fontSize: '12px',
                    fontWeight: 500,
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
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
              {focusToolbarControlsVisible && FEATURE_NARRATION_ENABLED && selectedReading && contentMode !== 'markdown' && (
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
              {focusToolbarControlsVisible && sharedFilesAvailable && (sharedFilesCanWrite || sharedFileStatus?.shared) && activeIsMarkdownDocument && (
                <button
                  type="button"
                  onClick={handleToggleSharedFile}
                  disabled={isTogglingSharedFile}
                  style={{
                    height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    padding: 0,
                    fontSize: '11px',
                    color: sharedFileStatus?.shared ? '#2563eb' : (theme.isDark ? 'rgba(255,255,255,0.66)' : 'rgba(17,17,17,0.58)'),
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isTogglingSharedFile ? 'default' : 'pointer',
                    opacity: isTogglingSharedFile ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    // @ts-ignore - opt out of the drag region so the click lands.
                    WebkitAppRegion: 'no-drag',
                  }}
                  title={sharedFileStatus?.shared ? 'Remove from River (shared)' : 'Add to River (shared)'}
                  aria-label={sharedFileStatus?.shared ? 'Remove from River (shared)' : 'Add to River (shared)'}
                >
                  <SidebarRiverIcon
                    color={sharedFileStatus?.shared ? '#2563eb' : (theme.isDark ? 'rgba(255,255,255,0.66)' : 'rgba(17,17,17,0.58)')}
                    style={{ opacity: isTogglingSharedFile ? 0.35 : 1 }}
                  />
                </button>
              )}
              {focusToolbarControlsVisible && activeReadingPath
                && (selectedItemType === 'wiki' || selectedItemType === 'artifact' || selectedItemType === 'external')
                && (
                  <button
                    type="button"
                    onClick={openActiveDocumentInWindow}
                    title="Open in New Window"
                    aria-label="Open in New Window"
                    style={{
                      height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                      width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                      boxSizing: 'border-box',
                      padding: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '5px',
                      cursor: 'pointer',
                      flexShrink: 0,
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
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M6 3H3.75C3.06 3 2.5 3.56 2.5 4.25v8C2.5 12.94 3.06 13.5 3.75 13.5h8c.69 0 1.25-.56 1.25-1.25V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 2.5h4.5V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M8.5 7.5 13.25 2.75" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              {focusToolbarControlsVisible && (
                <ContentModeToggleButton
                  mode={contentMode}
                  disabled={activeIsSourceOnlyDocument}
                  sourceLabel={activeIsMarkdownDocument ? 'Switch to Markdown source' : 'Switch to source'}
                  onSwitchToSource={() => {
                    if (activeReading) enterEditMode();
                  }}
                  onSwitchToRendered={() => {
                    void exitEditMode();
                  }}
                  onSwitchToTypedown={() => {
                    void switchToTypedownMode();
                  }}
                  typedownEnabled={activeIsMarkdownDocument && FEATURE_TYPEDOWN_ENABLED}
                />
              )}
              {focusToolbarControlsVisible && (
                <button
                  type="button"
                  onClick={() => toggleCodexTerminalPanel()}
                  title={codexTerminalVisible ? 'Close Terminal' : 'Open Terminal'}
                  aria-label={codexTerminalVisible ? 'Close Terminal' : 'Open Terminal'}
                  style={{
                    height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
                    boxSizing: 'border-box',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: codexTerminalVisible ? '#10b981' : theme.textSecondary,
                    backgroundColor: codexTerminalVisible
                      ? (theme.isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)')
                      : 'transparent',
                    border: `1px solid ${codexTerminalVisible ? 'rgba(16,185,129,0.36)' : theme.border}`,
                    borderRadius: '5px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    // @ts-ignore - opt out of the drag region so the click lands.
                    WebkitAppRegion: 'no-drag',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M2.75 4.25c0-.83.67-1.5 1.5-1.5h7.5c.83 0 1.5.67 1.5 1.5v7.5c0 .83-.67 1.5-1.5 1.5h-7.5c-.83 0-1.5-.67-1.5-1.5v-7.5Z" stroke="currentColor" strokeWidth="1.35" />
                    <path d="m5.25 6 2 2-2 2M8.25 10.25h2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

              {/* Immersive/fullscreen toggle sits to the right of the mode
                  toggle so the editor controls stay grouped together. */}
              <div
                style={{
                  marginLeft: focusToolbarControlsVisible ? undefined : 'auto',
                  opacity: focusChromeScopedItemOpacity,
                  pointerEvents: focusChromeScopedItemVisible ? 'auto' : 'none',
                  transition: 'opacity 90ms linear',
                }}
              >
                <ImmersiveToggle isFullScreen={isFullScreen || focusImmersive} onToggle={toggleFocusChromeShortcut} />
              </div>
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div
          onWheel={(event) => {
            const scrollEl = contentScrollRef.current;
            if (!scrollEl || contentMode === 'markdown') return;
            const target = event.target instanceof Node ? event.target : null;
            if (target && scrollEl.contains(target)) return;
            event.preventDefault();
            scrollEl.scrollBy({ top: event.deltaY, left: event.deltaX });
            updateRenderedDocumentTopFade(scrollEl);
          }}
          style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', justifyContent: 'center' }}
        >
        <div
          ref={setContentScrollRef}
          data-ft-librarian-content-scroll="true"
          onScroll={(e) => {
            if (contentMode !== 'markdown') updateRenderedDocumentTopFade(e.currentTarget);
          }}
          style={{
            flex: '0 1 auto',
            width: `min(100%, calc(${documentMaxWidth} + 64px))`,
            minHeight: 0,
            overflowY: contentMode === 'markdown' ? 'hidden' : 'auto',
            padding: `${contentTopPadding}px 32px 0 32px`,
            scrollPaddingBottom: `${contentBottomScrollSpace}px`,
            scrollbarGutter: contentMode === 'markdown' ? undefined : 'stable',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
        {activeReading ? (
          <div
            style={{
              maxWidth: documentMaxWidth,
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
                  minWidth: 0,
                  flex: '0 0 auto',
                  margin: contentMode === 'markdown' ? '0 0 18px 0' : '0 0 22px 0',
                  padding: 0,
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  color: theme.text,
                  fontSize: `${getLibrarianTitleFontSize(
                    editingTitlePath === activeTitlePath ? titleDraft : activeReading.title,
                    contentMode,
                  )}px`,
                  lineHeight: 1.18,
                  fontWeight: 650,
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  letterSpacing: 0,
                  textOverflow: 'ellipsis',
                }}
              />
            )}
            {activeReading && (
              <div
                title={getReadingUpdatedTitle(activeReading)}
                style={{
                  flex: '0 0 auto',
                  margin: contentMode === 'markdown' ? '-12px 0 14px 0' : '-16px 0 18px 0',
                  fontSize: '10px',
                  lineHeight: 1.2,
                  color: theme.textSecondary,
                  opacity: 0.52,
                  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                  userSelect: 'none',
                }}
              >
                {getReadingUpdatedByline(activeReading)}
              </div>
            )}
            {contentMode === 'markdown' || activeIsSourceOnlyDocument ? (
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
                    findQuery={fileFindOpen ? fileFindQuery : ''}
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
                      handleCodexTerminalLauncherTargetSessionChange(null);
                      window.librarianAPI?.setMarkdownEditorFocused(true);
                    }}
                    onBlur={() => {
                      window.librarianAPI?.setMarkdownEditorFocused(false);
                      setMarkdownWikiLinkCompletion(null);
                    }}
                    onSelectionChange={handleMarkdownCodeEditorSelectionChange}
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
                    lineNumbersMode={lineNumbersMode}
                    blinkCursor={blinkTextCursor}
                    cursorStyle={renderedTextCursorStyle}
                    blockCursorOpacity={renderedBlockCursorOpacity}
                    placeholder={activeIsMarkdownDocument ? 'Write your markdown here...' : 'Write your source here...'}
                    documentPath={activeReading.path}
	                    dataAttributes={{
	                      'data-ft-agent-context': activeIsMarkdownDocument ? 'markdown' : 'source',
	                      'data-ft-agent-file-path': activeReading.path,
	                      'data-ft-agent-title': activeReading.title,
	                    }}
	                  />
	                </div>
                {renderMarkdownWikiLinkSuggestionMenu(applyMarkdownWikiLinkSuggestion)}
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
              /* Rendered mode - editor-owned markdown presentation */
              <>
            <div
              ref={renderedContentRef}
              className="librarian-content"
              data-ft-rendered-editor-root="true"
              data-ft-rendered-editor-active={renderedEditingActive ? 'true' : 'false'}
              data-ft-rendered-editor-debug={renderedEditorDebugEnabled ? 'true' : 'false'}
              data-ft-rendered-editor-mode={contentMode}
              data-ft-rendered-editor-path={activeReading?.path ?? undefined}
              spellCheck
              tabIndex={activeReading ? 0 : undefined}
              onMouseDown={(event) => {
                deactivateSidebarKeyboard();
              }}
              onClick={(e) => {
                if (!activeReading) return;
                if (!activeIsMarkdownDocument) return;
                if (renderedEditingActiveRef.current) return;
                const target = e.target instanceof Element ? e.target : null;
                if (target?.closest('.cm-editor, .cm-content')) {
                  recordRenderedEditorDebug('click-ignored', { reason: 'code-editor-target', tagName: target.tagName });
                  return;
                }
                recordRenderedEditorDebug('click', {
                  detail: e.detail,
                  tagName: target?.tagName ?? null,
                  metaKey: e.metaKey,
                  ctrlKey: e.ctrlKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                });
                activateRenderedTextEditing();
              }}
              onKeyDown={(event) => {
                if (renderedEditingActiveRef.current || !activeReading || !activeIsMarkdownDocument) return;
                if (event.key !== 'Enter') return;
                event.preventDefault();
                activateRenderedTextEditing();
              }}
              onCopy={() => flashCopyFeedback('Copied segment')}
              style={{
                ...documentTextStyle,
                position: 'relative',
                outline: 'none',
                userSelect: 'text',
                cursor: activeReading && activeIsMarkdownDocument ? 'text' : 'default',
                caretColor: theme.accent,
              }}
            >
              {activeIsHtmlDocument && activeReadingPath ? (
                <iframe
                  title={activeReading.title}
                  data-ft-html-preview="true"
                  srcDoc={getHtmlPreviewSrcDoc(activeReadingContent ?? activeReading.content, activeReadingPath)}
                  sandbox=""
                  style={{
                    display: 'block',
                    width: '100%',
                    minHeight: '520px',
                    height: 'min(72vh, 820px)',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '6px',
                    backgroundColor: '#fff',
                  }}
                />
              ) : (
                <>
                  <MarkdownCodeEditor
                    ref={renderedMarkdownEditorRef}
                    presentation="rendered"
                    value={displaySourceBody}
                    findQuery={fileFindOpen ? fileFindQuery : ''}
                    onChange={handleRenderedEditorChange}
                    onKeyDown={handleRenderedEditorKeyDown}
                    onMouseDown={handleRenderedEditorMouseDown}
                    onPaste={handleRenderedEditorPaste}
                    onImagePreview={handleRenderedImageAction}
                    onFocus={() => {
                      deactivateSidebarKeyboard();
                      commitTitleEditIfActive();
                      handleCodexTerminalLauncherTargetSessionChange(null);
                      activateRenderedEditing();
                      window.librarianAPI?.setMarkdownEditorFocused(true);
                      recordRenderedEditorDebug('rendered-editor-focus', { state: getRenderedEditorDebugState() });
                    }}
                    onBlur={() => {
                      window.librarianAPI?.setMarkdownEditorFocused(false);
                      clearRenderedEditingState('blur');
                    }}
                    onSelectionChange={handleRenderedEditorSelectionChange}
                    fontFamily={(documentTextStyle.fontFamily as string) ?? '-apple-system, BlinkMacSystemFont, sans-serif'}
                    fontSize={(documentTextStyle.fontSize as string | number) ?? 16}
                    lineHeight={(documentTextStyle.lineHeight as string | number) ?? 1.6}
                    color={(documentTextStyle.color as string) ?? theme.text}
                    headingFontFamily={typographyPreset.headingFontFamily}
                    h1Size={textSizes[textSize].h1}
                    h2Size={textSizes[textSize].h2}
                    h3Size={textSizes[textSize].h3}
                    linkColor={theme.accent}
                    mutedColor={theme.textSecondary}
                    paragraphSpacing={documentParagraphSpacing}
                    background="transparent"
                    caretColor={theme.accent}
                    lineNumbersMode={lineNumbersMode}
                    blinkCursor={blinkTextCursor}
                    cursorStyle={renderedTextCursorStyle}
                    blockCursorOpacity={renderedBlockCursorOpacity}
                    placeholder="Rendered text editor"
                    documentPath={activeReading.path}
                    dataAttributes={{
                      'data-ft-rendered-editor-input': 'true',
                      'data-ft-agent-context': 'markdown',
                      'data-ft-agent-file-path': activeReading.path,
                      'data-ft-agent-title': activeReading.title,
                    }}
                    spellCheck
                    bottomRoomPx={0}
                    style={{
                      width: '100%',
                      minHeight: '160px',
                      height: 'auto',
	                    }}
	                  />
	                  {renderMarkdownWikiLinkSuggestionMenu(applyRenderedWikiLinkSuggestion)}
                  <LinkedDocumentsSection links={linkedDocuments} onOpen={openMarkdownLinkTarget} />
                </>
              )}
              {contentBottomScrollSpace > 0 && (
                <div
                  aria-hidden="true"
                  contentEditable={false}
                  data-ft-rendered-bottom-scroll-space="library"
                  onWheel={(event) => {
                    if (!contentScrollRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    contentScrollRef.current.scrollBy({ top: event.deltaY, left: event.deltaX });
                  }}
                  style={{ height: `${contentBottomScrollSpace}px`, flexShrink: 0 }}
                />
              )}
            </div>
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
            Select a file
          </div>
        )}
        </div>
        <div
          aria-hidden="true"
          data-ft-reader-top-fade="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: `${LIBRARIAN_READER_SCROLLBAR_GUTTER_PX}px`,
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
        {inlineDrawDialog}
        </div>
        )}
        <CodexTerminalPanel
          visible={effectiveCodexTerminalVisible}
          visibleIntent={codexTerminalVisible}
          pageContext={codexTerminalPageContext}
          dockSideOverride={effectiveCodexTerminalDockSide !== codexTerminalDockSide ? effectiveCodexTerminalDockSide : undefined}
          extendToViewportTop={focusChromeActive && effectiveCodexTerminalDockSide === 'right'}
          focusRequestKey={codexTerminalFocusRequestKey}
          onDockSideChange={setCodexTerminalDockSide}
          onFocusToggleShortcut={toggleTerminalEditorFocus}
          onLauncherTargetSessionChange={handleCodexTerminalLauncherTargetSessionChange}
          onTerminalFocusChange={setCodexTerminalFocused}
          onResizeActiveChange={setCodexTerminalResizing}
          onVisibilityToggleShortcut={toggleCodexTerminalPanel}
          onVisibleChange={handleCodexTerminalVisibleChange}
        />
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

      {copyFeedbackLabel && (
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
          {copyFeedbackLabel}
        </div>
      )}

      {deleteConfirmationDialog}

      {renderedImagePreview && (
        <ImagePreviewOverlay
          src={renderedImagePreview.src}
          alt={renderedImagePreview.alt}
          label={renderedImagePreview.alt && renderedImagePreview.alt !== 'Image' ? renderedImagePreview.alt : null}
          maxImageHeight="90vh"
          onDismiss={() => setRenderedImagePreview(null)}
        />
      )}

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
