import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LibraryDocument } from '../types';
import { ThemeColors, useIsDark, useThemeColors, useThemeMode } from '../services/theme';

interface LibraryViewProps {
  documents: LibraryDocument[];
  onChange: (docs: LibraryDocument[]) => void;
  callsign?: string | null;
  lastSyncedAt?: number | null;
  isSyncing?: boolean;
  onSyncPress?: () => void;
}

type MarkdownAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'quote'
  | 'link'
  | 'bullet'
  | 'number'
  | 'check'
  | 'h1'
  | 'h2'
  | 'wiki';

const DEFAULT_FOLDER = 'scratchpad';
const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(340, SCREEN_WIDTH * 0.84);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

const extractTags = (value: string) => {
  const tags = value.match(/#[\w-]+/g) ?? [];
  return [...new Set(tags.map((tag) => tag.slice(1).toLowerCase()))].slice(0, 8);
};

const createSlug = (title: string) =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, '')
    .replace(/\s+/g, '-') || 'untitled';

const titleFromContent = (content: string, fallback: string) => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback.trim() || 'Untitled';
};

const fileNameForTitle = (title: string) => `${createSlug(title)}.md`;

const folderFor = (doc: LibraryDocument) => doc.folderPath?.trim() || DEFAULT_FOLDER;
const fileNameFor = (doc: LibraryDocument) => doc.fileName?.trim() || fileNameForTitle(doc.title || 'Untitled');

const compareDocs = (a: LibraryDocument, b: LibraryDocument) => {
  const pinScore = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinScore !== 0) return pinScore;
  return b.updatedAt - a.updatedAt;
};

const getDisplayTitle = (doc: LibraryDocument) => doc.title.trim() || 'Untitled';

const formatSyncTime = (timestamp?: number | null) => {
  if (!timestamp) return 'not synced yet';
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return 'just now';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
};

