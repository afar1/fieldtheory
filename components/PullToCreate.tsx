import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Keyboard,
  Vibration,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useThemeColors } from '../services/theme';

// How far the user must pull (overscroll) to activate the create card.
const PULL_THRESHOLD = 80;

// Minimum height of the new item card (just the input, no header).
const CARD_HEIGHT = 56;

export type ItemType = 'transcript' | 'task' | 'observation' | 'command';

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
  
  // Called when create mode changes - parent can use this to show/hide bottom bar.
  onCreateModeChange?: (isCreating: boolean, canSave: boolean, save: () => void, cancel: () => void) => void;
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
  onCreateModeChange,
}: PullToCreateProps) {
  const colors = useThemeColors();

  // Track whether the create card is actively shown.
  const [isCreating, setIsCreating] = useState(false);
  
  // Text being entered in the new item card.
  const [newItemText, setNewItemText] = useState('');
  
  // Whether we're in the process of saving.
  const [isSaving, setIsSaving] = useState(false);
  const newItemTextRef = useRef('');
  const isSavingRef = useRef(false);
  
  // Animated value for card height when in create mode.
  const cardHeight = useRef(new Animated.Value(0)).current;
  
  // Animated value for pull indicator opacity and transform.
  const pullProgress = useRef(new Animated.Value(0)).current;
  
  // Reference to the text input for auto-focus.
  const inputRef = useRef<TextInput>(null);
  
  // Track if we just submitted via keyboard to prevent double-save on blur.
  const justSubmitted = useRef(false);
  
  // Track if user is currently dragging.
  const isDragging = useRef(false);
  
  // Track current overscroll distance.
  const currentOverscroll = useRef(0);
  
  // Track if we already triggered the create in this gesture.
  const hasTriggeredCreate = useRef(false);

  useEffect(() => {
    newItemTextRef.current = newItemText;
  }, [newItemText]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  // Get placeholder text based on item type.
  const getPlaceholder = () => {
    switch (itemType) {
      case 'transcript':
        return 'Add item...';
      case 'task':
        return 'Add a new task...';
      case 'observation':
        return 'Add an observation...';
      case 'command':
        return 'Command title\nThen the command content...';
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
      case 'command':
        return '#6366F1'; // Indigo
      default:
        return '#2563EB';
    }
  };

  // Handle canceling the create action.
  // Use a short timing instead of a long spring so the bottom-bar swap back
  // to nav tabs happens in ~120ms instead of waiting for the spring to settle.
  const handleCancel = useCallback(() => {
    Keyboard.dismiss();
    justSubmitted.current = false;
    newItemTextRef.current = '';

    Animated.timing(cardHeight, {
      toValue: 0,
      duration: 120,
      useNativeDriver: false,
    }).start(() => {
      setIsCreating(false);
      setNewItemText('');
    });
  }, [cardHeight]);

  // Handle saving the new item.
  const handleSave = useCallback(async () => {
    const trimmedText = newItemTextRef.current.trim();
    if (!trimmedText || isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    justSubmitted.current = true;
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
      isSavingRef.current = false;
      setIsSaving(false);
      // Reset flag after a short delay to allow blur to check it
      setTimeout(() => {
        justSubmitted.current = false;
      }, 100);
    }
  }, [handleCancel, onCreateItem]);

  const canSave = newItemText.trim().length > 0 && !isSaving;

  // Notify parent when create mode changes so it can update the bottom bar.
  useEffect(() => {
    if (onCreateModeChange) {
      onCreateModeChange(isCreating, canSave, handleSave, handleCancel);
    }
  }, [isCreating, canSave, onCreateModeChange, handleSave, handleCancel]);

  // Open the create card (called when user pulls past threshold and releases).
  const openCreateCard = useCallback(() => {
    if (isCreating) return;
    
    // Reset pull indicator immediately so it doesn't stay visible.
    pullProgress.setValue(0);
    
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
  }, [cardHeight, isCreating, pullProgress]);

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
    } else if (currentOverscroll.current !== 0) {
      // Only zero out / reset when transitioning out of overscroll.
      // Re-firing setValue(0) on every regular scroll frame caused bridge
      // chatter that showed up as visible pull-indicator jitter.
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
    
    // Fade out the pull indicator. Indicator drives only opacity + transform,
    // both native-driver compatible — keep this off the JS thread for smoother
    // motion under release pressure.
    if (!isCreating) {
      Animated.timing(pullProgress, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
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

  // Card container - no longer animated height, let it size naturally.
  // We still animate cardHeight for the initial reveal, but the container
  // uses 'auto' height once open.
  const cardContainerHeight = cardHeight.interpolate({
    inputRange: [0, CARD_HEIGHT],
    outputRange: [0, CARD_HEIGHT],
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
      scrollEventThrottle: 32,
      // Ensure bounces is enabled on iOS for overscroll detection.
      bounces: true,
    });
  });

  // Ensure accentColor is valid (fallback to blue if undefined)
  const safeAccentColor = accentColor || '#2563EB';

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
          <Feather name="plus-circle" size={28} color={safeAccentColor} />
          <Text style={[styles.pullIndicatorText, { color: safeAccentColor }]}>
            Release to create
          </Text>
        </Animated.View>
      )}

      {/* New item card - minimal, just the input */}
      <Animated.View style={[styles.cardContainer, { height: cardContainerHeight }]}>
        {isCreating && (
          <View style={[styles.card, { borderColor: safeAccentColor, backgroundColor: colors.bgSurface }]}>
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder={getPlaceholder()}
              placeholderTextColor={colors.textTertiary}
              value={newItemText}
              onChangeText={setNewItemText}
              multiline
              autoFocus
              scrollEnabled={false}
              returnKeyType="default"
              blurOnSubmit={false}
            />
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
    position: 'relative',
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
  
  // The new item card - minimal, just wraps the input.
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  
  // Text input inside the card - single line initially, expands with content.
  input: {
    fontSize: 16,
    color: '#111',
    paddingVertical: 0,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
