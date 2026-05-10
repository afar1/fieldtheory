import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  SectionList,
  Alert,
  Vibration,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Todo } from '../types';
import * as Clipboard from 'expo-clipboard';
import { PullToCreate } from './PullToCreate';
import { useThemeColors } from '../services/theme';

type TodoSection = {
  key: string;
  title: string;
  data: Todo[];
};

interface TodoListProps {
  sections: TodoSection[];
  onToggleComplete: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  formatTime: (timestamp: number) => string;
  formatDateHeader: (timestamp: number) => string;
  // Called when user creates a new task via pull-to-create.
  onCreateTask?: (text: string) => Promise<boolean> | boolean;
  // Called when create mode changes - parent uses this for dynamic bottom bar.
  onCreateModeChange?: (isCreating: boolean, canSave: boolean, save: () => void, cancel: () => void) => void;
  // Opacity 0..1 applied to the search header so it fades during a page swipe.
  searchOpacity?: number;
}

/**
 * List component for displaying and managing todos.
 * Supports tap-to-edit, checkbox toggle, swipe-to-delete, and copy.
 * Groups items by date with sticky section headers.
 * Pull down at the top to create a new task inline (no modal).
 */
export function TodoList({
  sections,
  onToggleComplete,
  onUpdate,
  onDelete,
  formatTime,
  formatDateHeader,
  onCreateTask,
  onCreateModeChange,
  searchOpacity = 1,
}: TodoListProps) {
  const colors = useThemeColors();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sections;
    return sections
      .map((s) => ({ ...s, data: s.data.filter((t) => t.text.toLowerCase().includes(q)) }))
      .filter((s) => s.data.length > 0);
  }, [sections, searchQuery]);

  // Memoized so the SectionList's ListHeaderComponent identity stays stable
  // across re-renders; otherwise the TextInput remounts each keystroke and
  // loses focus, which looks like "search doesn't filter".
  const searchHeaderEl = useMemo(
    () => (
      <View style={[searchStyles.searchHeader, { opacity: searchOpacity }]}>
        {searchVisible ? (
          <View style={[searchStyles.searchInputRow, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.textSecondary} />
            <TextInput
              style={[searchStyles.searchInput, { color: colors.textPrimary }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search tasks"
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
            style={searchStyles.searchIconButton}
            onPress={() => setSearchVisible(true)}
            hitSlop={8}
          >
            <Feather name="search" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    ),
    [searchVisible, searchQuery, searchOpacity, colors],
  );

  const handleEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditText(todo.text);
  };

  const handleSave = () => {
    if (editingId && editText.trim()) {
      onUpdate(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleCopy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Vibration.vibrate();
    Alert.alert('Copied', 'Todo copied to clipboard');
  };

  const handleDelete = (id: string) => {
    onDelete(id);
  };

  // Handle creating a new task via pull-to-create.
  const handleCreateTask = useCallback(async (text: string) => {
    if (onCreateTask) {
      return await onCreateTask(text);
    }
    return false;
  }, [onCreateTask]);

  const renderItem = ({ item: todo }: { item: Todo }) => (
    <View style={[styles.item, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.checkbox}
        onPress={() => onToggleComplete(todo.id)}
      >
        <Text style={styles.checkboxText}>{todo.completed ? '✓' : '○'}</Text>
      </TouchableOpacity>
      
      <View style={styles.textContainer}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemTime}>{formatTime(todo.createdAt)}</Text>
        </View>
        <TouchableOpacity
          onPress={() => handleEdit(todo)}
          onLongPress={() => handleCopy(todo.text)}
        >
          <Text
            style={[
              styles.text,
              { color: colors.textPrimary },
              todo.completed && styles.textCompleted,
            ]}
          >
            {todo.text}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => handleDelete(todo.id)}
      >
        <Text style={styles.deleteButtonText}>×</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSectionHeader = ({ section }: { section: TodoSection }) => (
    <View style={[styles.sectionHeader, { backgroundColor: colors.bgPage }]}>
      <Text style={[styles.sectionHeaderText, { color: colors.textSecondary }]}>{section.title}</Text>
    </View>
  );

  if (filteredSections.length === 0) {
    return (
      <PullToCreate
        itemType="task"
        onCreateItem={handleCreateTask}
        enabled={!!onCreateTask}
        style={styles.container}
        onCreateModeChange={onCreateModeChange}
      >
        <SectionList
          sections={[]}
          renderItem={() => null}
          ListHeaderComponent={searchHeaderEl}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.textPrimary }]}>
                {searchQuery ? 'No matches' : 'No todos yet'}
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
                {searchQuery ? 'Try a different search term.' : 'Pull down to create a task'}
              </Text>
            </View>
          }
          contentContainerStyle={{ flex: 1 }}
        />
      </PullToCreate>
    );
  }

  return (
    <React.Fragment>
      <PullToCreate
        itemType="task"
        onCreateItem={handleCreateTask}
        enabled={!!onCreateTask}
        style={styles.container}
        onCreateModeChange={onCreateModeChange}
      >
        <SectionList
          sections={filteredSections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={searchHeaderEl}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.content}
        />
      </PullToCreate>

      <Modal
        visible={editingId !== null}
        transparent
        animationType="fade"
        onRequestClose={handleCancel}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoidingView}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Todo</Text>
              <TextInput
                style={styles.modalInput}
                value={editText}
                onChangeText={setEditText}
                autoFocus
                multiline
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={handleCancel}
                >
                  <Text style={styles.modalButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={handleSave}
                >
                  <Text style={[styles.modalButtonText, styles.modalButtonTextSave]}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </React.Fragment>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingVertical: 6,
    paddingHorizontal: 20,
    marginHorizontal: -20,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  checkbox: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkboxText: {
    fontSize: 20,
    color: '#007AFF',
  },
  textContainer: {
    flex: 1,
  },
  itemHeader: {
    marginBottom: 4,
  },
  itemTime: {
    fontSize: 13,
    color: '#6B7280',
  },
  text: {
    fontSize: 16,
    color: '#000',
  },
  textCompleted: {
    textDecorationLine: 'line-through',
    color: '#999',
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  deleteButtonText: {
    fontSize: 24,
    color: '#FF3B30',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  keyboardAvoidingView: {
    width: '100%',
    maxWidth: 400,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    color: '#000',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalButtonCancel: {
    backgroundColor: '#F5F5F5',
  },
  modalButtonSave: {
    backgroundColor: '#007AFF',
  },
  modalButtonText: {
    fontSize: 16,
    color: '#666',
  },
  modalButtonTextSave: {
    color: '#fff',
    fontWeight: '600',
  },
});

const searchStyles = StyleSheet.create({
  searchHeader: {
    paddingHorizontal: 12,
    paddingTop: 4,
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
});

