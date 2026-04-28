import React, { memo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  TextInput,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TranscriptEntry } from '../types';
import { useThemeColors } from '../services/theme';

const MAX_PREVIEW_LINES = 3;
const ENDING_WORD_COUNT = 3;
// Long-press feel: must hold still for ~600ms; any movement > 8px cancels.
const LONG_PRESS_MS = 600;
const LONG_PRESS_MOVE_CANCEL_PX = 8;

/**
 * Count words in text.
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Smart truncation that shows beginning + ellipsis + last 3 words.
 * Helps users verify the transcription captured everything.
 */
function smartTruncate(text: string): {
  displayText: string;
  lastWords: string;
  needsTruncation: boolean;
} {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  
  // If very short, no truncation needed.
  if (words.length <= 15) {
    return { displayText: text, lastWords: '', needsTruncation: false };
  }
  
  // Get the last 3 words.
  const lastWords = words.slice(-ENDING_WORD_COUNT).join(' ');
  
  return {
    displayText: text, // Let numberOfLines handle the main truncation
    lastWords,
    needsTruncation: true,
  };
}

const dateHeaderFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: 'numeric',
});

const formatDateHeader = (timestamp: number) => dateHeaderFormatter.format(new Date(timestamp));
const formatTime = (timestamp: number) => timeFormatter.format(new Date(timestamp));

export interface TranscriptItemProps {
  item: TranscriptEntry;
  // Computed state for this item (avoids passing whole maps/sets)
  isExpanded: boolean;
  isCopied: boolean;
  isSelected: boolean;
  isProcessingThis: boolean;
  isSeparated: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  showDateHeader: boolean;
  // Mode flags
  selectionMode: boolean;
  isProcessingLLM: boolean;
  // Settings
  autoSeparate: boolean;
  // Editing state (only relevant when this item is being edited)
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  // Callbacks
  onToggleExpand: (id: string) => void;
  onSpeak: (entry: TranscriptEntry) => void;
  onManualSeparate: (text: string, id: string) => void;
  onUnstack: (id: string) => void;
  onCopy: (entry: TranscriptEntry) => void;
  onEnterSelectionMode: (id: string) => void;
  onToggleSelection: (id: string) => void;
  onEdit: (entry: TranscriptEntry) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string) => void;
}

/**
 * Memoized transcript card component.
 * Extracted from App.tsx to avoid re-rendering the entire list when one item changes.
 */
