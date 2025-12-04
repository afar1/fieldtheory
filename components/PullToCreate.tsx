import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Keyboard,
  TouchableOpacity,
  Vibration,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

// How far the user must pull (overscroll) to activate the create card.
const PULL_THRESHOLD = 80;

// Height of the new item card when fully revealed.
const CARD_HEIGHT = 140;

export type ItemType = 'transcript' | 'task' | 'observation';

interface PullToCreateProps {
  // What type of item this creates - affects placeholder and styling.
  itemType: ItemType;
  
  // Called when user saves a new item. Return true to indicate success.
  onCreateItem: (text: string) => Promise<boolean> | boolean;
  
  // Whether the pull-to-create is currently enabled.
  enabled?: boolean;
  
  // Children (the list content - FlatList or SectionList).
  children: React.ReactNode;
  
  // Style for the container.
  style?: any;
}

/**
 * Wraps a scrollable list and adds pull-to-create functionality.
 * 
 * When user pulls down at the top of the list (iOS overscroll behavior),
 * we detect the overscroll and when released past the threshold,
 * animate a new card into view for inline text entry.
 * 
 * This approach works with React Native's native scroll behavior rather
 * than fighting against it with PanResponder.
 */
export function PullToCreate({
  itemType,
  onCreateItem,
  enabled = true,
  children,
  style,
}: PullToCreateProps) {
  // Track whether the create card is actively shown.
  const [isCreating, setIsCreating] = useState(false);
  
  // Text being entered in the new item card.
  const [newItemText, setNewItemText] = useState('');
  
  // Whether we're in the process of saving.
  const [isSaving, setIsSaving] = useState(false);
  
  // Animated value for card height when in create mode.
  const cardHeight = useRef(new Animated.Value(0)).current;
  
  // Animated value for pull indicator opacity and transform.
  const pullProgress = useRef(new Animated.Value(0)).current;
  
  // Reference to the text input for auto-focus.
  const inputRef = useRef<TextInput>(null);
  
  // Track if user is currently dragging.
  const isDragging = useRef(false);
  
  // Track current overscroll distance.
  const currentOverscroll = useRef(0);
  
  // Track if we already triggered the create in this gesture.
  const hasTriggeredCreate = useRef(false);

  // Get placeholder text based on item type.
  const getPlaceholder = () => {
    switch (itemType) {
      case 'transcript':
        return 'Type your note...';
      case 'task':
        return 'Add a new task...';
      case 'observation':
        return 'Add an observation...';
      default:
        return 'Type here...';
    }
  };

  // Get the accent color based on item type.
  const getAccentColor = () => {
    switch (itemType) {
      case 'transcript':
        return '#2563EB'; // Blue
      case 'task':
        return '#059669'; // Green
      case 'observation':
        return '#7C3AED'; // Purple
      default:
        return '#2563EB';
    }
  };

  // Handle saving the new item.
  const handleSave = useCallback(async () => {
    const trimmedText = newItemText.trim();
    if (!trimmedText || isSaving) return;
    
    setIsSaving(true);
    Keyboard.dismiss();
    
    try {
      const success = await onCreateItem(trimmedText);
      if (success) {
        // Success - close the card with animation.
        Vibration.vibrate(10);
        handleCancel();
      }
    } catch (error) {
      console.error('Failed to create item:', error);
    } finally {
      setIsSaving(false);
    }
  }, [newItemText, isSaving, onCreateItem]);

  // Handle canceling the create action.
  const handleCancel = useCallback(() => {
    Keyboard.dismiss();
    
    // Animate card closed.
    Animated.spring(cardHeight, {
      toValue: 0,
      useNativeDriver: false,
      tension: 50,
      friction: 10,
    }).start(() => {
      setIsCreating(false);
      setNewItemText('');
    });
  }, [cardHeight]);

  // Open the create card (called when user pulls past threshold and releases).
  const openCreateCard = useCallback(() => {
    if (isCreating) return;
    
    setIsCreating(true);
    hasTriggeredCreate.current = true;
    Vibration.vibrate(15);
    
    // Animate card to full height.
    Animated.spring(cardHeight, {
      toValue: CARD_HEIGHT,
      useNativeDriver: false,
      tension: 50,
      friction: 10,
    }).start(() => {
      // Focus the input after animation completes.
      setTimeout(() => inputRef.current?.focus(), 100);
    });
  }, [cardHeight, isCreating]);

  // Handle scroll events to detect overscroll (iOS bounce).
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!enabled || isCreating) return;
    
    const offsetY = event.nativeEvent.contentOffset.y;
    
    // Negative offsetY means we're overscrolling at the top.
    if (offsetY < 0 && isDragging.current) {
      currentOverscroll.current = Math.abs(offsetY);
      
      // Update pull indicator based on progress toward threshold.
      const progress = Math.min(currentOverscroll.current / PULL_THRESHOLD, 1);
      pullProgress.setValue(progress);
      
      // Haptic when passing threshold.
      if (currentOverscroll.current >= PULL_THRESHOLD && !hasTriggeredCreate.current) {
        Vibration.vibrate(10);
        hasTriggeredCreate.current = true;
      }
    } else {
      currentOverscroll.current = 0;
      if (!isCreating) {
        pullProgress.setValue(0);
      }
    }
  }, [enabled, isCreating, pullProgress]);

  // When user starts dragging.
  const handleScrollBeginDrag = useCallback(() => {
    isDragging.current = true;
    hasTriggeredCreate.current = false;
  }, []);

  // When user releases the drag.
  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    isDragging.current = false;
    
    if (!enabled || isCreating) return;
    
    // Check if we had enough overscroll to trigger create.
    const offsetY = event.nativeEvent.contentOffset.y;
    if (offsetY < -PULL_THRESHOLD) {
      openCreateCard();
    }
    
    // Fade out the pull indicator.
    if (!isCreating) {
      Animated.timing(pullProgress, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  }, [enabled, isCreating, openCreateCard, pullProgress]);

  // Calculate animated styles for pull indicator.
  const pullIndicatorOpacity = pullProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });

  const pullIndicatorScale = pullProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
    extrapolate: 'clamp',
  });

  const pullIndicatorTranslateY = pullProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, 0],
    extrapolate: 'clamp',
  });

  // Card container height animation.
  const cardContainerHeight = cardHeight.interpolate({
    inputRange: [0, CARD_HEIGHT],
    outputRange: [0, CARD_HEIGHT + 16],
    extrapolate: 'clamp',
  });

  const accentColor = getAccentColor();

  // Clone children to inject our scroll handlers.
  const clonedChildren = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    
    // Merge our handlers with any existing handlers on the child.
    return React.cloneElement(child as React.ReactElement<any>, {
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        handleScroll(event);
        const originalOnScroll = (child as React.ReactElement<any>).props?.onScroll;
        if (originalOnScroll) originalOnScroll(event);
      },
      onScrollBeginDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        handleScrollBeginDrag();
        const original = (child as React.ReactElement<any>).props?.onScrollBeginDrag;
        if (original) original(event);
      },
      onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        handleScrollEndDrag(event);
        const original = (child as React.ReactElement<any>).props?.onScrollEndDrag;
        if (original) original(event);
      },
      scrollEventThrottle: 16,
      // Ensure bounces is enabled on iOS for overscroll detection.
      bounces: true,
    });
  });

  return (
    <View style={[styles.container, style]}>
      {/* Pull indicator - shows while pulling before card opens */}
      {!isCreating && enabled && (
        <Animated.View
          style={[
            styles.pullIndicator,
            {
              opacity: pullIndicatorOpacity,
              transform: [
                { scale: pullIndicatorScale },
                { translateY: pullIndicatorTranslateY },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Feather name="plus-circle" size={28} color={accentColor} />
          <Text style={[styles.pullIndicatorText, { color: accentColor }]}>
            Release to create
          </Text>
        </Animated.View>
      )}

      {/* New item card - animates in when user pulls past threshold */}
      <Animated.View style={[styles.cardContainer, { height: cardContainerHeight }]}>
        {isCreating && (
          <View style={[styles.card, { borderColor: accentColor }]}>
            {/* Card header with type indicator and actions */}
            <View style={styles.cardHeader}>
              <View style={[styles.typeIndicator, { backgroundColor: accentColor }]}>
                <Feather
                  name={
                    itemType === 'task'
                      ? 'check-square'
                      : itemType === 'observation'
                      ? 'eye'
                      : 'file-text'
                  }
                  size={12}
                  color="#fff"
                />
                <Text style={styles.typeIndicatorText}>
                  New {itemType === 'task' ? 'Task' : itemType === 'observation' ? 'Note' : 'Transcript'}
                </Text>
              </View>
              
              <View style={styles.cardActions}>
                <TouchableOpacity
                  onPress={handleCancel}
                  style={styles.cancelButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Text input area */}
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={getPlaceholder()}
              placeholderTextColor="#9CA3AF"
              value={newItemText}
              onChangeText={setNewItemText}
              multiline
              autoFocus
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={handleSave}
            />

            {/* Save button */}
            <View style={styles.cardFooter}>
              <TouchableOpacity
                onPress={handleSave}
                style={[
                  styles.saveButton,
                  { backgroundColor: accentColor },
                  (!newItemText.trim() || isSaving) && styles.saveButtonDisabled,
                ]}
                disabled={!newItemText.trim() || isSaving}
              >
                <Feather name="check" size={16} color="#fff" />
                <Text style={styles.saveButtonText}>
                  {isSaving ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Animated.View>

      {/* The actual list content */}
      {clonedChildren}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  
  // Pull indicator shown while dragging down.
  pullIndicator: {
    position: 'absolute',
    top: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    gap: 4,
  },
  pullIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  
  // Container for the animated card.
  cardContainer: {
    overflow: 'hidden',
    paddingHorizontal: 20,
  },
  
  // The new item card.
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginTop: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  
  // Card header with type badge and close button.
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  typeIndicatorText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    padding: 4,
  },
  
  // Text input inside the card.
  input: {
    fontSize: 16,
    color: '#111',
    minHeight: 50,
    maxHeight: 70,
    paddingVertical: 4,
    lineHeight: 22,
  },
  
  // Footer with save button.
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
