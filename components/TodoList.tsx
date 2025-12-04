import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import { Todo } from '../types';
import * as Clipboard from 'expo-clipboard';
import { PullToCreate } from './PullToCreate';

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
}: TodoListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

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
    Alert.alert('Delete Todo', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(id) },
    ]);
  };

  // Handle creating a new task via pull-to-create.
  const handleCreateTask = useCallback(async (text: string) => {
    if (onCreateTask) {
      return await onCreateTask(text);
    }
    return false;
  }, [onCreateTask]);

  const renderItem = ({ item: todo }: { item: Todo }) => (
    <View style={styles.item}>
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
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  if (sections.length === 0) {
    return (
      <PullToCreate
        itemType="task"
        onCreateItem={handleCreateTask}
        enabled={!!onCreateTask}
        style={styles.container}
      >
        <SectionList
          sections={[]}
          renderItem={() => null}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No todos yet</Text>
              <Text style={styles.emptySubtext}>Pull down to create a task</Text>
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
      >
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
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
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
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


