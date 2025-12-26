/**
 * SketchCanvas - One-shot sketch capture component for iOS.
 * 
 * User taps "New Sketch" → draws with finger (Apple Pencil works too) → taps Done.
 * The sketch is immediately finalized into a PNG image (immutable; no later editing).
 * 
 * Features:
 * - Finger-first drawing optimized for touch
 * - Minimal controls: pen, eraser, clear, undo, done, cancel
 * - Exports to PNG at retina-safe resolution using react-native-view-shot
 * - Dark canvas with light stroke for visibility
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Modal,
  Alert,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Canvas, CanvasRef, DrawingTool } from '@benjeau/react-native-draw';
import ViewShot from 'react-native-view-shot';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Canvas dimensions - use screen width for full-width drawings.
// Height is calculated to maintain a reasonable aspect ratio.
const CANVAS_WIDTH = SCREEN_WIDTH - 32; // Account for padding
const CANVAS_HEIGHT = Math.min(SCREEN_HEIGHT * 0.50, 380); // Limit height for controls

// Preset colors for the color picker.
const PRESET_COLORS = [
  '#FFFFFF', // White (default on dark canvas)
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#FFE66D', // Yellow
  '#95E1D3', // Mint
  '#F38181', // Coral
  '#AA96DA', // Purple
  '#FCBAD3', // Pink
];

// Brush sizes available for cycling.
const BRUSH_SIZES = [2, 4, 8, 12];

interface SketchCanvasProps {
  // Called when user taps Done with the sketch image URI.
  onComplete: (data: {
    uri: string;
    width: number;
    height: number;
  }) => void;
  
  // Called when user cancels without saving.
  onCancel: () => void;
  
  // Whether the modal is visible.
  visible: boolean;
}

export function SketchCanvas({ onComplete, onCancel, visible }: SketchCanvasProps) {
  const canvasRef = useRef<CanvasRef>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [brushSizeIndex, setBrushSizeIndex] = useState(1); // Start at 4px
  const [isEraser, setIsEraser] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const brushSize = BRUSH_SIZES[brushSizeIndex];

  // Handle canvas changes to track if user has drawn anything.
  const handlePathsChange = useCallback(() => {
    setHasDrawn(true);
  }, []);

  // Clear the entire canvas.
  const handleClear = useCallback(() => {
    if (!hasDrawn) return;
    
    Alert.alert(
      'Clear Canvas',
      'Are you sure you want to clear everything?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            canvasRef.current?.clear();
            setHasDrawn(false);
          },
        },
      ]
    );
  }, [hasDrawn]);

  // Undo the last stroke.
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  // Toggle eraser mode.
  const handleToggleEraser = useCallback(() => {
    setIsEraser((prev) => !prev);
  }, []);

  // Handle cancel with confirmation if there's unsaved work.
  const handleCancel = useCallback(() => {
    if (hasDrawn) {
      Alert.alert(
        'Discard Sketch?',
        'You have unsaved changes. Are you sure you want to discard?',
        [
          { text: 'Keep Drawing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              canvasRef.current?.clear();
              setHasDrawn(false);
              setIsEraser(false);
              setBrushSizeIndex(1);
              setSelectedColor(PRESET_COLORS[0]);
              onCancel();
            },
          },
        ]
      );
    } else {
      onCancel();
    }
  }, [hasDrawn, onCancel]);

  // Export the drawing as PNG and call onComplete.
  const handleDone = useCallback(async () => {
    if (!hasDrawn) {
      Alert.alert('Empty Canvas', 'Please draw something before saving.');
      return;
    }

    if (isExporting) return;

    try {
      setIsExporting(true);

      // Capture the canvas view as PNG using ViewShot.
      // Scale factor of 2 for retina display quality.
      const uri = await viewShotRef.current?.capture?.();
      
      if (!uri) {
        throw new Error('Could not capture canvas');
      }

      // Calculate actual dimensions (accounting for pixel ratio).
      const pixelRatio = 2; // Retina scale
      const width = Math.round(CANVAS_WIDTH * pixelRatio);
      const height = Math.round(CANVAS_HEIGHT * pixelRatio);

      onComplete({
        uri,
        width,
        height,
      });
      
      // Reset state for next sketch.
      canvasRef.current?.clear();
      setHasDrawn(false);
      setIsEraser(false);
      setBrushSizeIndex(1);
      setSelectedColor(PRESET_COLORS[0]);
    } catch (error) {
      console.error('Failed to export sketch:', error);
      Alert.alert('Export Failed', 'Failed to save the sketch. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [hasDrawn, isExporting, onComplete]);

  // Select a color from presets.
  const handleSelectColor = useCallback((color: string) => {
    setSelectedColor(color);
    setIsEraser(false); // Switch back to pen when selecting color
  }, []);

  // Cycle through brush sizes.
  const handleCycleBrushSize = useCallback(() => {
    setBrushSizeIndex((prev) => (prev + 1) % BRUSH_SIZES.length);
  }, []);

  // Determine the actual drawing color (white for eraser on dark canvas).
  // The eraser works by drawing with the canvas background color.
  const drawingColor = isEraser ? '#2C2C2E' : selectedColor;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleCancel}
    >
      <SafeAreaView style={styles.container}>
        {/* Header with Cancel and Done */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleCancel} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          
          <Text style={styles.title}>New Sketch</Text>
          
          <TouchableOpacity
            onPress={handleDone}
            style={[
              styles.headerButton,
              styles.doneButton,
              (!hasDrawn || isExporting) && styles.doneButtonDisabled,
            ]}
            disabled={!hasDrawn || isExporting}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={[styles.doneText, !hasDrawn && styles.doneTextDisabled]}>Done</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Canvas Area wrapped in ViewShot for capture */}
        <View style={styles.canvasContainer}>
          <ViewShot
            ref={viewShotRef}
            options={{
              format: 'png',
              quality: 1,
              result: 'tmpfile',
            }}
          >
            <Canvas
              ref={canvasRef}
              height={CANVAS_HEIGHT}
              width={CANVAS_WIDTH}
              color={drawingColor}
              thickness={brushSize}
              opacity={1}
              tool={isEraser ? DrawingTool.Eraser : DrawingTool.Brush}
              style={styles.canvas}
              onPathsChange={handlePathsChange}
            />
          </ViewShot>
        </View>

        {/* Color Picker Row */}
        <View style={styles.colorRow}>
          {PRESET_COLORS.map((color) => (
            <TouchableOpacity
              key={color}
              onPress={() => handleSelectColor(color)}
              style={[
                styles.colorButton,
                { backgroundColor: color },
                selectedColor === color && !isEraser && styles.colorButtonSelected,
              ]}
            />
          ))}
        </View>

        {/* Tools Bar */}
        <View style={styles.toolsBar}>
          {/* Pen Tool */}
          <TouchableOpacity
            onPress={() => setIsEraser(false)}
            style={[styles.toolButton, !isEraser && styles.toolButtonActive]}
          >
            <Feather name="edit-2" size={24} color={!isEraser ? '#007AFF' : '#8E8E93'} />
            <Text style={[styles.toolLabel, !isEraser && styles.toolLabelActive]}>Pen</Text>
          </TouchableOpacity>

          {/* Eraser Tool */}
          <TouchableOpacity
            onPress={handleToggleEraser}
            style={[styles.toolButton, isEraser && styles.toolButtonActive]}
          >
            <Feather name="x-circle" size={24} color={isEraser ? '#FF9500' : '#8E8E93'} />
            <Text style={[styles.toolLabel, isEraser && styles.toolLabelEraser]}>Eraser</Text>
          </TouchableOpacity>

          {/* Brush Size */}
          <TouchableOpacity onPress={handleCycleBrushSize} style={styles.toolButton}>
            <View
              style={[
                styles.brushSizeIndicator,
                { width: brushSize * 2.5, height: brushSize * 2.5 },
              ]}
            />
            <Text style={styles.toolLabel}>{brushSize}px</Text>
          </TouchableOpacity>

          {/* Undo */}
          <TouchableOpacity onPress={handleUndo} style={styles.toolButton}>
            <Feather name="rotate-ccw" size={24} color="#8E8E93" />
            <Text style={styles.toolLabel}>Undo</Text>
          </TouchableOpacity>

          {/* Clear */}
          <TouchableOpacity
            onPress={handleClear}
            style={[styles.toolButton, !hasDrawn && styles.toolButtonDisabled]}
            disabled={!hasDrawn}
          >
            <Feather name="trash-2" size={24} color={hasDrawn ? '#FF3B30' : '#48484A'} />
            <Text style={[styles.toolLabel, hasDrawn && styles.toolLabelDanger]}>Clear</Text>
          </TouchableOpacity>
        </View>

        {/* Hint Text */}
        <Text style={styles.hintText}>
          Draw with your finger • Tap Done to save as image
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#38383A',
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 80,
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelText: {
    fontSize: 17,
    color: '#FF453A',
  },
  doneButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  doneButtonDisabled: {
    backgroundColor: '#48484A',
  },
  doneText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  doneTextDisabled: {
    color: '#8E8E93',
  },
  canvasContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  canvas: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#48484A',
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  colorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorButtonSelected: {
    borderColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  toolsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#38383A',
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    minWidth: 60,
  },
  toolButtonActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.15)',
  },
  toolButtonDisabled: {
    opacity: 0.4,
  },
  toolLabel: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 4,
  },
  toolLabelActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  toolLabelEraser: {
    color: '#FF9500',
    fontWeight: '600',
  },
  toolLabelDanger: {
    color: '#FF3B30',
  },
  brushSizeIndicator: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    minWidth: 8,
    minHeight: 8,
  },
  hintText: {
    fontSize: 13,
    color: '#8E8E93',
    textAlign: 'center',
    paddingBottom: 16,
  },
});
