/**
 * CommandsList - Display and manage portable commands synced from Mac.
 *
 * Shows commands from Supabase that were synced when mobile sync is enabled.
 * Users can:
 * - View all synced commands
 * - Copy command content to clipboard
 * - Refresh to fetch latest commands
 *
 * Similar to the Fields page but for commands.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Vibration,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { Command } from '../types';
import { CommandsService } from '../services/commands';

interface CommandsListProps {
  /** Called when user wants to use a command (copy formatted text) */
  onUseCommand?: (text: string) => void;
}

export function CommandsList({ onUseCommand }: CommandsListProps) {
  const [commands, setCommands] = useState<Command[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load commands on mount
  useEffect(() => {
    loadCommands();
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const fetched = await CommandsService.fetchCommands();
      setCommands(fetched);
    } catch (error) {
      console.error('Failed to refresh commands:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyCommand = useCallback(async (command: Command) => {
    await Clipboard.setStringAsync(command.content);
    Vibration.vibrate();
    setCopiedId(command.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleUseCommand = useCallback((command: Command) => {
    // Format the command for use - include command header
    const formattedText = `---
# Command: ${command.displayName}

${command.content}

---`;

    if (onUseCommand) {
      onUseCommand(formattedText);
    } else {
      // Fallback: copy to clipboard
      Clipboard.setStringAsync(formattedText);
      Vibration.vibrate();
      setCopiedId(command.id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  }, [onUseCommand]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const renderCommand = useCallback(({ item }: { item: Command }) => {
    const isExpanded = expandedId === item.id;
    const isCopied = copiedId === item.id;

    // Preview: first 100 chars
    const preview = item.content.length > 100
      ? item.content.slice(0, 100) + '...'
      : item.content;

    return (
      <TouchableOpacity
        style={styles.commandCard}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.commandHeader}>
          <View style={styles.commandTitleRow}>
            <Feather name="file-text" size={16} color="#6366F1" />
            <Text style={styles.commandName}>{item.displayName}</Text>
          </View>
          <View style={styles.commandActions}>
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
          style={styles.commandPreview}
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
  }, [expandedId, copiedId, toggleExpand, handleCopyCommand, handleUseCommand]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366F1" />
        <Text style={styles.loadingText}>Loading commands...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={commands}
        keyExtractor={(item) => item.id}
        renderItem={renderCommand}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#6366F1"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="command" size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No commands synced</Text>
            <Text style={styles.emptySubtitle}>
              Enable mobile sync for command directories{'\n'}in the Mac app Settings {">"} Commands
            </Text>
          </View>
        }
        ListHeaderComponent={
          commands.length > 0 ? (
            <View style={styles.headerContainer}>
              <Text style={styles.headerText}>
                {commands.length} command{commands.length !== 1 ? 's' : ''} synced
              </Text>
              <Text style={styles.headerSubtext}>
                Say "use the [name] command" while recording
              </Text>
            </View>
          ) : null
        }
      />
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
