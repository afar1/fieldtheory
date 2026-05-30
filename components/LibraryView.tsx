import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  InteractionManager,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LibraryDocument, LibraryViewState } from '../types';
import {
  applyRichBlockFormat,
  applyRichEditorInputChange,
  applyRichInlineFormat,
  applyRichTitleInputChange,
  applyRichWikiLink,
  bodySelectionForMarkdownLine,
  buildLibraryFolderGroups,
  buildRichContent,
  buildLibrarySearchRows,
  fileNameForLibraryTitle,
  documentDraftFromWikiTarget,
  findDocumentForWikiDraft,
  findDocumentByWikiTitle,
  formatMarkdownListMarker,
  getBacklinkDocuments,
  getDisplayTitle,
  getLibrarySyncStatus,
  getRecentDocuments,
  getSwitcherDocuments,
  nextRecentIds,
  nextNavigationBackIds,
  type LibrarySearchRow,
  type MarkdownInlineSegment,
  type RichBlockFormat,
  type RichInlineFormat,
  type MarkdownReaderBlock,
  type TextSelection,
  parseMarkdownReaderBlocks,
  previewMarkdownReaderContent,
  reconcileLibraryViewState,
  resolveNavigationBackTarget,
  splitRichContent,
  shouldRetitleMobileFileName,
  toggleMarkdownTaskAtLine,
  wikiTargetForDocument,
  wikiLinksFromContent,
} from '../services/libraryText';
import { StorageService } from '../services/storage';
import { ThemeColors, useIsDark, useThemeColors, useThemeMode } from '../services/theme';

interface LibraryViewProps {
  documents: LibraryDocument[];
  onChange: (docs: LibraryDocument[]) => void;
  onDocumentChange?: (doc: LibraryDocument) => void;
  onDocumentDelete?: (doc: LibraryDocument) => void;
  callsign?: string | null;
  lastSyncedAt?: number | null;
  isSyncing?: boolean;
  syncError?: string | null;
  isHydrating?: boolean;
  onSyncPress?: (flushedDocuments?: LibraryDocument[]) => void | Promise<void>;
  storageScopeId?: string;
}

type DrawerRow =
  | { type: 'folder'; folder: string; count: number }
  | { type: 'empty'; folder: string }
  | { type: 'file'; doc: LibraryDocument };

type EditorDraftState = {
  docId: string;
  content: string;
  rich: {
    title: string;
    body: string;
  };
};

const DEFAULT_FOLDER = 'scratchpad';
const SEEDED_LIBRARY_FOLDERS = [
  DEFAULT_FOLDER,
  'artifacts',
  'Shared Markdown',
  'debates',
  'entries',
] as const;
const EDITOR_DRAFT_FLUSH_DELAY_MS = 1_500;
const READER_PREVIEW_LINE_LIMIT = 120;
const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(340, SCREEN_WIDTH * 0.84);

const extractTags = (value: string) => {
  const tags = value.match(/#[\w-]+/g) ?? [];
  return [...new Set(tags.map((tag) => tag.slice(1).toLowerCase()))].slice(0, 8);
};

const titleFromContent = (content: string, fallback: string) => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback.trim() || 'Untitled';
};

const fileNameForTitle = fileNameForLibraryTitle;

const folderFor = (doc: LibraryDocument) => doc.folderPath?.trim() || DEFAULT_FOLDER;
const fileNameFor = (doc: LibraryDocument) => doc.fileName?.trim() || fileNameForTitle(doc.title || 'Untitled');
const fileNameForTitleUpdate = (doc: LibraryDocument, nextTitle: string) =>
  shouldRetitleMobileFileName(doc, nextTitle) ? fileNameForTitle(nextTitle) : doc.fileName ?? fileNameForTitle(nextTitle);

const compareDocs = (a: LibraryDocument, b: LibraryDocument) => {
  const pinScore = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinScore !== 0) return pinScore;
  return b.updatedAt - a.updatedAt;
};

const withContentUpdate = (doc: LibraryDocument, content: string): LibraryDocument => {
  const nextTitle = titleFromContent(content, doc.title);
  return {
    ...doc,
    content,
    title: nextTitle,
    fileName: fileNameForTitleUpdate(doc, nextTitle),
    folderPath: doc.folderPath ?? folderFor(doc),
    tags: extractTags(content),
    updatedAt: Date.now(),
  };
};

const applyContentUpdate = (documents: LibraryDocument[], docId: string, content: string) => {
  let didPatch = false;
  let patchedDocument: LibraryDocument | null = null;
  const nextDocuments = documents.map((doc) => {
    if (doc.id !== docId) return doc;
    if (doc.content === content) return doc;
    didPatch = true;
    patchedDocument = withContentUpdate(doc, content);
    return patchedDocument;
  });

  return {
    didPatch,
    document: patchedDocument,
    documents: didPatch ? [...nextDocuments].sort(compareDocs) : documents,
  };
};