export function LibraryView({ documents, onChange, callsign, lastSyncedAt, isSyncing, onSyncPress }: LibraryViewProps) {
  const colors = useThemeColors();
  const isDark = useIsDark();
  const [themeMode, setThemeMode] = useThemeMode();
  const insets = useSafeAreaInsets();
  const editorRef = useRef<TextInput>(null);
  const drawerProgress = useRef(new Animated.Value(0)).current;
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [editorFocused, setEditorFocused] = useState(false);
  const [folderQuery, setFolderQuery] = useState('');
  const keyboardAppearance = isDark ? 'dark' : 'light';

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedId) ?? null,
    [documents, selectedId],
  );

  const sortedDocs = useMemo(() => [...documents].sort(compareDocs), [documents]);

  const folders = useMemo(() => {
    const groups = new Map<string, LibraryDocument[]>();
    sortedDocs.forEach((doc) => {
      const folder = folderFor(doc);
      groups.set(folder, [...(groups.get(folder) ?? []), doc]);
    });
    if (!groups.has(DEFAULT_FOLDER)) groups.set(DEFAULT_FOLDER, []);
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === DEFAULT_FOLDER) return -1;
      if (b === DEFAULT_FOLDER) return 1;
      return a.localeCompare(b);
    });
  }, [sortedDocs]);

  const switcherDocs = useMemo(() => {
    const needle = normalize(switcherQuery.trim());
    if (!needle) return sortedDocs;
    return sortedDocs.filter((doc) =>
      normalize(`${getDisplayTitle(doc)}\n${folderFor(doc)}\n${doc.content}`).includes(needle),
    );
  }, [sortedDocs, switcherQuery]);

  const wikiQuery = useMemo(() => {
    if (!selectedDoc || selection.start !== selection.end) return null;
    const beforeCursor = selectedDoc.content.slice(0, selection.start);
    const match = beforeCursor.match(/\[\[([^\]\n]*)$/);
    return match ? match[1] : null;
  }, [selectedDoc, selection]);

  const wikiMatches = useMemo(() => {
    if (wikiQuery === null) return [];
    const needle = normalize(wikiQuery);
    return sortedDocs
      .filter((doc) => doc.id !== selectedDoc?.id)
      .filter((doc) => !needle || normalize(getDisplayTitle(doc)).includes(needle))
      .slice(0, 6);
  }, [selectedDoc?.id, sortedDocs, wikiQuery]);

  const outline = useMemo(() => {
    if (!selectedDoc) return [];
    return selectedDoc.content
      .split('\n')
      .map((line, index) => {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        return match ? { line: index + 1, level: match[1].length, title: match[2].trim() } : null;
      })
      .filter((item): item is { line: number; level: number; title: string } => Boolean(item))
      .slice(0, 12);
  }, [selectedDoc]);

  const backlinks = useMemo(() => {
    if (!selectedDoc) return [];
    const title = getDisplayTitle(selectedDoc);
    const pattern = `[[${title}]]`;
    return sortedDocs.filter((doc) => doc.id !== selectedDoc.id && doc.content.includes(pattern)).slice(0, 8);
  }, [selectedDoc, sortedDocs]);

  const outboundLinks = useMemo(() => {
    if (!selectedDoc) return [];
    const names = new Set((selectedDoc.content.match(/\[\[([^\]]+)\]\]/g) ?? []).map((link) => link.slice(2, -2)));
    return [...names].slice(0, 12);
  }, [selectedDoc]);

  const openDrawer = () => {
    Keyboard.dismiss();
    setDrawerOpen(true);
  };

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
    [drawerOpen],
  );

  useEffect(() => {
    if (drawerOpen) {
      Keyboard.dismiss();
    }

    Animated.timing(drawerProgress, {
      toValue: drawerOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [drawerOpen, drawerProgress]);

  const persist = (next: LibraryDocument[], nextSelectedId = selectedId) => {
    onChange([...next].sort(compareDocs));
    setSelectedId(nextSelectedId);
  };

  const createDocument = (title = 'Untitled', folderPath = DEFAULT_FOLDER) => {
    const now = Date.now();
    const cleanTitle = title.trim() || 'Untitled';
    const doc: LibraryDocument = {
      id: `lib-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      content: `# ${cleanTitle}\n\n`,
      folderPath,
      fileName: fileNameForTitle(cleanTitle),
      sourceKind: 'mobile',
      tags: [],
      isPinned: false,
      createdAt: now,
      updatedAt: now,
    };
    persist([doc, ...documents], doc.id);
    setSwitcherOpen(false);
    setDrawerOpen(false);
    setTimeout(() => editorRef.current?.focus(), 100);
  };

  const createFolderNote = () => {
    const folder = folderQuery.trim() || DEFAULT_FOLDER;
    createDocument('Untitled', folder);
    setFolderQuery('');
  };

  const updateDoc = (patch: Partial<LibraryDocument>) => {
    if (!selectedDoc) return;
    const mergedContent = patch.content ?? selectedDoc.content;
    const nextTitle = patch.title ?? titleFromContent(mergedContent, selectedDoc.title);
    const updated: LibraryDocument = {
      ...selectedDoc,
      ...patch,
      title: nextTitle,
      fileName: patch.fileName ?? selectedDoc.fileName ?? fileNameForTitle(nextTitle),
      folderPath: patch.folderPath ?? folderFor(selectedDoc),
      tags: patch.tags ?? extractTags(mergedContent),
      updatedAt: Date.now(),
    };
    persist(documents.map((doc) => (doc.id === selectedDoc.id ? updated : doc)), selectedDoc.id);
  };

  const moveSelectedToFolder = (folderPath: string) => {
    if (!selectedDoc) return;
    updateDoc({ folderPath: folderPath.trim() || DEFAULT_FOLDER });
    setActionsOpen(false);
  };

  const jumpToLine = (lineNumber: number) => {
    if (!selectedDoc) return;
    const lines = selectedDoc.content.split('\n');
    const cursor = lines.slice(0, Math.max(0, lineNumber - 1)).join('\n').length + (lineNumber > 1 ? 1 : 0);
    setSelection({ start: cursor, end: cursor });
    setActionsOpen(false);
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const openLinkedTitle = (title: string) => {
    const linkedDoc = sortedDocs.find((doc) => normalize(getDisplayTitle(doc)) === normalize(title));
    if (linkedDoc) openDoc(linkedDoc);
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
          const next = documents.filter((doc) => doc.id !== selectedDoc.id);
          persist(next, next[0]?.id ?? null);
          setActionsOpen(false);
        },
      },
    ]);
  };

  const openDoc = (doc: LibraryDocument) => {
    setSelectedId(doc.id);
    setDrawerOpen(false);
    setSwitcherOpen(false);
  };

  const insertText = (text: string, cursorOffset = text.length) => {
    if (!selectedDoc) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const nextContent = `${selectedDoc.content.slice(0, start)}${text}${selectedDoc.content.slice(end)}`;
    updateDoc({ content: nextContent });
    const cursor = start + cursorOffset;
    setSelection({ start: cursor, end: cursor });
    setTimeout(() => editorRef.current?.focus(), 0);
  };

  const wrapSelection = (left: string, right = left, placeholder = '') => {
    if (!selectedDoc) return;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const selected = selectedDoc.content.slice(start, end) || placeholder;
    insertText(`${left}${selected}${right}`, left.length + selected.length);
  };

  const prefixLine = (prefix: string) => {
    if (!selectedDoc) return;
    const lineStart = selectedDoc.content.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
    const nextContent = `${selectedDoc.content.slice(0, lineStart)}${prefix}${selectedDoc.content.slice(lineStart)}`;
    updateDoc({ content: nextContent });
    const cursor = selection.start + prefix.length;
    setSelection({ start: cursor, end: cursor });
  };

  const applyMarkdownAction = (action: MarkdownAction) => {
    switch (action) {
      case 'bold':
        wrapSelection('**', '**', 'bold');
        break;
      case 'italic':
        wrapSelection('*', '*', 'italic');
        break;
      case 'strike':
        wrapSelection('~~', '~~', 'strike');
        break;
      case 'code':
        wrapSelection('`', '`', 'code');
        break;
      case 'quote':
        prefixLine('> ');
        break;
      case 'link':
        wrapSelection('[', '](url)', 'link');
        break;
      case 'bullet':
        prefixLine('- ');
        break;
      case 'number':
        prefixLine('1. ');
        break;
      case 'check':
        prefixLine('- [ ] ');
        break;
      case 'h1':
        prefixLine('# ');
        break;
      case 'h2':
        prefixLine('## ');
        break;
      case 'wiki':
        insertText('[[', 2);
        break;
    }
  };

  const applyHeading = (level: number | null) => {
    if (!selectedDoc) return;
    const lineStart = selectedDoc.content.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1;
    const lineEndRaw = selectedDoc.content.indexOf('\n', selection.start);
    const lineEnd = lineEndRaw === -1 ? selectedDoc.content.length : lineEndRaw;
    const line = selectedDoc.content.slice(lineStart, lineEnd).replace(/^#{1,6}\s+/, '');
    const prefix = level ? `${'#'.repeat(level)} ` : '';
    const nextContent = `${selectedDoc.content.slice(0, lineStart)}${prefix}${line}${selectedDoc.content.slice(lineEnd)}`;
    updateDoc({ content: nextContent });
    const cursor = lineStart + prefix.length + line.length;
    setSelection({ start: cursor, end: cursor });
    setHeadingOpen(false);
  };

  const insertWikiLink = (doc: LibraryDocument) => {
    if (!selectedDoc || wikiQuery === null) return;
    const start = selection.start - wikiQuery.length - 2;
    const link = `[[${getDisplayTitle(doc)}]]`;
    const nextContent = `${selectedDoc.content.slice(0, start)}${link}${selectedDoc.content.slice(selection.start)}`;
    updateDoc({ content: nextContent });
    const cursor = start + link.length;
    setSelection({ start: cursor, end: cursor });
  };

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

  const createFromSwitcher = () => {
    createDocument(switcherQuery.trim() || 'Untitled', DEFAULT_FOLDER);
    setSwitcherQuery('');
  };

  const renderFile = ({ item }: { item: LibraryDocument }) => (
    <Pressable
      style={[styles.fileRow, item.id === selectedId && { backgroundColor: colors.bgSurface }]}
      onPress={() => openDoc(item)}
    >
      <View style={styles.fileTitleRow}>
        <Feather name={item.isPinned ? 'bookmark' : 'file-text'} size={16} color={item.isPinned ? '#D6B15D' : colors.textSecondary} />
        <Text style={[styles.fileTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {getDisplayTitle(item)}
        </Text>
      </View>
      <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>MD</Text>
    </Pressable>
  );

  const editorEmpty = !selectedDoc;
  const toolbarButtonProps = {
    tint: colors.textPrimary,
    surface: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,24,39,0.08)',
    border: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(17,24,39,0.12)',
  };
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bgPage }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 44 : 0}
    >
      <Animated.View {...edgeSwipeResponder.panHandlers} style={[styles.notePane, { transform: [{ translateX: noteTranslateX }] }]}>
        <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 10) }]}>
          <TouchableOpacity style={styles.topIcon} onPress={openDrawer}>
            <Feather name="sidebar" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.titleButton} onPress={() => setSwitcherOpen(true)}>
            <Text style={[styles.topTitle, { color: colors.textPrimary }]} numberOfLines={1}>
              {selectedDoc ? getDisplayTitle(selectedDoc) : 'New tab'}
            </Text>
            {selectedDoc && (
              <Text style={[styles.topSubtitle, { color: colors.textTertiary }]} numberOfLines={1}>
                {folderFor(selectedDoc)}/{fileNameFor(selectedDoc)}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.topIcon} onPress={() => setSwitcherOpen(true)}>
            <Feather name="search" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topIcon} onPress={() => setActionsOpen(true)}>
            <Feather name="more-horizontal" size={24} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {editorEmpty ? (
          <View style={styles.emptyState}>
            <TouchableOpacity style={[styles.emptyAction, { backgroundColor: colors.bgSurface }]} onPress={() => createDocument('Untitled')}>
              <Text style={[styles.emptyActionText, { color: colors.accent }]}>Create new note</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.emptyAction, { backgroundColor: colors.bgSurface }]} onPress={() => setSwitcherOpen(true)}>
              <Text style={[styles.emptyActionText, { color: colors.accent }]}>Go to file</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.editorWrap}>
            {wikiMatches.length > 0 && (
              <View style={[styles.wikiPopover, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
                {wikiMatches.map((doc) => (
                  <TouchableOpacity key={doc.id} style={styles.wikiRow} onPress={() => insertWikiLink(doc)}>
                    <Text style={[styles.wikiTitle, { color: colors.textPrimary }]} numberOfLines={1}>{getDisplayTitle(doc)}</Text>
                    <Text style={[styles.wikiPath, { color: colors.textTertiary }]} numberOfLines={1}>{folderFor(doc)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <TextInput
              ref={editorRef}
              value={selectedDoc.content}
              onChangeText={(content) => updateDoc({ content })}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
              onFocus={() => setEditorFocused(true)}
              onBlur={() => setEditorFocused(false)}
              style={[styles.editor, { color: colors.textPrimary }]}
              multiline
              textAlignVertical="top"
              placeholder="Start writing..."
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="sentences"
              keyboardAppearance={keyboardAppearance}
            />
          </View>
        )}

        {selectedDoc && editorFocused && (
          <View style={[styles.markdownToolbar, { bottom: insets.bottom + 4, backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbarContent} keyboardShouldPersistTaps="handled">
              <ToolbarButton icon="chevron-down" onPress={() => Keyboard.dismiss()} {...toolbarButtonProps} />
              <ToolbarButton label="[[" onPress={() => applyMarkdownAction('wiki')} {...toolbarButtonProps} />
              <ToolbarButton icon="hash" onPress={() => setHeadingOpen(true)} {...toolbarButtonProps} />
              <ToolbarButton label="B" onPress={() => applyMarkdownAction('bold')} {...toolbarButtonProps} />
              <ToolbarButton label="I" onPress={() => applyMarkdownAction('italic')} {...toolbarButtonProps} />
              <ToolbarButton label="S" onPress={() => applyMarkdownAction('strike')} {...toolbarButtonProps} />
              <ToolbarButton icon="code" onPress={() => applyMarkdownAction('code')} {...toolbarButtonProps} />
              <ToolbarButton icon="link" onPress={() => applyMarkdownAction('link')} {...toolbarButtonProps} />
              <ToolbarButton icon="list" onPress={() => applyMarkdownAction('bullet')} {...toolbarButtonProps} />
              <ToolbarButton label="1." onPress={() => applyMarkdownAction('number')} {...toolbarButtonProps} />
              <ToolbarButton icon="check-square" onPress={() => applyMarkdownAction('check')} {...toolbarButtonProps} />
              <ToolbarButton icon="chevron-right" onPress={() => applyMarkdownAction('quote')} {...toolbarButtonProps} />
            </ScrollView>
          </View>
        )}
      </Animated.View>

      <Animated.View pointerEvents={drawerOpen ? 'auto' : 'none'} style={[styles.drawerScrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} />
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
          <View style={styles.drawerHeader}>
            <View>
              <Text style={[styles.drawerTitle, { color: colors.textPrimary }]}>Library</Text>
              <Text style={[styles.drawerSubtitle, { color: colors.textSecondary }]}>{documents.length} markdown files</Text>
            </View>
            <View style={styles.drawerHeaderActions}>
              <TouchableOpacity style={[styles.drawerIconButton, { backgroundColor: colors.bgSurface }]} onPress={() => setSwitcherOpen(true)}>
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
              returnKeyType="done"
              onSubmitEditing={createFolderNote}
              keyboardAppearance={keyboardAppearance}
            />
            <TouchableOpacity onPress={createFolderNote}>
              <Feather name="plus" size={20} color={colors.accent} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.folderList} showsVerticalScrollIndicator={false}>
            {folders.map(([folder, docs]) => (
              <View key={folder} style={styles.folderGroup}>
                <View style={styles.folderHeader}>
                  <Feather name="folder" size={18} color={colors.textSecondary} />
                  <Text style={[styles.folderTitle, { color: colors.textPrimary }]}>{folder}</Text>
                  <Text style={[styles.folderCount, { color: colors.textTertiary }]}>{docs.length}</Text>
                </View>
                {docs.length === 0 ? (
                  <Text style={[styles.emptyFolder, { color: colors.textTertiary }]}>No notes yet</Text>
                ) : (
                  docs.map((doc) => (
                    <Pressable
                      key={doc.id}
                      style={[styles.fileRow, doc.id === selectedId && { backgroundColor: colors.bgSurface }]}
                      onPress={() => openDoc(doc)}
                    >
                      <View style={styles.fileTitleRow}>
                        <Feather name={doc.isPinned ? 'bookmark' : 'file-text'} size={16} color={doc.isPinned ? '#D6B15D' : colors.textSecondary} />
                        <Text style={[styles.fileTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                          {getDisplayTitle(doc)}
                        </Text>
                      </View>
                      <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>MD</Text>
                    </Pressable>
                  ))
                )}
              </View>
            ))}
          </ScrollView>

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
                onPress={onSyncPress}
                disabled={!onSyncPress || isSyncing}
              >
                <Feather name="refresh-cw" size={17} color={isSyncing ? colors.textTertiary : colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.syncText, { color: colors.textTertiary }]}>
              {isSyncing ? 'Syncing...' : `Updated ${formatSyncTime(lastSyncedAt)}`}
            </Text>
            <View style={[styles.themeToggleCompact, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
              <ThemeButton icon="monitor" active={themeMode === 'system'} colors={colors} onPress={() => setThemeMode('system')} />
              <ThemeButton icon="sun" active={themeMode === 'light'} colors={colors} onPress={() => setThemeMode('light')} />
              <ThemeButton icon="moon" active={themeMode === 'dark'} colors={colors} onPress={() => setThemeMode('dark')} />
            </View>
          </View>
      </Animated.View>

      <Modal visible={switcherOpen} transparent animationType="fade" onRequestClose={() => setSwitcherOpen(false)}>
        <View style={[styles.switcherOverlay, { paddingTop: Math.max(insets.top + 50, 70) }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSwitcherOpen(false)} />
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
                  <TouchableOpacity style={styles.createFromQuery} onPress={createFromSwitcher}>
                    <Feather name="plus" size={18} color={colors.accent} />
                    <Text style={[styles.createFromQueryText, { color: colors.accent }]}>Create "{switcherQuery.trim()}" in {DEFAULT_FOLDER}</Text>
                  </TouchableOpacity>
                ) : null
              }
            />
          </View>
        </View>
      </Modal>

      <Modal visible={headingOpen} transparent animationType="slide" onRequestClose={() => setHeadingOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setHeadingOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16, backgroundColor: colors.bgElevated }]}>
          <SheetHandle />
          <SheetRow iconText="T" label="No heading" onPress={() => applyHeading(null)} />
          {[1, 2, 3, 4, 5, 6].map((level) => (
            <SheetRow key={level} iconText={`H${level}`} label={`Heading ${level}`} onPress={() => applyHeading(level)} />
          ))}
        </View>
      </Modal>

      <Modal visible={actionsOpen} transparent animationType="slide" onRequestClose={() => setActionsOpen(false)}>
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
            {backlinks.length === 0 ? (
              <SheetRow feather="corner-up-left" label="No backlinks" onPress={() => setActionsOpen(false)} />
            ) : (
              backlinks.map((doc) => <SheetRow key={doc.id} feather="corner-up-left" label={getDisplayTitle(doc)} onPress={() => openDoc(doc)} />)
            )}
            <SheetSectionTitle label="Outgoing links" />
            {outboundLinks.length === 0 ? (
              <SheetRow feather="corner-up-right" label="No outgoing links" onPress={() => setActionsOpen(false)} />
            ) : (
              outboundLinks.map((title) => <SheetRow key={title} feather="corner-up-right" label={title} onPress={() => openLinkedTitle(title)} />)
            )}
            <SheetRow feather="trash-2" label="Delete" destructive onPress={deleteSelected} />
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  tint,
  surface,
  border,
  onPress,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label?: string;
  disabled?: boolean;
  tint: string;
  surface: string;
  border: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.toolbarButton, { backgroundColor: surface, borderColor: border }, disabled && styles.toolbarButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {icon ? <Feather name={icon} size={21} color={disabled ? '#535963' : tint} /> : <Text style={[styles.toolbarLabel, { color: tint }, disabled && styles.toolbarLabelDisabled]}>{label}</Text>}
    </TouchableOpacity>
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
  editorWrap: { flex: 1, paddingHorizontal: 22 },
  editor: { flex: 1, fontSize: 18, lineHeight: 30, paddingTop: 34, paddingBottom: 120, letterSpacing: 0 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 120 },
  emptyAction: { minWidth: 220, borderRadius: 28, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' },
  emptyActionText: { fontSize: 17, fontWeight: '600', letterSpacing: 0 },
  markdownToolbar: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 6 },
  toolbarContent: { gap: 8, paddingHorizontal: 12, alignItems: 'center' },
  toolbarButton: { width: 42, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  toolbarButtonDisabled: { opacity: 0.45 },
  toolbarLabel: { fontSize: 20, fontWeight: '800', letterSpacing: 0 },
  toolbarLabelDisabled: { color: '#535963' },
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
  folderGroup: { marginBottom: 18 },
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
  createFromQuery: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 14 },
  createFromQueryText: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
  wikiPopover: { position: 'absolute', left: 14, right: 14, top: 74, zIndex: 2, borderWidth: 1, borderRadius: 18, paddingVertical: 8 },
  wikiRow: { paddingHorizontal: 14, paddingVertical: 10 },
  wikiTitle: { fontSize: 16, fontWeight: '600', letterSpacing: 0 },
  wikiPath: { fontSize: 12, marginTop: 2, letterSpacing: 0 },
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