function TranscriptItemComponent({
  item,
  isExpanded,
  isCopied,
  isSelected,
  isProcessingThis,
  isSeparated,
  isSpeaking,
  isPaused,
  showDateHeader,
  selectionMode,
  isProcessingLLM,
  autoSeparate,
  isEditing,
  editText,
  onEditTextChange,
  onToggleExpand,
  onSpeak,
  onManualSeparate,
  onUnstack,
  onCopy,
  onEnterSelectionMode,
  onToggleSelection,
  onEdit,
  onCancelEdit,
  onSaveEdit,
}: TranscriptItemProps) {
  const colors = useThemeColors();
  const shouldShowExpand = item.text.length > 160 || item.text.includes('\n');
  const stackCount = item.stackSegments?.length ?? 1;
  const isStacked = stackCount > 1;
  
  // Word count for display.
  const wordCount = countWords(item.text);
  
  // Smart truncation for collapsed view.
  const { lastWords, needsTruncation } = smartTruncate(item.text);

  const handleExpandPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onToggleExpand(item.id);
  };

  const handleFindTasksPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onManualSeparate(item.text, item.id);
  };

  const handleSpeakPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onSpeak(item);
  };

  const handleStackBadgeLongPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onUnstack(item.id);
  };

  const handlePress = () => {
    if (selectionMode) {
      onToggleSelection(item.id);
    } else {
      onCopy(item);
    }
  };

  // Custom long press: only fires after holding still for LONG_PRESS_MS.
  // Any finger movement beyond LONG_PRESS_MOVE_CANCEL_PX cancels the timer.
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartPosRef.current = null;
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    if (selectionMode) return;
    longPressStartPosRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
    longPressTimerRef.current = setTimeout(() => {
      onEnterSelectionMode(item.id);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  const handleTouchMove = (event: GestureResponderEvent) => {
    const start = longPressStartPosRef.current;
    if (!start || !longPressTimerRef.current) return;
    const dx = event.nativeEvent.pageX - start.x;
    const dy = event.nativeEvent.pageY - start.y;
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_CANCEL_PX * LONG_PRESS_MOVE_CANCEL_PX) {
      cancelLongPressTimer();
    }
  };

  return (
    <View>
      {/* Inline date header - shown when date changes */}
      {showDateHeader && (
        <View style={styles.inlineDateHeader}>
          <Text style={styles.inlineDateHeaderText}>{formatDateHeader(item.createdAt)}</Text>
        </View>
      )}
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={cancelLongPressTimer}
        onTouchMove={handleTouchMove}
        onTouchCancel={cancelLongPressTimer}
        android_ripple={{ color: '#E2E8F0' }}
        style={[
          styles.transcriptCard,
          { backgroundColor: colors.bgSurface, borderColor: colors.border },
          isCopied && styles.transcriptCardCopied,
          isSelected && styles.transcriptCardSelected,
        ]}
      >
        {/* Floating checkbox overlay - positioned top-left of card */}
        {selectionMode && (
          <TouchableOpacity
            onPress={() => onToggleSelection(item.id)}
            style={styles.checkboxOverlay}
            hitSlop={8}
          >
            <View style={[styles.checkboxCircle, isSelected && styles.checkboxCircleSelected]}>
              {isSelected && <Feather name="check" size={12} color="#fff" />}
            </View>
          </TouchableOpacity>
        )}
        
        {/* Top row: Time + Stack badge on left, Edit button on right */}
        <View style={styles.transcriptHeader}>
          <View style={styles.transcriptHeaderLeft}>
            <Text style={[styles.transcriptTime, isCopied && styles.transcriptTimeCopied]}>
              {isCopied ? 'Copied!' : formatTime(item.createdAt)}
            </Text>
            {/* Word count badge */}
            <View style={styles.wordCountBadge}>
              <Text style={styles.wordCountText}>{wordCount} words</Text>
            </View>
            {/* Stack badge - next to time */}
            {isStacked && (
              <TouchableOpacity
                onLongPress={handleStackBadgeLongPress}
                delayLongPress={LONG_PRESS_MS}
                style={styles.stackBadge}
                hitSlop={8}
                disabled={selectionMode}
              >
                <Feather name="layers" size={12} color={selectionMode ? '#9CA3AF' : '#1D4ED8'} />
                <Text style={[styles.stackBadgeText, selectionMode && styles.stackBadgeTextDisabled]}>{stackCount}</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Expand/Collapse button - top right */}
          {shouldShowExpand && (
            <TouchableOpacity
              onPress={handleExpandPress}
              hitSlop={8}
              style={styles.expandButton}
            >
              <Text style={styles.expandButtonText}>
                {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        
        {/* Main text content - show TextInput when editing */}
        {isEditing ? (
          <View style={styles.transcriptEditContainer}>
            <TextInput
              style={[styles.transcriptEditInput, { color: colors.textPrimary, backgroundColor: colors.bgPage, borderColor: colors.border }]}
              value={editText}
              onChangeText={onEditTextChange}
              multiline
              autoFocus
              textAlignVertical="top"
              returnKeyType="default"
            />
            <View style={styles.transcriptEditActions}>
              <TouchableOpacity
                onPress={onCancelEdit}
                style={styles.transcriptEditCancel}
              >
                <Text style={styles.transcriptEditCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onSaveEdit(item.id, editText)}
                style={[
                  styles.transcriptEditSave,
                  !editText.trim() && styles.transcriptEditSaveDisabled,
                ]}
                disabled={!editText.trim()}
              >
                <Text style={styles.transcriptEditSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <Text
              style={[styles.transcriptText, { color: colors.textPrimary }]}
              numberOfLines={isExpanded ? undefined : MAX_PREVIEW_LINES}
            >
              {item.text}
            </Text>
            {/* Last words indicator - shows when collapsed and text is long enough */}
            {!isExpanded && needsTruncation && (
              <Text style={styles.lastWordsText}>
                [...] {lastWords}
              </Text>
            )}
          </View>
        )}
        
        {/* Bottom row: Action buttons */}
        <View style={styles.transcriptFooter}>
          <View style={styles.transcriptActions}>
            <TouchableOpacity
              onPress={handleSpeakPress}
              hitSlop={8}
              style={[styles.speakButton, selectionMode && styles.actionButtonDisabled]}
              disabled={selectionMode}
            >
              <Feather
                name={isPaused ? 'play' : isSpeaking ? 'pause' : 'volume-2'}
                size={14}
                color={selectionMode ? '#9CA3AF' : '#B45309'}
              />
              <Text style={[styles.speakButtonText, selectionMode && styles.speakButtonTextDisabled]}>
                {isPaused ? 'Resume' : isSpeaking ? 'Pause' : 'Play'}
              </Text>
            </TouchableOpacity>
            {/* Create Tasks - button when auto-create off, status when auto-create on */}
            {autoSeparate ? (
              // Auto-create is ON - show status
              isProcessingLLM ? (
                <View style={styles.tasksSavedLabel}>
                  <Feather name="loader" size={14} color="#7C3AED" />
                  <Text style={styles.tasksCreatingText}>Creating tasks...</Text>
                </View>
              ) : isSeparated ? (
                <View style={styles.tasksSavedLabel}>
                  <Feather name="check" size={14} color="#059669" />
                  <Text style={styles.tasksSavedText}>Tasks created</Text>
                </View>
              ) : null
            ) : (
              // Auto-create is OFF - show button
              isSeparated ? (
                <View style={styles.tasksSavedLabel}>
                  <Feather name="check" size={14} color="#059669" />
                  <Text style={styles.tasksSavedText}>Created</Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleFindTasksPress}
                  hitSlop={8}
                  style={[styles.separateButton, (selectionMode || isProcessingLLM) && styles.actionButtonDisabled]}
                  disabled={isProcessingLLM || selectionMode}
                >
                  <Feather name="git-branch" size={14} color={(isProcessingLLM || selectionMode) ? '#9CA3AF' : '#7C3AED'} />
                  <Text style={[styles.separateButtonText, (isProcessingLLM || selectionMode) && styles.separateButtonTextDisabled]}>
                    {isProcessingThis ? 'Creating...' : 'Create Tasks'}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// Memoize the component to prevent re-renders when props haven't changed.
export const TranscriptItem = memo(TranscriptItemComponent);

const styles = StyleSheet.create({
  inlineDateHeader: {
    paddingVertical: 8,
    paddingTop: 16,
  },
  inlineDateHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  transcriptCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transcriptCardCopied: {
    borderColor: '#2563EB',
  },
  transcriptCardSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#818CF8',
  },
  checkboxOverlay: {
    position: 'absolute',
    top: -4,
    left: -4,
    zIndex: 10,
  },
  checkboxCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCircleSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  transcriptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  transcriptHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transcriptTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  transcriptTimeCopied: {
    color: '#2563EB',
    fontWeight: '600',
  },
  stackBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#DBEAFE',
    gap: 4,
  },
  stackBadgeText: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  stackBadgeTextDisabled: {
    color: '#9CA3AF',
  },
  wordCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
  },
  wordCountText: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  lastWordsText: {
    fontSize: 14,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 4,
  },
  editButton: {
    padding: 4,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  transcriptEditContainer: {
    marginTop: 8,
  },
  transcriptEditInput: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    maxHeight: 200,
    backgroundColor: '#F9FAFB',
  },
  transcriptEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  transcriptEditCancel: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  transcriptEditCancelText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  transcriptEditSave: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  transcriptEditSaveDisabled: {
    opacity: 0.5,
  },
  transcriptEditSaveText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  transcriptText: {
    fontSize: 16,
    lineHeight: 22,
    color: '#111',
  },
  transcriptFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  transcriptActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  speakButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    gap: 5,
  },
  speakButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
  },
  speakButtonTextDisabled: {
    color: '#9CA3AF',
  },
  separateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#F3E8FF',
    borderWidth: 1,
    borderColor: '#DDD6FE', // Slightly darker purple
    gap: 5,
  },
  separateButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
  },
  separateButtonTextDisabled: {
    color: '#9CA3AF',
  },
  tasksSavedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  tasksSavedText: {
    fontSize: 13,
    color: '#059669',
  },
  tasksCreatingText: {
    fontSize: 13,
    color: '#7C3AED',
  },
  expandButton: {
    paddingVertical: 4,
  },
  expandButtonText: {
    fontSize: 13,
    color: '#6B7280',
  },
});
