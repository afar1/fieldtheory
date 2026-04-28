/**
 * CommandsList - Display and manage portable commands synced from Mac.
 *
 * Shows commands from Supabase that were synced when mobile sync is enabled.
 * Users can:
 * - View all synced commands
 * - Search commands by name or content
 * - Favorite commands (favorites pinned to top, persisted locally)
 * - Copy command content to clipboard
 * - Refresh to fetch latest commands
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  ActivityIndicator,
  TextInput,
  Keyboard,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Command } from '../types';
import { CommandsService } from '../services/commands';
import { useThemeColors } from '../services/theme';
import { PullToCreate } from './PullToCreate';

const FAVORITES_KEY = '@littleai/commandFavorites';

interface CommandsListProps {
  /** Called when user wants to use a command (copy formatted text) */
  onUseCommand?: (text: string) => void;
  /** Opacity 0..1 applied to the search header so it fades during a page swipe. */
  searchOpacity?: number;
  /** Notifies parent of pull-to-create state so the bottom bar can swap to Cancel/Save. */
  onCreateModeChange?: (isCreating: boolean, text: string, save: () => void, cancel: () => void) => void;
}

export function CommandsList({ onUseCommand, searchOpacity = 1, onCreateModeChange }: CommandsListProps) {
  const colors = useThemeColors();
  const [commands, setCommands] = useState<Command[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCommands();
    loadFavorites();
  }, []);

  const loadCommands = async () => {
    try {
      setIsLoading(true);
      const fetched = await CommandsService.fetchCommands();
      setCommands(fetched);
    } catch (error) {
      console.error('Failed to load commands:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFavorites = async () => {
    try {
      const data = await AsyncStorage.getItem(FAVORITES_KEY);
      if (data) {
        const ids: string[] = JSON.parse(data);
        setFavoriteIds(new Set(ids));
      }
    } catch (error) {
      console.error('Failed to load command favorites:', error);
    }
  };

  const persistFavorites = async (ids: Set<string>) => {
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(ids)));
    } catch (error) {
      console.error('Failed to save command favorites:', error);
    }
  };

  // Pull-to-create handler. Inserts via Supabase, then re-fetches so the new
  // command shows up at the right sort position (and we pick up server defaults).
  const handleCreateCommand = useCallback(async (text: string) => {
    const created = await CommandsService.createCommand(text);
    if (!created) return false;
    Vibration.vibrate(15);
    const fetched = await CommandsService.fetchCommands();
    setCommands(fetched);
    return true;
  }, []);

  const handleCopyCommand = useCallback(async (command: Command) => {
    await Clipboard.setStringAsync(command.content);
    Vibration.vibrate();
    setCopiedId(command.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleUseCommand = useCallback((command: Command) => {
    const formattedText = `---
# Command: ${command.displayName}

${command.content}

---`;

    if (onUseCommand) {
      onUseCommand(formattedText);
    } else {
      Clipboard.setStringAsync(formattedText);
      Vibration.vibrate();
      setCopiedId(command.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, [onUseCommand]);

  const handleToggleFavorite = useCallback((command: Command) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(command.id)) {
        next.delete(command.id);
      } else {
        next.add(command.id);
      }
      persistFavorites(next);
      return next;
    });
    Vibration.vibrate(10);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const visibleCommands = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? commands.filter((c) =>
          c.displayName.toLowerCase().includes(q) ||
          c.content.toLowerCase().includes(q),
        )
      : commands;
    // Pin favorites to the top, preserve relative order otherwise.
    return [...filtered].sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 0 : 1;
      const bFav = favoriteIds.has(b.id) ? 0 : 1;
      return aFav - bFav;
    });
  }, [commands, searchQuery, favoriteIds]);

  const renderCommand = useCallback(({ item }: { item: Command }) => {
    const isExpanded = expandedId === item.id;
    const isCopied = copiedId === item.id;
    const isFavorite = favoriteIds.has(item.id);

    const preview = item.content.length > 100
      ? item.content.slice(0, 100) + '...'
      : item.content;

    return (
      <TouchableOpacity
        style={[styles.commandCard, { backgroundColor: colors.bgSurface, borderColor: colors.border, borderWidth: 1 }]}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.commandHeader}>
          <View style={styles.commandTitleRow}>
            <Feather name="file-text" size={16} color="#6366F1" />
            <Text style={[styles.commandName, { color: colors.textPrimary }]}>{item.displayName}</Text>
          </View>
          <View style={styles.commandActions}>
            <TouchableOpacity
              style={[styles.actionButton, isFavorite && styles.actionButtonFavorite]}
              onPress={(e) => {
                e.stopPropagation?.();
                handleToggleFavorite(item);
              }}
            >
              <Feather
                name="star"
                size={16}
                color={isFavorite ? '#F59E0B' : '#6B7280'}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, isCopied && styles.actionButtonCopied]}
              onPress={(e) => {
                e.stopPropagation?.();
                handleCopyCommand(item);
              }}
            >
              <Feather
                name={isCopied ? "check" : "copy"}
                size={16}
                color={isCopied ? "#10B981" : "#6B7280"}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation?.();
                handleUseCommand(item);
              }}
            >
              <Feather name="play" size={16} color="#6366F1" />
            </TouchableOpacity>
          </View>
        </View>

        <Text
          style={[styles.commandPreview, { color: colors.textSecondary }]}
          numberOfLines={isExpanded ? undefined : 3}
        >
          {isExpanded ? item.content : preview}
        </Text>

        {item.content.length > 100 && (
          <Text style={styles.expandHint}>
            {isExpanded ? 'Tap to collapse' : 'Tap to expand'}
          </Text>
        )}
      </TouchableOpacity>
    );
  }, [expandedId, copiedId, favoriteIds, toggleExpand, handleCopyCommand, handleUseCommand, handleToggleFavorite]);

  // Search row + count subtitle, memoized as the FlatList ListHeaderComponent.
  // Without memoization, the wrapping fragment is a new identity every render,
  // FlatList remounts the header, and the TextInput loses focus on each
  // keystroke — which manifests as "search doesn't filter".
  // While searching, the bulk count ("62 commands synced") is replaced with a
  // match count so the header doesn't lie about what's visible below.
  // Defined BEFORE any early-return so hook order stays stable across renders.
  const isSearching = searchQuery.trim().length > 0;
  const matchCount = visibleCommands.length;
  const listHeader = useMemo(
    () => (
      <>
        <View style={[styles.searchHeader, { opacity: searchOpacity }]}>
          {searchVisible ? (
            <View style={[styles.searchInputRow, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
              <Feather name="search" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search commands"
                placeholderTextColor={colors.textTertiary}
                autoFocus
                returnKeyType="search"
              />
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery('');
                  setSearchVisible(false);
                  Keyboard.dismiss();
                }}
                hitSlop={8}
              >
                <Feather name="x" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.searchIconButton}
              onPress={() => setSearchVisible(true)}
              hitSlop={8}
            >
              <Feather name="search" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        {isSearching ? (
          <View style={styles.headerContainer}>
            <Text style={[styles.headerText, { color: colors.textPrimary }]}>
              {matchCount} match{matchCount !== 1 ? 'es' : ''}
            </Text>
          </View>
        ) : commands.length > 0 ? (
          <View style={styles.headerContainer}>
            <Text style={[styles.headerText, { color: colors.textPrimary }]}>
              {commands.length} command{commands.length !== 1 ? 's' : ''} synced
            </Text>
            <Text style={[styles.headerSubtext, { color: colors.textSecondary }]}>
              Say "use the [name] command" while recording
            </Text>
          </View>
        ) : null}
      </>
    ),
    [
      searchVisible,
      searchQuery,
      searchOpacity,
      isSearching,
      matchCount,
      commands.length,
      colors,
    ],
  );

  // Loading guard placed AFTER all hooks so hook order is stable across renders.
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading commands...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPage }]}>
      <PullToCreate
        itemType="command"
        onCreateItem={handleCreateCommand}
        enabled={true}
        style={{ flex: 1 }}
        onCreateModeChange={onCreateModeChange}
      >
      <FlatList
        data={visibleCommands}
        keyExtractor={(item) => item.id}
        renderItem={renderCommand}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="command" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
              {searchQuery ? 'No matches' : 'No commands synced'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {searchQuery
                ? 'Try a different search term.'
                : `Enable mobile sync for command directories\nin the Mac app Settings > Commands`}
            </Text>
          </View>
        }
        ListHeaderComponent={listHeader}
      />
      </PullToCreate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F5F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F4F5F7',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  searchHeader: {
    paddingHorizontal: 4,
    paddingTop: 0,
    paddingBottom: 4,
  },
  searchIconButton: {
    alignSelf: 'flex-end',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  headerContainer: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  headerText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  headerSubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  commandCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  commandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  commandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commandName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  commandActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  actionButtonCopied: {
    backgroundColor: '#D1FAE5',
  },
  actionButtonFavorite: {
    backgroundColor: '#FEF3C7',
  },
  commandPreview: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  expandHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