export function LibraryView({
  documents,
  onChange,
  onDocumentChange,
  onDocumentDelete,
  callsign,
  lastSyncedAt,
  isSyncing,
  syncError,
  isHydrating,
  onSyncPress,
  storageScopeId = 'local',
}: LibraryViewProps) {
  const colors = useThemeColors();
  const isDark = useIsDark();
  const [themeMode, setThemeMode] = useThemeMode();
  const insets = useSafeAreaInsets();
  const titleInputRef = useRef<TextInput>(null);
  const editorRef = useRef<TextInput>(null);
  const bodySelectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const contentTransition = useRef(new Animated.Value(1)).current;
  const lastSelectedIdRef = useRef<string | null>(documents[0]?.id ?? null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocumentsRef = useRef<LibraryDocument[] | null>(null);
  const pendingDraftRef = useRef<{ docId: string; content: string } | null>(null);
  const dirtyDocumentsRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onDocumentDeleteRef = useRef(onDocumentDelete);
  const persistViewStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isViewStateReadyRef = useRef(false);
  const loadedViewStateRef = useRef<LibraryViewState | null>(null);
  const readerScrollOffsetsRef = useRef<Record<string, number>>({});
  const latestViewStateRef = useRef<{ selectedId: string | null; recentIds: string[]; readerScrollOffsets: Record<string, number> }>({
    selectedId: documents[0]?.id ?? null,
    recentIds: documents[0]?.id ? [documents[0].id] : [],
    readerScrollOffsets: {},
  });
  const [localDocuments, setLocalDocuments] = useState(documents);
  const localDocumentsRef = useRef(documents);
  const [editorDraft, setEditorDraft] = useState<EditorDraftState | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<'idle' | 'pending' | 'saved'>('idle');
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [recentIds, setRecentIds] = useState<string[]>(documents[0]?.id ? [documents[0].id] : []);
  const [readerScrollOffsets, setReaderScrollOffsets] = useState<Record<string, number>>({});
  const [readerBacklinkState, setReaderBacklinkState] = useState<{ docId: string | null; docs: LibraryDocument[] }>({
    docId: null,
    docs: [],
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerContentVisible, setDrawerContentVisible] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherSearchRows, setSwitcherSearchRows] = useState<LibrarySearchRow[]>([]);
  const [switcherIndexReady, setSwitcherIndexReady] = useState(false);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerQuery, setLinkPickerQuery] = useState('');
  const [linkPickerSearchRows, setLinkPickerSearchRows] = useState<LibrarySearchRow[]>([]);
  const [linkPickerIndexReady, setLinkPickerIndexReady] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [editorFocused, setEditorFocused] = useState(false);
  const [viewMode, setViewMode] = useState<'reader' | 'editor'>('reader');
  const [navigationBackIds, setNavigationBackIds] = useState<string[]>([]);
  const [forcedBodySelection, setForcedBodySelection] = useState<TextSelection | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  const keyboardAppearance = isDark ? 'dark' : 'light';

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onDocumentChangeRef.current = onDocumentChange;
  }, [onDocumentChange]);

  useEffect(() => {
    onDocumentDeleteRef.current = onDocumentDelete;
  }, [onDocumentDelete]);

  useEffect(() => {
    if (!dirtyDocumentsRef.current && !pendingDraftRef.current) {
      localDocumentsRef.current = documents;
      setLocalDocuments(documents);
    }
  }, [documents]);

  useEffect(() => {
    return () => {
      if (draftFlushTimerRef.current) {
        clearTimeout(draftFlushTimerRef.current);
      }
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
      if (persistViewStateTimerRef.current) {
        clearTimeout(persistViewStateTimerRef.current);
      }
      let documentsToFlush = pendingDocumentsRef.current;
      if (pendingDraftRef.current) {
        const { docId, content } = pendingDraftRef.current;
        const result = applyContentUpdate(localDocumentsRef.current, docId, content);
        if (result.didPatch && result.document && onDocumentChangeRef.current) {
          onDocumentChangeRef.current(result.document);
          documentsToFlush = null;
        } else if (result.didPatch) {
          documentsToFlush = result.documents;
        }
      }
      if (documentsToFlush) {
        onChangeRef.current(documentsToFlush);
      }
    };
  }, []);

  const selectedStoredDoc = useMemo(
    () => localDocuments.find((doc) => doc.id === selectedId) ?? null,
    [localDocuments, selectedId],
  );

  const selectedDoc = useMemo(() => {
    if (!selectedStoredDoc) return null;
    if (editorDraft?.docId === selectedStoredDoc.id) {
      return { ...selectedStoredDoc, content: editorDraft.content };
    }
    return selectedStoredDoc;
  }, [editorDraft, selectedStoredDoc]);

  const richDraft = useMemo(() => {
    if (!selectedDoc) return null;
    if (editorDraft?.docId === selectedDoc.id) {
      return editorDraft.rich;
    }
    return splitRichContent(selectedDoc);
  }, [editorDraft, selectedDoc]);

  const sortedDocs = useMemo(() => [...localDocuments].sort(compareDocs), [localDocuments]);
  const recentDocs = useMemo(
    () => getRecentDocuments(localDocuments, recentIds, selectedId),
    [localDocuments, recentIds, selectedId],
  );
  const navigationBackTarget = useMemo(
    () => resolveNavigationBackTarget(localDocuments, navigationBackIds).previousDoc,
    [localDocuments, navigationBackIds],
  );

  const flushLibraryViewStateNow = useCallback(() => {
    if (!isViewStateReadyRef.current) return;
    if (persistViewStateTimerRef.current) {
      clearTimeout(persistViewStateTimerRef.current);
      persistViewStateTimerRef.current = null;
    }
    StorageService.saveLibraryViewState({
      selectedDocumentId: latestViewStateRef.current.selectedId,
      recentDocumentIds: latestViewStateRef.current.recentIds,
      readerScrollOffsets: latestViewStateRef.current.readerScrollOffsets,
      updatedAt: Date.now(),
    }).catch(console.error);
  }, []);

  const queueLibraryViewStateSave = useCallback((
    nextSelectedId: string | null,
    nextRecentIds: string[],
    nextReaderScrollOffsets = readerScrollOffsetsRef.current,
  ) => {
    latestViewStateRef.current = {
      selectedId: nextSelectedId,
      recentIds: nextRecentIds,
      readerScrollOffsets: nextReaderScrollOffsets,
    };
    if (!isViewStateReadyRef.current) return;
    if (persistViewStateTimerRef.current) {
      clearTimeout(persistViewStateTimerRef.current);
    }
    persistViewStateTimerRef.current = setTimeout(() => {
      flushLibraryViewStateNow();
    }, 250);
  }, [flushLibraryViewStateNow]);

  const rememberRecent = useCallback((docId: string | null) => {
    if (!docId) return;
    setRecentIds((ids) => {
      const nextIds = nextRecentIds(ids, docId);
      queueLibraryViewStateSave(docId, nextIds);
      return nextIds;
    });
  }, [queueLibraryViewStateSave]);

  useEffect(() => {
    let cancelled = false;
    isViewStateReadyRef.current = false;
    loadedViewStateRef.current = null;
    if (persistViewStateTimerRef.current) {
      clearTimeout(persistViewStateTimerRef.current);
      persistViewStateTimerRef.current = null;
    }

    StorageService.getLibraryViewState()
      .then((state) => {
        if (cancelled) return;
        loadedViewStateRef.current = state;
        if (localDocumentsRef.current.length > 0) {
          const reconciled = reconcileLibraryViewState(localDocumentsRef.current, loadedViewStateRef.current);
          loadedViewStateRef.current = null;
          if (reconciled.selectedId) {
            setSelectedId(reconciled.selectedId);
          }
          setRecentIds(reconciled.recentIds);
          setReaderScrollOffsets(reconciled.readerScrollOffsets);
          readerScrollOffsetsRef.current = reconciled.readerScrollOffsets;
          latestViewStateRef.current = reconciled;
        }
        isViewStateReadyRef.current = true;
      })
      .catch((error) => {
        console.error(error);
        isViewStateReadyRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [storageScopeId]);

  useEffect(() => {
    if (!isViewStateReadyRef.current) return;
    if (loadedViewStateRef.current && sortedDocs.length === 0) return;
    setRecentIds((ids) => {
      const reconciled = reconcileLibraryViewState(sortedDocs, loadedViewStateRef.current ?? {
        selectedDocumentId: selectedId,
        recentDocumentIds: ids,
        readerScrollOffsets: readerScrollOffsetsRef.current,
        updatedAt: Date.now(),
      });
      loadedViewStateRef.current = null;
      if (reconciled.selectedId !== selectedId) {
        setSelectedId(reconciled.selectedId);
      }
      setReaderScrollOffsets(reconciled.readerScrollOffsets);
      readerScrollOffsetsRef.current = reconciled.readerScrollOffsets;
      latestViewStateRef.current = reconciled;
      return reconciled.recentIds;
    });
  }, [selectedId, sortedDocs]);

  useEffect(() => {
    queueLibraryViewStateSave(selectedId, recentIds);
  }, [queueLibraryViewStateSave, recentIds, selectedId]);

  useEffect(() => {
    if (!selectedId && sortedDocs[0]) {
      setSelectedId(sortedDocs[0].id);
      rememberRecent(sortedDocs[0].id);
    }
  }, [rememberRecent, selectedId, sortedDocs]);

  useEffect(() => {
    if (!selectedId || lastSelectedIdRef.current === selectedId) return;
    lastSelectedIdRef.current = selectedId;
    contentTransition.setValue(0);
    Animated.timing(contentTransition, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [contentTransition, selectedId]);

  const folders = useMemo(() => {
    if (!drawerContentVisible && !actionsOpen) return [];
    return buildLibraryFolderGroups(sortedDocs, SEEDED_LIBRARY_FOLDERS, DEFAULT_FOLDER);
  }, [actionsOpen, drawerContentVisible, sortedDocs]);

  const drawerRows = useMemo<DrawerRow[]>(() => {
    if (!drawerContentVisible) return [];
    return folders.flatMap(([folder, docs]) => [
      { type: 'folder' as const, folder, count: docs.length },
      ...(docs.length === 0
        ? [{ type: 'empty' as const, folder }]
        : docs.map((doc) => ({ type: 'file' as const, doc }))),
    ]);
  }, [drawerContentVisible, folders]);

  const switcherDocs = useMemo(() => {
    if (!switcherOpen) return [];
    return getSwitcherDocuments({
      documents: sortedDocs,
      rows: switcherSearchRows,
      query: switcherQuery,
      indexReady: switcherIndexReady,
    });
  }, [sortedDocs, switcherIndexReady, switcherOpen, switcherQuery, switcherSearchRows]);
  const switcherCreateDraft = useMemo(() => {
    const query = switcherQuery.trim();
    return query ? documentDraftFromWikiTarget(query, DEFAULT_FOLDER) : null;
  }, [switcherQuery]);
  const switcherExistingDraftDoc = useMemo(() => {
    if (!switcherCreateDraft) return null;
    return findDocumentForWikiDraft(sortedDocs, switcherCreateDraft);
  }, [sortedDocs, switcherCreateDraft]);
  const linkPickerDocuments = useMemo(() => {
    if (!linkPickerOpen) return [];
    return sortedDocs.filter((doc) => doc.id !== selectedId);
  }, [linkPickerOpen, selectedId, sortedDocs]);
  const linkPickerDocs = useMemo(() => {
    if (!linkPickerOpen) return [];
    return getSwitcherDocuments({
      documents: linkPickerDocuments,
      rows: linkPickerSearchRows,
      query: linkPickerQuery,
      indexReady: linkPickerIndexReady,
      limit: 12,
    });
  }, [linkPickerDocuments, linkPickerIndexReady, linkPickerOpen, linkPickerQuery, linkPickerSearchRows]);
  const linkPickerCreateDraft = useMemo(() => {
    const query = linkPickerQuery.trim();
    return query ? documentDraftFromWikiTarget(query, selectedDoc ? folderFor(selectedDoc) : DEFAULT_FOLDER) : null;
  }, [linkPickerQuery, selectedDoc]);
  const linkPickerExistingDraftDoc = useMemo(() => {
    if (!linkPickerCreateDraft) return null;
    return findDocumentForWikiDraft(sortedDocs, linkPickerCreateDraft);
  }, [linkPickerCreateDraft, sortedDocs]);

  useEffect(() => {
    if (!switcherOpen) {
      setSwitcherSearchRows([]);
      setSwitcherIndexReady(false);
      return;
    }

    let cancelled = false;
    setSwitcherSearchRows([]);
    setSwitcherIndexReady(false);
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setSwitcherSearchRows(buildLibrarySearchRows(sortedDocs));
      setSwitcherIndexReady(true);
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [sortedDocs, switcherOpen]);

  useEffect(() => {
    if (!linkPickerOpen) {
      setLinkPickerSearchRows([]);
      setLinkPickerIndexReady(false);
      return;
    }

    let cancelled = false;
    setLinkPickerSearchRows([]);
    setLinkPickerIndexReady(false);
    const documents = linkPickerDocuments;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setLinkPickerSearchRows(buildLibrarySearchRows(documents));
      setLinkPickerIndexReady(true);
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [linkPickerDocuments, linkPickerOpen]);

  const outline = useMemo(() => {
    if (!actionsOpen || !selectedDoc) return [];
    return selectedDoc.content
      .split('\n')
      .map((line, index) => {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        return match ? { line: index + 1, level: match[1].length, title: match[2].trim() } : null;
      })
      .filter((item): item is { line: number; level: number; title: string } => Boolean(item))
      .slice(0, 12);
  }, [actionsOpen, selectedDoc]);

  const actionBacklinks = useMemo(() => {
    if (!actionsOpen) return [];
    return getBacklinkDocuments(sortedDocs, selectedDoc);
  }, [actionsOpen, selectedDoc, sortedDocs]);

  const readerBacklinks = selectedDoc && readerBacklinkState.docId === selectedDoc.id
    ? readerBacklinkState.docs
    : [];

  useEffect(() => {
    if (viewMode !== 'reader' || !selectedDoc) {
      setReaderBacklinkState({ docId: null, docs: [] });
      return;
    }

    let cancelled = false;
    const doc = selectedDoc;
    const docs = sortedDocs;
    setReaderBacklinkState({ docId: doc.id, docs: [] });
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setReaderBacklinkState({ docId: doc.id, docs: getBacklinkDocuments(docs, doc) });
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [selectedDoc, sortedDocs, viewMode]);

  const outboundLinks = useMemo(() => {
    if (!actionsOpen || !selectedDoc) return [];
    const links = new Map<string, { target: string; label: string }>();
    wikiLinksFromContent(selectedDoc.content).forEach((link) => {
      if (!links.has(link.target)) {
        links.set(link.target, link);
      }
    });
    return [...links.values()].slice(0, 12);
  }, [actionsOpen, selectedDoc]);

  const openDrawer = useCallback(() => {
    Keyboard.dismiss();
    setFolderQuery('');
    setDrawerContentVisible(false);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setFolderQuery('');
  }, []);

  const openSwitcher = useCallback(() => {
    setSwitcherQuery('');
    setSwitcherOpen(true);
  }, []);

  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false);
    setSwitcherQuery('');
  }, []);

  const openLinkPicker = useCallback(() => {
    setLinkPickerQuery('');
    setLinkPickerOpen(true);
  }, []);

  const closeLinkPicker = useCallback(() => {
    setLinkPickerOpen(false);
    setLinkPickerQuery('');
    setTimeout(() => editorRef.current?.focus(), 0);
  }, []);

  const edgeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (event, gesture) => {
          const startsAtLeftEdge = event.nativeEvent.pageX < 28;
          return !drawerOpen && startsAtLeftEdge && gesture.dx > 16 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 58) {
            openDrawer();
          }
        },
      }),
    [drawerOpen, openDrawer],
  );

  useEffect(() => {
    if (drawerOpen) {
      Keyboard.dismiss();
    } else {
      setDrawerContentVisible(false);
    }

    Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && drawerOpen) {
        setDrawerContentVisible(true);
      }
    });
  }, [drawerOpen, drawerProgress]);

  const flushDocumentsSoon = (next: LibraryDocument[]) => {
    dirtyDocumentsRef.current = true;
    pendingDocumentsRef.current = next;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      const pending = pendingDocumentsRef.current;
      pendingDocumentsRef.current = null;
      dirtyDocumentsRef.current = false;
      if (pending) {
        onChangeRef.current(pending);
      }
    }, 500);
  };

  const flushDocumentsNow = (next: LibraryDocument[]) => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDocumentsRef.current = null;
    dirtyDocumentsRef.current = false;
    onChangeRef.current(next);
  };

  const clearPendingDocumentsFlush = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingDocumentsRef.current = null;
    dirtyDocumentsRef.current = false;
  };

  const emitDocumentChange = (doc: LibraryDocument, fallbackDocuments: LibraryDocument[]) => {
    if (onDocumentChangeRef.current) {
      clearPendingDocumentsFlush();
      onDocumentChangeRef.current(doc);
      return;
    }
    flushDocumentsNow(fallbackDocuments);
  };

  const emitDocumentDelete = (doc: LibraryDocument, fallbackDocuments: LibraryDocument[]) => {
    if (onDocumentDeleteRef.current) {
      clearPendingDocumentsFlush();
      onDocumentDeleteRef.current(doc);
      return;
    }
    flushDocumentsSoon(fallbackDocuments);
  };

  const clearEditorDraft = (docId: string) => {
    if (pendingDraftRef.current?.docId === docId && draftFlushTimerRef.current) {
      clearTimeout(draftFlushTimerRef.current);
      draftFlushTimerRef.current = null;
    }
    if (pendingDraftRef.current?.docId === docId) {
      pendingDraftRef.current = null;
    }
    setEditorDraft((draft) => (draft?.docId === docId ? null : draft));
    setDraftSaveState('idle');
  };

  const flushEditorDraft = (options: { clearDraft?: boolean } = {}) => {
    const clearDraft = options.clearDraft ?? true;
    const pendingDraft = pendingDraftRef.current;
    if (!pendingDraft) {
      if (clearDraft) {
        setEditorDraft(null);
        setDraftSaveState('idle');
      }
      return null;
    }

    if (draftFlushTimerRef.current) {
      clearTimeout(draftFlushTimerRef.current);
      draftFlushTimerRef.current = null;
    }
    pendingDraftRef.current = null;

    const result = applyContentUpdate(localDocumentsRef.current, pendingDraft.docId, pendingDraft.content);
    if (clearDraft) {
      setEditorDraft((draft) => (draft?.docId === pendingDraft.docId ? null : draft));
      setDraftSaveState('idle');
    } else {
      setDraftSaveState('saved');
    }
    if (!result.didPatch) {
      if (!pendingDocumentsRef.current) {
        dirtyDocumentsRef.current = false;
      }
      return null;
    }

    localDocumentsRef.current = result.documents;
    setLocalDocuments(result.documents);
    if (result.document) {
      emitDocumentChange(result.document, result.documents);
    } else {
      flushDocumentsNow(result.documents);
    }
    return result.documents;
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'inactive' || nextAppState === 'background') {
        flushEditorDraft({ clearDraft: false });
        flushLibraryViewStateNow();
      }
    });
    return () => subscription.remove();
  }, [flushLibraryViewStateNow]);

  const persist = (
    next: LibraryDocument[],
    nextSelectedId = selectedId,
    changedDocument?: LibraryDocument,
    deletedDocument?: LibraryDocument,
  ) => {
    const sorted = [...next].sort(compareDocs);
    localDocumentsRef.current = sorted;
    setLocalDocuments(sorted);
    if (deletedDocument) {
      emitDocumentDelete(deletedDocument, sorted);
    } else if (changedDocument) {
      emitDocumentChange(changedDocument, sorted);
    } else {
      flushDocumentsSoon(sorted);
    }
    setSelectedId(nextSelectedId);
  };

  const createDocument = (
    title = 'Untitled',
    folderPath = DEFAULT_FOLDER,
    options: { recordHistory?: boolean; fileName?: string } = {},
  ) => {
    flushEditorDraft();
    const now = Date.now();
    const cleanTitle = title.trim() || 'Untitled';
    const doc: LibraryDocument = {
      id: `lib-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      content: `# ${cleanTitle}\n\n`,
      folderPath,
      fileName: options.fileName?.trim() || fileNameForTitle(cleanTitle),
      sourceKind: 'mobile',
      tags: [],
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    };
    persist([doc, ...localDocumentsRef.current], doc.id, doc);
    if (options.recordHistory) {
      setNavigationBackIds((ids) => nextNavigationBackIds(ids, selectedId, doc.id));
    }
    rememberRecent(doc.id);
    setViewMode('editor');
    closeSwitcher();
    closeDrawer();
    setTimeout(() => editorRef.current?.focus(), 100);
  };

  const createLinkedDocumentInPlace = (draft: { title: string; folderPath: string; fileName?: string }) => {
    const now = Date.now();
    const cleanTitle = draft.title.trim() || 'Untitled';
    const doc: LibraryDocument = {
      id: `lib-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      content: `# ${cleanTitle}\n\n`,
      folderPath: draft.folderPath.trim() || DEFAULT_FOLDER,
      fileName: draft.fileName?.trim() || fileNameForTitle(cleanTitle),
      sourceKind: 'mobile',
      tags: [],
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    };
    persist([doc, ...localDocumentsRef.current], selectedId, doc);
    return doc;
  };

  const createFolderNote = () => {
    const folder = folderQuery.trim() || DEFAULT_FOLDER;
    createDocument('Untitled', folder);
    setFolderQuery('');
  };

  const updateDoc = (patch: Partial<LibraryDocument>) => {
    if (!selectedDoc) return;
    const pendingDraft = pendingDraftRef.current?.docId === selectedDoc.id ? pendingDraftRef.current : null;
    const baseDoc = pendingDraft ? { ...selectedDoc, content: pendingDraft.content } : selectedDoc;
    clearEditorDraft(selectedDoc.id);
    const mergedContent = patch.content ?? baseDoc.content;
    const nextTitle = patch.title ?? titleFromContent(mergedContent, baseDoc.title);
    const nextFileName = patch.fileName
      ?? ((patch.content !== undefined || patch.title !== undefined) && shouldRetitleMobileFileName(baseDoc, nextTitle)
        ? fileNameForTitleUpdate(baseDoc, nextTitle)
        : baseDoc.fileName ?? fileNameForTitle(nextTitle));
    const updated: LibraryDocument = {
      ...baseDoc,
      ...patch,
      title: nextTitle,
      fileName: nextFileName,
      folderPath: patch.folderPath ?? folderFor(baseDoc),
      tags: patch.tags ?? extractTags(mergedContent),
      updatedAt: Date.now(),
    };
    persist(localDocumentsRef.current.map((doc) => (doc.id === selectedDoc.id ? updated : doc)), selectedDoc.id, updated);
  };

  const moveSelectedToFolder = (folderPath: string) => {
    if (!selectedDoc) return;
    updateDoc({ folderPath: folderPath.trim() || DEFAULT_FOLDER });
    setActionsOpen(false);
  };

  const jumpToLine = (lineNumber: number) => {
    if (!selectedDoc) return;
    const isTitleLine = lineNumber === 1 && /^#\s+/.test(selectedDoc.content.split('\n')[0] ?? '');
    if (isTitleLine) {
      setViewMode('editor');
      setActionsOpen(false);
      setTimeout(() => titleInputRef.current?.focus(), 0);
      return;
    }
    const selection = bodySelectionForMarkdownLine(selectedDoc.content, lineNumber);
    bodySelectionRef.current = selection;
    setForcedBodySelection(selection);
    setViewMode('editor');
    setActionsOpen(false);
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const openLinkedTitle = (title: string) => {
    const linkedDoc = findDocumentByWikiTitle(sortedDocs, title);
    if (linkedDoc) {
      openDoc(linkedDoc);
    } else {
      const draft = documentDraftFromWikiTarget(title, selectedDoc ? folderFor(selectedDoc) : DEFAULT_FOLDER);
      createDocument(draft.title, draft.folderPath, { recordHistory: true, fileName: draft.fileName });
    }
    setActionsOpen(false);
  };

  const deleteSelected = () => {
    if (!selectedDoc) return;
    Alert.alert('Delete note?', `${getDisplayTitle(selectedDoc)} will be removed from your Library.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          clearEditorDraft(selectedDoc.id);
          const next = localDocumentsRef.current.filter((doc) => doc.id !== selectedDoc.id);
          persist(next, next[0]?.id ?? null, undefined, selectedDoc);
          setActionsOpen(false);
        },
      },
    ]);
  };

  const openDoc = useCallback((doc: LibraryDocument, options: { recordHistory?: boolean } = {}) => {
    flushEditorDraft();
    if (options.recordHistory ?? true) {
      setNavigationBackIds((ids) => nextNavigationBackIds(ids, selectedId, doc.id));
    }
    setSelectedId(doc.id);
    rememberRecent(doc.id);
    setViewMode('reader');
    closeDrawer();
    closeSwitcher();
  }, [closeDrawer, closeSwitcher, rememberRecent, selectedId]);

  const goBackToPreviousDoc = useCallback(() => {
    const { previousDoc, remainingIds } = resolveNavigationBackTarget(localDocumentsRef.current, navigationBackIds);
    if (!previousDoc) {
      setNavigationBackIds([]);
      return;
    }
    flushEditorDraft();
    setNavigationBackIds(remainingIds);
    setSelectedId(previousDoc.id);
    rememberRecent(previousDoc.id);
    setViewMode('reader');
    closeDrawer();
    closeSwitcher();
    setActionsOpen(false);
  }, [closeDrawer, closeSwitcher, navigationBackIds, rememberRecent]);

  const openDocFromActions = useCallback((doc: LibraryDocument) => {
    openDoc(doc);
    setActionsOpen(false);
  }, [openDoc]);

  const handleEditorTextChange = (title: string, body: string) => {
    if (!selectedStoredDoc) return;
    dirtyDocumentsRef.current = true;
    const content = buildRichContent(title, body);
    const draft = { docId: selectedStoredDoc.id, content, rich: { title, body } };
    pendingDraftRef.current = draft;
    setEditorDraft(draft);
    setDraftSaveState('pending');
    if (draftFlushTimerRef.current) {
      clearTimeout(draftFlushTimerRef.current);
    }
    draftFlushTimerRef.current = setTimeout(() => {
      draftFlushTimerRef.current = null;
      flushEditorDraft({ clearDraft: false });
    }, EDITOR_DRAFT_FLUSH_DELAY_MS);
  };

  const handleTitleTextChange = (title: string) => {
    if (!selectedDoc || !richDraft) return;
    const result = applyRichTitleInputChange(title, richDraft.body);
    if (result.bodySelection) {
      bodySelectionRef.current = result.bodySelection;
      setForcedBodySelection(result.bodySelection);
      setTimeout(() => editorRef.current?.focus(), 0);
    }
    handleEditorTextChange(result.title, result.body);
  };

  const handleBodyTextChange = (body: string) => {
    if (!selectedDoc || !richDraft) return;
    const result = applyRichEditorInputChange(richDraft.body, body);
    if (result.selection) {
      bodySelectionRef.current = result.selection;
      setForcedBodySelection(result.selection);
    }
    handleEditorTextChange(richDraft.title, result.body);
  };

  const applyEditorInlineFormat = (format: RichInlineFormat) => {
    if (!selectedDoc || !richDraft) return;
    const result = applyRichInlineFormat(richDraft.body, bodySelectionRef.current, format);
    bodySelectionRef.current = result.selection;
    handleEditorTextChange(richDraft.title, result.body);
    setForcedBodySelection(result.selection);
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const insertEditorWikiLink = (target: string, label: string) => {
    if (!selectedDoc || !richDraft) return;
    const result = applyRichWikiLink(richDraft.body, bodySelectionRef.current, target, label);
    bodySelectionRef.current = result.selection;
    handleEditorTextChange(richDraft.title, result.body);
    setForcedBodySelection(result.selection);
    setLinkPickerOpen(false);
    setLinkPickerQuery('');
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const createAndInsertEditorWikiLink = (draft: { title: string; folderPath: string; fileName?: string }) => {
    const existingDoc = findDocumentForWikiDraft(localDocumentsRef.current, draft);
    if (existingDoc) {
      insertEditorWikiLink(wikiTargetForDocument(existingDoc), getDisplayTitle(existingDoc));
      return;
    }
    const doc = createLinkedDocumentInPlace(draft);
    insertEditorWikiLink(wikiTargetForDocument(doc), getDisplayTitle(doc));
  };

  const applyEditorBlockFormat = (format: RichBlockFormat) => {
    if (!selectedDoc || !richDraft) return;
    const result = applyRichBlockFormat(richDraft.body, bodySelectionRef.current, format);
    bodySelectionRef.current = result.selection;
    handleEditorTextChange(richDraft.title, result.body);
    setForcedBodySelection(result.selection);
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const beginEditing = () => {
    if (!selectedDoc) return;
    setViewMode('editor');
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const focusBodyFromTitle = () => {
    if (!selectedDoc) return;
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const showReader = () => {
    flushEditorDraft({ clearDraft: false });
    Keyboard.dismiss();
    setViewMode('reader');
  };

  const toggleReaderTask = (lineNumber: number) => {
    if (!selectedDoc) return;
    const nextContent = toggleMarkdownTaskAtLine(selectedDoc.content, lineNumber);
    if (!nextContent || nextContent === selectedDoc.content) return;
    updateDoc({ content: nextContent });
  };

  const handleSyncPress = () => {
    const flushedDocuments = flushEditorDraft({ clearDraft: false });
    onSyncPress?.(flushedDocuments ?? undefined);
  };

  const rememberReaderScrollOffset = useCallback((docId: string, offset: number) => {
    const nextOffset = Math.max(0, Math.round(offset));
    const previousOffset = readerScrollOffsetsRef.current[docId] ?? 0;
    if (Math.abs(previousOffset - nextOffset) < 24) return;

    const nextOffsets = {
      ...readerScrollOffsetsRef.current,
      [docId]: nextOffset,
    };
    readerScrollOffsetsRef.current = nextOffsets;
    setReaderScrollOffsets(nextOffsets);
    queueLibraryViewStateSave(selectedId, recentIds, nextOffsets);
  }, [queueLibraryViewStateSave, recentIds, selectedId]);

  const copyContent = async () => {
    if (!selectedDoc) return;
    await Clipboard.setStringAsync(selectedDoc.content);
    setActionsOpen(false);
  };

  const copyFile = async () => {
    if (!selectedDoc) return;
    const payload = `FILE: ${folderFor(selectedDoc)}/${fileNameFor(selectedDoc)}\n\n${selectedDoc.content}`;
    await Clipboard.setStringAsync(payload);
    setActionsOpen(false);
  };

  const shareNote = async () => {
    if (!selectedDoc) return;
    const title = getDisplayTitle(selectedDoc);
    await Share.share({
      title,
      message: selectedDoc.content,
    });
    setActionsOpen(false);
  };

  const createFromSwitcher = () => {
    const draft = switcherCreateDraft ?? documentDraftFromWikiTarget('Untitled', DEFAULT_FOLDER);
    const existingDoc = findDocumentForWikiDraft(localDocumentsRef.current, draft);
    if (existingDoc) {
      openDoc(existingDoc);
      setSwitcherQuery('');
      return;
    }
    createDocument(draft.title, draft.folderPath, { fileName: draft.fileName });
    setSwitcherQuery('');
  };

  const renderFile = ({ item }: { item: LibraryDocument }) => (
    <Pressable
      style={[styles.fileRow, item.id === selectedId && { backgroundColor: colors.bgSurface }]}
      onPress={() => openDoc(item)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${getDisplayTitle(item)}`}
      accessibilityHint={`${folderFor(item)}/${fileNameFor(item)}`}
    >
      <View style={styles.fileTitleRow}>
        <Feather name={item.isPinned ? 'bookmark' : 'file-text'} size={16} color={item.isPinned ? '#D6B15D' : colors.textSecondary} />
        <Text style={[styles.fileTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {getDisplayTitle(item)}
        </Text>
      </View>
      <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>NOTE</Text>
    </Pressable>
  );

  const renderDrawerRow = useCallback(({ item }: { item: DrawerRow }) => {
    if (item.type === 'folder') {
      return (
        <View style={styles.folderHeader}>
          <Feather name="folder" size={18} color={colors.textSecondary} />
          <Text style={[styles.folderTitle, { color: colors.textPrimary }]}>{item.folder}</Text>
          <Text style={[styles.folderCount, { color: colors.textTertiary }]}>{item.count}</Text>
        </View>
      );
    }

    if (item.type === 'empty') {
      return <Text style={[styles.emptyFolder, { color: colors.textTertiary }]}>No notes yet</Text>;
    }

    const doc = item.doc;
    return (
      <Pressable
        style={[styles.fileRow, doc.id === selectedId && { backgroundColor: colors.bgSurface }]}
        onPress={() => openDoc(doc)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${getDisplayTitle(doc)}`}
        accessibilityHint={`${folderFor(doc)}/${fileNameFor(doc)}`}
      >
        <View style={styles.fileTitleRow}>
          <Feather name={doc.isPinned ? 'bookmark' : 'file-text'} size={16} color={doc.isPinned ? '#D6B15D' : colors.textSecondary} />
          <Text style={[styles.fileTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {getDisplayTitle(doc)}
          </Text>
        </View>
        <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>NOTE</Text>
      </Pressable>
    );
  }, [colors, openDoc, selectedId]);

  const drawerRowKey = useCallback((item: DrawerRow) => {
    if (item.type === 'folder') return `folder:${item.folder}`;
    if (item.type === 'empty') return `empty:${item.folder}`;
    return `file:${item.doc.id}`;
  }, []);

  const editorEmpty = !selectedDoc;
  const isEditorMode = viewMode === 'editor';
  const hasLocalDraft = Boolean(selectedDoc && editorDraft?.docId === selectedDoc.id);
  const unsyncedCount = useMemo(() => {
    if (!lastSyncedAt) return localDocuments.length;
    return localDocuments.filter((doc) => doc.updatedAt > lastSyncedAt).length;
  }, [lastSyncedAt, localDocuments]);
  const syncStatus = getLibrarySyncStatus({
    isSyncing,
    isSignedIn: Boolean(callsign),
    syncError,
    hasPendingDraft: hasLocalDraft && draftSaveState === 'pending',
    hasSavedDraft: hasLocalDraft && draftSaveState === 'saved',
    unsyncedCount,
    lastSyncedAt,
  });
  const syncStatusIcon = syncStatus.tone === 'syncing'
    ? 'refresh-cw'
    : syncStatus.tone === 'saving'
      ? 'edit-3'
      : syncStatus.tone === 'error'
        ? 'alert-circle'
        : syncStatus.tone === 'synced'
          ? 'check'
          : 'check-circle';
  const syncStatusColor = syncStatus.tone === 'error'
    ? '#DC2626'
    : isSyncing
      ? colors.accent
      : colors.textSecondary;
  const noteTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, DRAWER_WIDTH],
  });
  const drawerTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-DRAWER_WIDTH, 0],
  });
  const scrimOpacity = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.42],
  });
  const contentTranslateX = contentTransition.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bgPage }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 44 : 0}
    >
      <Animated.View {...edgeSwipeResponder.panHandlers} style={[styles.notePane, { transform: [{ translateX: noteTranslateX }] }]}>
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 10) }]}>
          <TouchableOpacity style={styles.topIcon} onPress={openDrawer} accessibilityLabel="Open Library drawer">
            <Feather name="sidebar" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.titleButton} onPress={openSwitcher} accessibilityLabel="Open note switcher">
            <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedDoc ? getDisplayTitle(selectedDoc) : 'New tab'}
            </Text>
            {selectedDoc && (
              <Text style={[styles.topSubtitle, { color: colors.textTertiary }]} numberOfLines={1}>
                {folderFor(selectedDoc)}/{fileNameFor(selectedDoc)}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.topIcon} onPress={openSwitcher} accessibilityLabel="Search notes">
            <Feather name="search" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topIcon}
            onPress={isEditorMode ? showReader : beginEditing}
            disabled={!selectedDoc}
            accessibilityLabel={isEditorMode ? 'Show reader' : 'Edit note'}
          >
            <Feather name={isEditorMode ? 'book-open' : 'edit-3'} size={22} color={selectedDoc ? colors.textSecondary : colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topIcon} onPress={() => setActionsOpen(true)} accessibilityLabel="More note actions">
            <Feather name="more-horizontal" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {selectedDoc && (
          <View style={styles.statusRow}>
            <TouchableOpacity
              style={[styles.statusPill, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
              onPress={handleSyncPress}
              disabled={!onSyncPress || isSyncing}
              accessibilityRole="button"
              accessibilityLabel={`${syncStatus.label}. ${syncStatus.detail}`}
              accessibilityHint="Starts Library sync when available."
            >
              <Feather name={syncStatusIcon} size={13} color={syncStatusColor} />
              <Text style={[styles.statusText, { color: colors.textSecondary }]} numberOfLines={1}>
                {syncStatus.label}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {selectedDoc && navigationBackTarget && !isEditorMode && (
          <View style={styles.navigationBackRow}>
            <TouchableOpacity
              style={[styles.navigationBackPill, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
              onPress={goBackToPreviousDoc}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${getDisplayTitle(navigationBackTarget)}`}
            >
              <Feather name="arrow-left" size={14} color={colors.textSecondary} />
              <Text style={[styles.navigationBackText, { color: colors.textPrimary }]} numberOfLines={1}>
                Back to {getDisplayTitle(navigationBackTarget)}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Animated.View style={[styles.contentTransition, { opacity: contentTransition, transform: [{ translateX: contentTranslateX }] }]}>
          {editorEmpty && isHydrating ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={[styles.emptyActionText, { color: colors.textSecondary }]}>Loading Library...</Text>
            </View>
          ) : editorEmpty ? (
            <View style={styles.emptyState}>
              <TouchableOpacity style={[styles.emptyAction, { backgroundColor: colors.bgSurface }]} onPress={() => createDocument('Untitled')}>
                <Text style={[styles.emptyActionText, { color: colors.accent }]}>Create new note</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.emptyAction, { backgroundColor: colors.bgSurface }]} onPress={openSwitcher}>
                <Text style={[styles.emptyActionText, { color: colors.accent }]}>Go to file</Text>
              </TouchableOpacity>
            </View>
          ) : isEditorMode && richDraft ? (
            <View style={styles.editorWrap}>
              <TextInput
                ref={titleInputRef}
                value={richDraft.title}
                onChangeText={handleTitleTextChange}
                style={[styles.richTitleInput, { color: colors.textPrimary }]}
                placeholder="Title"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="sentences"
                autoCorrect
                spellCheck
                smartInsertDelete
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={focusBodyFromTitle}
                keyboardAppearance={keyboardAppearance}
              />
              <TextInput
                ref={editorRef}
                value={richDraft.body}
                onChangeText={handleBodyTextChange}
                onSelectionChange={(event) => {
                  const nextSelection = event.nativeEvent.selection;
                  bodySelectionRef.current = nextSelection;
                  if (
                    forcedBodySelection
                    && nextSelection.start === forcedBodySelection.start
                    && nextSelection.end === forcedBodySelection.end
                  ) {
                    setForcedBodySelection(null);
                  }
                }}
                selection={forcedBodySelection ?? undefined}
                onFocus={() => setEditorFocused(true)}
                onBlur={() => {
                  setEditorFocused(false);
                  flushEditorDraft();
                }}
                style={[styles.editor, styles.richBodyInput, { color: colors.textPrimary }]}
                multiline
                textAlignVertical="top"
                placeholder="Start writing"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="sentences"
                autoCorrect
                spellCheck
                smartInsertDelete
                keyboardAppearance={keyboardAppearance}
              />
            </View>
          ) : selectedDoc ? (
            <MarkdownReader
              content={selectedDoc.content}
              backlinks={readerBacklinks}
              colors={colors}
              bottomInset={insets.bottom}
              onEditLine={jumpToLine}
              onOpenBacklink={openDoc}
              onOpenRecent={openDoc}
              onReaderScrollOffsetChange={(offset) => rememberReaderScrollOffset(selectedDoc.id, offset)}
              onToggleTask={toggleReaderTask}
              onWikiLink={openLinkedTitle}
              readerScrollOffset={readerScrollOffsets[selectedDoc.id] ?? 0}
              recentDocs={recentDocs}
            />
          ) : null}
        </Animated.View>

        {selectedDoc && isEditorMode && editorFocused && (
          <View style={[styles.richEditorAccessory, { bottom: insets.bottom + 4, backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
            <TouchableOpacity style={styles.richAccessoryButton} onPress={() => Keyboard.dismiss()} accessibilityLabel="Dismiss keyboard">
              <Feather name="chevron-down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.richAccessoryButton} onPress={showReader} accessibilityLabel="Show reader from editor toolbar">
              <Feather name="book-open" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.richFormatButtons} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={styles.richFormatButton} onPress={openLinkPicker} accessibilityLabel="Insert wiki link">
                <Feather name="link-2" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorBlockFormat('heading2')} accessibilityLabel="Heading">
                <Text style={[styles.richFormatText, styles.richHeadingFormatText, { color: colors.textSecondary }]}>H2</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorBlockFormat('bullet')} accessibilityLabel="Bulleted list">
                <Feather name="list" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorBlockFormat('numbered')} accessibilityLabel="Numbered list">
                <Text style={[styles.richFormatText, styles.richHeadingFormatText, { color: colors.textSecondary }]}>1.</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorBlockFormat('task')} accessibilityLabel="Task">
                <Feather name="check-square" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorBlockFormat('quote')} accessibilityLabel="Quote">
                <Feather name="message-square" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorInlineFormat('strong')} accessibilityLabel="Bold">
                <Text style={[styles.richFormatText, { color: colors.textSecondary }]}>B</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorInlineFormat('emphasis')} accessibilityLabel="Italic">
                <Text style={[styles.richFormatText, styles.richFormatItalic, { color: colors.textSecondary }]}>I</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorInlineFormat('code')} accessibilityLabel="Code">
                <Feather name="code" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.richFormatButton} onPress={() => applyEditorInlineFormat('strike')} accessibilityLabel="Strikethrough">
                <Text style={[styles.richFormatText, styles.richFormatStrike, { color: colors.textSecondary }]}>S</Text>
              </TouchableOpacity>
            </ScrollView>
            <Text style={[styles.richAccessoryText, { color: colors.textTertiary }]} numberOfLines={1}>
              {syncStatus.label}
            </Text>
          </View>
        )}
      </Animated.View>

      <Animated.View pointerEvents={drawerOpen ? 'auto' : 'none'} style={[styles.drawerScrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        pointerEvents={drawerOpen ? 'auto' : 'none'}
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            paddingTop: Math.max(insets.top, 20),
            backgroundColor: colors.bgElevated,
            transform: [{ translateX: drawerTranslateX }],
          },
        ]}
      >
        {drawerOpen && (
          <>
            <View style={styles.drawerHeader}>
              <View>
                <Text style={[styles.drawerTitle, { color: colors.textPrimary }]}>Library</Text>
                <Text style={[styles.drawerSubtitle, { color: colors.textSecondary }]}>{localDocuments.length} local notes</Text>
              </View>
              <View style={styles.drawerHeaderActions}>
                <TouchableOpacity style={[styles.drawerIconButton, { backgroundColor: colors.bgSurface }]} onPress={openSwitcher}>
                  <Feather name="search" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity style={[styles.drawerIconButton, { backgroundColor: colors.bgSurface }]} onPress={() => createDocument('Untitled')}>
                  <Feather name="edit-3" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.newFolderRow, { backgroundColor: colors.bgSurface }]}>
              <Feather name="folder-plus" size={18} color={colors.textSecondary} />
              <TextInput
                value={folderQuery}
                onChangeText={setFolderQuery}
                placeholder="New folder note..."
                placeholderTextColor={colors.textTertiary}
                style={[styles.folderInput, { color: colors.textPrimary }]}
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={createFolderNote}
                keyboardAppearance={keyboardAppearance}
              />
              <TouchableOpacity onPress={createFolderNote}>
                <Feather name="plus" size={20} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={drawerRows}
              keyExtractor={drawerRowKey}
              renderItem={renderDrawerRow}
              style={styles.folderList}
              showsVerticalScrollIndicator={false}
              initialNumToRender={18}
              maxToRenderPerBatch={12}
              windowSize={5}
              removeClippedSubviews
            />

            <View style={[styles.drawerFooter, { paddingBottom: insets.bottom + 12, borderTopColor: colors.border }]}>
              <View style={styles.userRow}>
                <View style={[styles.callsignBadge, { backgroundColor: colors.bgSurface }]}>
                  <Feather name="user" size={14} color={colors.textSecondary} />
                  <Text style={[styles.callsignText, { color: colors.textPrimary }]} numberOfLines={1}>
                    {callsign || 'Signed out'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.syncButton, { backgroundColor: colors.bgSurface }]}
                  onPress={handleSyncPress}
                  disabled={!onSyncPress || isSyncing}
                >
                  <Feather name="refresh-cw" size={17} color={isSyncing ? colors.textTertiary : colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.syncText, { color: colors.textTertiary }]}>
                {syncStatus.detail}
              </Text>
              <View style={[styles.themeToggleCompact, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
                <ThemeButton icon="monitor" active={themeMode === 'system'} colors={colors} onPress={() => setThemeMode('system')} />
                <ThemeButton icon="sun" active={themeMode === 'light'} colors={colors} onPress={() => setThemeMode('light')} />
                <ThemeButton icon="moon" active={themeMode === 'dark'} colors={colors} onPress={() => setThemeMode('dark')} />
              </View>
            </View>
          </>
        )}
      </Animated.View>

      {switcherOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={closeSwitcher}>
          <View style={[styles.switcherOverlay, { paddingTop: Math.max(insets.top + 50, 70) }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSwitcher} />
            <View style={[styles.switcherPanel, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <View style={[styles.switcherInputRow, { backgroundColor: colors.bgSurface }]}>
                <Feather name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  value={switcherQuery}
                  onChangeText={setSwitcherQuery}
                  placeholder="Find or create a note..."
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.switcherInput, { color: colors.textPrimary }]}
                  autoFocus
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                  onSubmitEditing={createFromSwitcher}
                  keyboardAppearance={keyboardAppearance}
                />
                {switcherQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSwitcherQuery('')}>
                    <Feather name="x-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={switcherDocs}
                keyExtractor={(item) => item.id}
                renderItem={renderFile}
                ListFooterComponent={
                  switcherQuery.trim() ? (
                    <TouchableOpacity
                      style={styles.createFromQuery}
                      onPress={createFromSwitcher}
                      accessibilityRole="button"
                      accessibilityLabel={switcherExistingDraftDoc
                        ? `Open existing note ${getDisplayTitle(switcherExistingDraftDoc)}`
                        : `Create note ${switcherCreateDraft?.title ?? switcherQuery.trim()}`}
                    >
                      <Feather name={switcherExistingDraftDoc ? 'file-text' : 'plus'} size={18} color={colors.accent} />
                      <Text style={[styles.createFromQueryText, { color: colors.accent }]}>
                        {switcherExistingDraftDoc
                          ? `Open existing "${getDisplayTitle(switcherExistingDraftDoc)}"`
                          : `Create "${switcherCreateDraft?.title ?? switcherQuery.trim()}" in ${switcherCreateDraft?.folderPath ?? DEFAULT_FOLDER}`}
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
            </View>
          </View>
        </Modal>
      )}

      {linkPickerOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={closeLinkPicker}>
          <View style={[styles.switcherOverlay, { paddingTop: Math.max(insets.top + 50, 70) }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeLinkPicker} />
            <View style={[styles.switcherPanel, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
              <View style={[styles.switcherInputRow, { backgroundColor: colors.bgSurface }]}>
                <Feather name="link-2" size={18} color={colors.textSecondary} />
                <TextInput
                  value={linkPickerQuery}
                  onChangeText={setLinkPickerQuery}
                  placeholder="Link to note..."
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.switcherInput, { color: colors.textPrimary }]}
                  autoFocus
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!linkPickerCreateDraft) return;
                    createAndInsertEditorWikiLink(linkPickerCreateDraft);
                  }}
                  keyboardAppearance={keyboardAppearance}
                />
                {linkPickerQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setLinkPickerQuery('')}>
                    <Feather name="x-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={linkPickerDocs}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.linkPickerRow}
                    onPress={() => insertEditorWikiLink(wikiTargetForDocument(item), getDisplayTitle(item))}
                    accessibilityRole="button"
                    accessibilityLabel={`Link to ${getDisplayTitle(item)}`}
                    accessibilityHint={wikiTargetForDocument(item)}
                  >
                    <Feather name="file-text" size={16} color={colors.textSecondary} />
                    <View style={styles.linkPickerTitleColumn}>
                      <Text style={[styles.linkPickerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                        {getDisplayTitle(item)}
                      </Text>
                      <Text style={[styles.linkPickerPath, { color: colors.textTertiary }]} numberOfLines={1}>
                        {wikiTargetForDocument(item)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                ListFooterComponent={
                  linkPickerQuery.trim() && linkPickerCreateDraft ? (
                    <TouchableOpacity
                      style={styles.createFromQuery}
                      onPress={() => {
                        createAndInsertEditorWikiLink(linkPickerCreateDraft);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={linkPickerExistingDraftDoc
                        ? `Link existing note ${getDisplayTitle(linkPickerExistingDraftDoc)}`
                        : `Create and link note ${linkPickerCreateDraft.title}`}
                    >
                      <Feather name={linkPickerExistingDraftDoc ? 'link-2' : 'plus'} size={18} color={colors.accent} />
                      <Text style={[styles.createFromQueryText, { color: colors.accent }]}>
                        {linkPickerExistingDraftDoc
                          ? `Link existing "${getDisplayTitle(linkPickerExistingDraftDoc)}"`
                          : `Create and link "${linkPickerCreateDraft.title}" in ${linkPickerCreateDraft.folderPath}`}
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
              />
            </View>
          </View>
        </Modal>
      )}

      {actionsOpen && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setActionsOpen(false)}>
          <Pressable style={styles.scrim} onPress={() => setActionsOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, backgroundColor: colors.bgElevated }]}>
            <SheetHandle />
            <ScrollView showsVerticalScrollIndicator={false} style={styles.sheetScroll}>
              <SheetRow feather="x" label="Close" onPress={() => setActionsOpen(false)} />
              <SheetRow
                feather="bookmark"
                label={selectedDoc?.isPinned ? 'Unpin' : 'Pin'}
                onPress={() => {
                  if (selectedDoc) updateDoc({ isPinned: !selectedDoc.isPinned });
                  setActionsOpen(false);
                }}
              />
              <SheetRow feather="share" label="Share note" onPress={shareNote} />
              <SheetRow feather="copy" label="Copy note" onPress={copyContent} />
              <SheetRow feather="file-text" label="Copy as file" onPress={copyFile} />
              <SheetSectionTitle label="Move to folder" />
              {folders.map(([folder]) => (
                <SheetRow key={folder} feather="folder" label={folder} onPress={() => moveSelectedToFolder(folder)} />
              ))}
              <SheetSectionTitle label="Outline" />
              {outline.length === 0 ? (
                <SheetRow feather="align-left" label="No headings" onPress={() => setActionsOpen(false)} />
              ) : (
                outline.map((item) => (
                  <SheetRow key={`${item.line}-${item.title}`} iconText={`H${item.level}`} label={item.title} onPress={() => jumpToLine(item.line)} />
                ))
              )}
              <SheetSectionTitle label="Backlinks" />
              {actionBacklinks.length === 0 ? (
                <SheetRow feather="corner-up-left" label="No backlinks" onPress={() => setActionsOpen(false)} />
              ) : (
                actionBacklinks.map((doc) => <SheetRow key={doc.id} feather="corner-up-left" label={getDisplayTitle(doc)} onPress={() => openDocFromActions(doc)} />)
              )}
              <SheetSectionTitle label="Outgoing links" />
              {outboundLinks.length === 0 ? (
                <SheetRow feather="corner-up-right" label="No outgoing links" onPress={() => setActionsOpen(false)} />
              ) : (
                outboundLinks.map((link) => (
                  <SheetRow key={link.target} feather="corner-up-right" label={link.label} onPress={() => openLinkedTitle(link.target)} />
                ))
              )}
              <SheetRow feather="trash-2" label="Delete" destructive onPress={deleteSelected} />
            </ScrollView>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

function MarkdownReader({
  content,
  backlinks,
  colors,
  bottomInset,
  onEditLine,
  onOpenBacklink,
  onOpenRecent,
  onReaderScrollOffsetChange,
  onToggleTask,
  onWikiLink,
  readerScrollOffset,
  recentDocs,
}: {
  content: string;
  backlinks: LibraryDocument[];
  colors: ThemeColors;
  bottomInset: number;
  onEditLine: (lineNumber: number) => void;
  onOpenBacklink: (doc: LibraryDocument) => void;
  onOpenRecent: (doc: LibraryDocument) => void;
  onReaderScrollOffsetChange: (offset: number) => void;
  onToggleTask: (lineNumber: number) => void;
  onWikiLink: (title: string) => void;
  readerScrollOffset: number;
  recentDocs: LibraryDocument[];
}) {
  const listRef = useRef<FlatList<MarkdownReaderBlock>>(null);
  const buildPreviewBlocks = useCallback((value: string) => {
    const previewContent = previewMarkdownReaderContent(value, READER_PREVIEW_LINE_LIMIT);
    return {
      blocks: parseMarkdownReaderBlocks(previewContent),
      isPreview: previewContent !== value,
    };
  }, []);
  const [blockState, setBlockState] = useState(() => buildPreviewBlocks(content));
  const blocks = blockState.blocks;
  const isPreview = blockState.isPreview;
  const readerLinePressHandler = (block: Exclude<MarkdownReaderBlock, { type: 'blank' }>) =>
    () => onEditLine(block.lineNumber);
  const readerLineLongPressHandler = (block: MarkdownReaderBlock) => () => onEditLine(block.lineNumber);
  const rememberScrollOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onReaderScrollOffsetChange(event.nativeEvent.contentOffset.y);
  };

  useEffect(() => {
    const preview = buildPreviewBlocks(content);
    setBlockState(preview);
    if (!preview.isPreview) return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      setBlockState({
        blocks: parseMarkdownReaderBlocks(content),
        isPreview: false,
      });
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [buildPreviewBlocks, content]);

  useEffect(() => {
    if (readerScrollOffset <= 0) return;
    if (isPreview) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: readerScrollOffset, animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [content, isPreview, readerScrollOffset]);

  const renderInline = (segments: MarkdownInlineSegment[], keyPrefix: string, baseStyle: object) => {
    return segments.map((segment, index) => {
      if (segment.type === 'text') {
        return <Text key={`${keyPrefix}-${index}`}>{segment.text}</Text>;
      }
      if (segment.type === 'wiki') {
        return (
          <Text
            key={`${keyPrefix}-${index}`}
            style={[baseStyle, { color: colors.accent, fontWeight: '700' }]}
            onPress={(event) => {
              event.stopPropagation();
              onWikiLink(segment.target);
            }}
          >
            {segment.text}
          </Text>
        );
      }
      if (segment.type === 'url') {
        return (
          <Text
            key={`${keyPrefix}-${index}`}
            style={[baseStyle, { color: colors.accent, textDecorationLine: 'underline' }]}
            onPress={(event) => {
              event.stopPropagation();
              Linking.openURL(segment.url).catch(console.error);
            }}
          >
            {segment.text}
          </Text>
        );
      }

      const inlineStyle =
        segment.type === 'strong'
          ? styles.readerStrong
          : segment.type === 'emphasis'
            ? styles.readerEmphasis
            : segment.type === 'strike'
              ? styles.readerStrike
              : styles.readerCode;
      return (
        <Text key={`${keyPrefix}-${index}`} style={inlineStyle}>
          {segment.text}
        </Text>
      );
    });
  };

  const renderLine = ({ item: block, index }: { item: MarkdownReaderBlock; index: number }) => {
    if (block.type === 'blank') {
      return <View style={styles.readerBlankLine} />;
    }

    if (block.type === 'rule') {
      return <View style={[styles.readerRule, { backgroundColor: colors.border }]} />;
    }

    if (block.type === 'image') {
      return (
        <Pressable
          style={[styles.readerImageFrame, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
          onPress={readerLinePressHandler(block)}
          onLongPress={readerLineLongPressHandler(block)}
          accessibilityRole="imagebutton"
          accessibilityLabel={block.alt || 'Markdown image'}
        >
          <Image
            source={{ uri: block.url }}
            style={styles.readerImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          {block.alt ? (
            <Text style={[styles.readerImageCaption, { color: colors.textTertiary }]} numberOfLines={2}>
              {block.alt}
            </Text>
          ) : null}
        </Pressable>
      );
    }

    if (block.type === 'table') {
      return (
        <Pressable
          style={[styles.readerTableFrame, { borderColor: colors.border }]}
          onPress={readerLinePressHandler(block)}
          onLongPress={readerLineLongPressHandler(block)}
          accessibilityRole="button"
          accessibilityLabel="Edit markdown table"
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              <View style={[styles.readerTableRow, { backgroundColor: colors.bgSurface }]}>
                {block.headerSegments.map((segments, cellIndex) => (
                  <Text
                    key={`header-${cellIndex}`}
                    style={[styles.readerTableHeaderCell, { color: colors.textPrimary, borderColor: colors.border }]}
                    numberOfLines={2}
                  >
                    {renderInline(segments, `table-header-${index}-${cellIndex}`, styles.readerTableHeaderCell)}
                  </Text>
                ))}
              </View>
              {block.rows.map((row, rowIndex) => (
                <View key={`row-${rowIndex}`} style={styles.readerTableRow}>
                  {block.headers.map((_header, cellIndex) => (
                    <Text
                      key={`cell-${rowIndex}-${cellIndex}`}
                      style={[styles.readerTableCell, { color: colors.textSecondary, borderColor: colors.border }]}
                      numberOfLines={3}
                    >
                      {renderInline(block.rowSegments[rowIndex]?.[cellIndex] ?? [], `table-cell-${index}-${rowIndex}-${cellIndex}`, styles.readerTableCell)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      );
    }

    if (block.type === 'heading') {
      const headingStyle = [
        styles.readerHeading,
        block.level === 1 && styles.readerHeading1,
        block.level === 2 && styles.readerHeading2,
        block.level === 3 && styles.readerHeading3,
        block.level === 4 && styles.readerHeading4,
        block.level >= 5 && styles.readerHeading5,
        { color: colors.textPrimary },
      ];
      return (
        <Text
          style={headingStyle}
          onPress={readerLinePressHandler(block)}
          onLongPress={readerLineLongPressHandler(block)}
        >
          {renderInline(block.segments, `heading-${index}`, headingStyle)}
        </Text>
      );
    }

    if (block.type === 'codeBlock') {
      return (
        <Pressable
          style={[styles.readerCodeBlock, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
          onPress={readerLinePressHandler(block)}
          onLongPress={readerLineLongPressHandler(block)}
        >
          {block.language && (
            <Text style={[styles.readerCodeLanguage, { color: colors.textTertiary }]}>{block.language}</Text>
          )}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={[styles.readerCodeBlockText, { color: colors.textPrimary }]}>
              {block.text || ' '}
            </Text>
          </ScrollView>
        </Pressable>
      );
    }

    if (block.type === 'list') {
      const listIndent = Math.min(block.indent * 9, 54);
      const isTask = /^- \[[ xX]\]$/.test(block.marker);
      if (isTask) {
        const isChecked = /\[[xX]\]/.test(block.marker);
        return (
          <View style={[styles.readerTaskRow, { marginLeft: listIndent }]}>
            <TouchableOpacity
              style={styles.readerTaskCheckbox}
              onPress={() => onToggleTask(block.lineNumber)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={isChecked ? 'Mark task incomplete' : 'Mark task complete'}
            >
              <Feather name={isChecked ? 'check-square' : 'square'} size={21} color={isChecked ? colors.accent : colors.textTertiary} />
            </TouchableOpacity>
            <Text
              style={[styles.readerParagraph, styles.readerTaskText, { color: isChecked ? colors.textSecondary : colors.textPrimary }]}
              onPress={readerLinePressHandler(block)}
              onLongPress={readerLineLongPressHandler(block)}
            >
              {renderInline(block.segments, `task-${index}`, styles.readerParagraph)}
            </Text>
          </View>
        );
      }

      return (
        <Text
          style={[styles.readerParagraph, styles.readerListItem, { color: colors.textPrimary, marginLeft: listIndent }]}
          onPress={readerLinePressHandler(block)}
          onLongPress={readerLineLongPressHandler(block)}
        >
          <Text style={{ color: colors.textTertiary }}>{formatMarkdownListMarker(block.marker)} </Text>
          {renderInline(block.segments, `list-${index}`, styles.readerParagraph)}
        </Text>
      );
    }

    if (block.type === 'quote') {
      return (
        <View style={[styles.readerQuote, { borderLeftColor: colors.accent }]}>
          <Text
            style={[styles.readerParagraph, { color: colors.textSecondary }]}
            onPress={readerLinePressHandler(block)}
            onLongPress={readerLineLongPressHandler(block)}
          >
            {renderInline(block.segments, `quote-${index}`, styles.readerParagraph)}
          </Text>
        </View>
      );
    }

    return (
      <Text
        style={[styles.readerParagraph, { color: colors.textPrimary }]}
        onPress={readerLinePressHandler(block)}
        onLongPress={readerLineLongPressHandler(block)}
      >
        {renderInline(block.segments, `p-${index}`, styles.readerParagraph)}
      </Text>
    );
  };

  const renderFooter = () => (
    isPreview ? null : <>
      {backlinks.length > 0 && (
        <View style={[styles.readerBacklinks, { borderTopColor: colors.border }]}>
          <Text style={[styles.readerBacklinksLabel, { color: colors.textTertiary }]}>Linked from</Text>
          {backlinks.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.readerBacklinkRow}
              onPress={() => onOpenBacklink(doc)}
              accessibilityRole="button"
              accessibilityLabel={`Open backlink from ${getDisplayTitle(doc)}`}
            >
              <Feather name="corner-up-left" size={15} color={colors.textSecondary} />
              <Text style={[styles.readerBacklinkTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                {getDisplayTitle(doc)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {recentDocs.length > 0 && (
        <View style={[styles.readerRiver, { borderTopColor: colors.border }]}>
          <Text style={[styles.readerBacklinksLabel, { color: colors.textTertiary }]}>Recent</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.readerRiverContent}>
            {recentDocs.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={[styles.readerRiverPill, { borderColor: colors.border, backgroundColor: colors.bgSurface }]}
                onPress={() => onOpenRecent(doc)}
                accessibilityRole="button"
                accessibilityLabel={`Open recent note ${getDisplayTitle(doc)}`}
              >
                <Text style={[styles.readerRiverTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                  {getDisplayTitle(doc)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </>
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.readerScroll}
      contentContainerStyle={[styles.readerContent, { paddingBottom: bottomInset + 96 }]}
      data={blocks}
      keyExtractor={(item) => item.key}
      renderItem={renderLine}
      ListFooterComponent={renderFooter}
      onMomentumScrollEnd={rememberScrollOffset}
      onScrollEndDrag={rememberScrollOffset}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={28}
      maxToRenderPerBatch={16}
      updateCellsBatchingPeriod={32}
      windowSize={9}
      removeClippedSubviews={Platform.OS !== 'ios'}
    />
  );
}

function ThemeButton({
  icon,
  active,
  colors,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.themeButton, active && { backgroundColor: colors.accent }]}
      onPress={onPress}
    >
      <Feather name={icon} size={17} color={active ? '#FFFFFF' : colors.textSecondary} />
    </TouchableOpacity>
  );
}

function SheetHandle() {
  return <View style={styles.sheetHandle} />;
}

function SheetRow({
  feather,
  iconText,
  label,
  destructive,
  onPress,
}: {
  feather?: keyof typeof Feather.glyphMap;
  iconText?: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sheetRow} onPress={onPress}>
      <View style={styles.sheetIcon}>
        {feather ? <Feather name={feather} size={22} color={destructive ? '#F87171' : '#D1D5DB'} /> : <Text style={styles.sheetIconText}>{iconText}</Text>}
      </View>
      <Text style={[styles.sheetLabel, destructive && styles.sheetLabelDestructive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SheetSectionTitle({ label }: { label: string }) {
  return <Text style={styles.sheetSectionTitle}>{label}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  notePane: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8, gap: 6 },
  topIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  titleButton: { flex: 1, alignItems: 'center' },
  topTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0 },
  topSubtitle: { fontSize: 11, marginTop: 2, letterSpacing: 0 },
  statusRow: { minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingBottom: 4 },
  statusPill: { minHeight: 26, maxWidth: '72%', borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { flexShrink: 1, fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  navigationBackRow: { alignItems: 'center', paddingBottom: 2 },
  navigationBackPill: { maxWidth: '76%', minHeight: 30, borderRadius: 15, borderWidth: 1, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  navigationBackText: { flexShrink: 1, fontSize: 13, fontWeight: '700', letterSpacing: 0 },
  contentTransition: { flex: 1 },
  editorWrap: { flex: 1, paddingHorizontal: 22 },
  editor: { flex: 1, fontSize: 18, lineHeight: 30, paddingTop: 34, paddingBottom: 120, letterSpacing: 0 },
  richTitleInput: { fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: 0, paddingTop: 28, paddingBottom: 8 },
  richBodyInput: { paddingTop: 8 },
  richEditorAccessory: { position: 'absolute', left: 0, right: 0, minHeight: 48, borderTopWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  richAccessoryButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  richFormatButtons: { alignItems: 'center', gap: 4 },
  richFormatButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  richFormatText: { fontSize: 16, fontWeight: '800', letterSpacing: 0 },
  richHeadingFormatText: { fontSize: 12 },
  richFormatItalic: { fontStyle: 'italic' },
  richFormatStrike: { textDecorationLine: 'line-through' },
  richAccessoryText: { width: 96, fontSize: 13, fontWeight: '600', letterSpacing: 0, textAlign: 'right' },
  readerScroll: { flex: 1 },
  readerContent: { paddingHorizontal: 24, paddingTop: 28 },
  readerBlankLine: { height: 12 },
  readerRule: { height: StyleSheet.hairlineWidth, marginVertical: 18 },
  readerImageFrame: { borderWidth: 1, borderRadius: 8, marginVertical: 12, overflow: 'hidden' },
  readerImage: { width: '100%', height: 190 },
  readerImageCaption: { fontSize: 12, fontWeight: '600', letterSpacing: 0, paddingHorizontal: 12, paddingVertical: 8 },
  readerTableFrame: { borderWidth: 1, borderRadius: 8, marginVertical: 12, overflow: 'hidden' },
  readerTableRow: { flexDirection: 'row' },
  readerTableHeaderCell: { width: 150, minHeight: 42, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, lineHeight: 18, fontWeight: '800', letterSpacing: 0 },
  readerTableCell: { width: 150, minHeight: 42, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 9, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  readerHeading: { letterSpacing: 0, marginTop: 18, marginBottom: 8 },
  readerHeading1: { fontSize: 30, lineHeight: 38, fontWeight: '800' },
  readerHeading2: { fontSize: 24, lineHeight: 32, fontWeight: '800' },
  readerHeading3: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  readerHeading4: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  readerHeading5: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
  readerParagraph: { fontSize: 18, lineHeight: 30, letterSpacing: 0, marginBottom: 8 },
  readerStrong: { fontWeight: '800' },
  readerEmphasis: { fontStyle: 'italic' },
  readerStrike: { textDecorationLine: 'line-through' },
  readerCode: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 16 },
  readerCodeBlock: { borderWidth: 1, borderRadius: 8, padding: 12, marginVertical: 10 },
  readerCodeLanguage: { fontSize: 11, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 },
  readerCodeBlockText: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14, lineHeight: 21, letterSpacing: 0 },
  readerListItem: { paddingLeft: 4 },
  readerTaskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  readerTaskCheckbox: { width: 30, minHeight: 30, alignItems: 'center', justifyContent: 'center' },
  readerTaskText: { flex: 1, marginBottom: 0 },
  readerQuote: { borderLeftWidth: 3, paddingLeft: 14, marginVertical: 8 },
  readerBacklinks: { marginTop: 28, paddingTop: 16, borderTopWidth: 1 },
  readerBacklinksLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 },
  readerBacklinkRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8 },
  readerBacklinkTitle: { flex: 1, fontSize: 16, fontWeight: '700', letterSpacing: 0 },
  readerRiver: { marginTop: 28, paddingTop: 16, borderTopWidth: 1 },
  readerRiverContent: { gap: 8, paddingRight: 24 },
  readerRiverPill: { maxWidth: 180, minHeight: 38, borderWidth: 1, borderRadius: 19, paddingHorizontal: 14, justifyContent: 'center' },
  readerRiverTitle: { fontSize: 14, fontWeight: '700', letterSpacing: 0 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 120 },
  emptyAction: { minWidth: 220, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' },
  emptyActionText: { fontSize: 17, fontWeight: '600', letterSpacing: 0 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  drawerScrim: { ...StyleSheet.absoluteFillObject, zIndex: 3, backgroundColor: '#000' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 4, paddingHorizontal: 16 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 20 },
  drawerHeaderActions: { flexDirection: 'row', gap: 8 },
  drawerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: 0 },
  drawerSubtitle: { fontSize: 13, marginTop: 4, letterSpacing: 0 },
  drawerIconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  themeToggleCompact: { width: 132, height: 38, borderRadius: 14, borderWidth: 1, flexDirection: 'row', padding: 4, gap: 4 },
  themeButton: { flex: 1, borderRadius: 10, minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  newFolderRow: { height: 46, borderRadius: 14, paddingHorizontal: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  folderInput: { flex: 1, fontSize: 15, letterSpacing: 0 },
  folderList: { flex: 1 },
  drawerFooter: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  callsignBadge: { flex: 1, minHeight: 38, borderRadius: 14, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  callsignText: { flex: 1, fontSize: 14, fontWeight: '700', letterSpacing: 0 },
  syncButton: { width: 38, height: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  syncText: { fontSize: 12, fontWeight: '600', letterSpacing: 0 },
  folderHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  folderTitle: { flex: 1, fontSize: 17, fontWeight: '700', letterSpacing: 0 },
  folderCount: { fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  emptyFolder: { paddingLeft: 26, paddingVertical: 8, fontSize: 14, letterSpacing: 0 },
  fileRow: { minHeight: 46, borderRadius: 12, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  fileTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileTitle: { flex: 1, fontSize: 16, letterSpacing: 0 },
  fileMeta: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  switcherOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 18 },
  switcherPanel: { maxHeight: '70%', borderRadius: 24, borderWidth: 1, padding: 10 },
  switcherInputRow: { height: 52, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  switcherInput: { flex: 1, fontSize: 17, letterSpacing: 0 },
  linkPickerRow: { minHeight: 54, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  linkPickerTitleColumn: { flex: 1 },
  linkPickerTitle: { fontSize: 16, fontWeight: '700', letterSpacing: 0 },
  linkPickerPath: { fontSize: 12, marginTop: 2, letterSpacing: 0 },
  createFromQuery: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 14 },
  createFromQueryText: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, paddingHorizontal: 18 },
  sheetScroll: { maxHeight: 560 },
  sheetHandle: { alignSelf: 'center', width: 70, height: 5, borderRadius: 999, backgroundColor: '#737373', marginBottom: 14 },
  sheetRow: { minHeight: 58, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  sheetSectionTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '800', letterSpacing: 0, marginTop: 10, marginBottom: 8, paddingHorizontal: 4, textTransform: 'uppercase' },
  sheetIcon: { width: 44, alignItems: 'center' },
  sheetIconText: { color: '#D1D5DB', fontSize: 18, fontWeight: '800', letterSpacing: 0 },
  sheetLabel: { color: '#E5E7EB', fontSize: 18, fontWeight: '600', letterSpacing: 0 },
  sheetLabelDestructive: { color: '#F87171' },
});
