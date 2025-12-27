/**
 * SketchView - Full-featured Excalidraw-based sketch canvas for Mac app.
 * 
 * Features:
 * - Full Excalidraw functionality (draw, shapes, text, eraser, etc.)
 * - Box/rectangle drawing
 * - Arrows and connectors
 * - Text tool
 * - Hand-drawn aesthetic
 * - Saves to clipboard as image when done
 * - MIT License - fully permissive for commercial use
 */

import { useState, useCallback, useEffect } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types';

// Props for the SketchView component.
interface SketchViewProps {
  // Called when user saves the sketch - receives image data.
  onSave: (imageData: { dataUrl: string; width: number; height: number }) => void;
  // Called when user cancels/closes the sketch view.
  onClose: () => void;
  // Optional existing sketch data to load for editing.
  existingSketch?: {
    id: number;
    imageData: string;
    width?: number;
    height?: number;
  } | null;
}

export default function SketchView({ onSave, onClose, existingSketch }: SketchViewProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Export the canvas as an image and save.
  const handleSave = useCallback(async () => {
    if (!excalidrawAPI || isSaving) return;

    const elements = excalidrawAPI.getSceneElements();
    
    // Filter out deleted elements.
    const activeElements = elements.filter(el => !el.isDeleted);
    
    if (activeElements.length === 0) {
      alert('Please draw something before saving.');
      return;
    }

    setIsSaving(true);

    try {
      // Export as PNG blob.
      const blob = await exportToBlob({
        elements: activeElements,
        appState: {
          ...excalidrawAPI.getAppState(),
          exportWithDarkMode: false,
          exportBackground: true,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: 'image/png',
        quality: 1,
      });

      // Convert blob to data URL.
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        
        // Get dimensions from the blob (estimate based on elements bounds).
        const appState = excalidrawAPI.getAppState();
        const width = appState.width || 800;
        const height = appState.height || 600;

        onSave({
          dataUrl,
          width: Math.round(width),
          height: Math.round(height),
        });
      };
      reader.onerror = () => {
        console.error('Failed to read blob');
        alert('Failed to save sketch. Please try again.');
        setIsSaving(false);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to export sketch:', error);
      alert('Failed to save sketch. Please try again.');
      setIsSaving(false);
    }
  }, [excalidrawAPI, isSaving, onSave]);

  // Handle close with confirmation if there are unsaved changes.
  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Discard sketch?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  // Track changes to enable/disable save button.
  const handleChange = useCallback(() => {
    if (excalidrawAPI) {
      const elements = excalidrawAPI.getSceneElements();
      const activeElements = elements.filter(el => !el.isDeleted);
      setHasChanges(activeElements.length > 0);
    }
  }, [excalidrawAPI]);

  // Keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S to save.
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Escape to close.
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleClose]);

  // CSS type extension for webkit properties.
  const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#fff',
    }}>
      {/* Header bar with save/cancel */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#fafafa',
        ...dragStyle,
      }}>
        <button
          onClick={handleClose}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            backgroundColor: 'transparent',
            border: '1px solid #ccc',
            borderRadius: '6px',
            cursor: 'pointer',
            color: '#666',
            ...noDragStyle,
          }}
        >
          Cancel
        </button>

        <span style={{
          fontSize: '13px',
          fontWeight: 500,
          color: '#333',
        }}>
          {existingSketch ? 'Edit Sketch' : 'New Sketch'}
        </span>

        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            backgroundColor: hasChanges ? '#007AFF' : '#ccc',
            border: 'none',
            borderRadius: '6px',
            cursor: hasChanges ? 'pointer' : 'default',
            color: '#fff',
            fontWeight: 500,
            ...noDragStyle,
          }}
        >
          {isSaving ? 'Saving...' : 'Save to Clipboard'}
        </button>
      </div>

      {/* Excalidraw canvas - takes all remaining space */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        ...noDragStyle,
      }}>
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleChange}
          theme="light"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true,
              clearCanvas: true,
              export: false,
              loadScene: false,
              saveToActiveFile: false,
              toggleTheme: false,
              saveAsImage: false,
            },
          }}
          initialData={{
            appState: {
              viewBackgroundColor: '#ffffff',
            },
          }}
        />
      </div>

      {/* Keyboard hints at the bottom */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px',
        backgroundColor: '#fafafa',
        borderTop: '1px solid #e0e0e0',
        gap: '16px',
        fontSize: '11px',
        color: '#888',
      }}>
        <span><kbd style={kbdStyle}>⌘S</kbd> Save</span>
        <span><kbd style={kbdStyle}>Esc</kbd> Cancel</span>
        <span><kbd style={kbdStyle}>R</kbd> Rectangle</span>
        <span><kbd style={kbdStyle}>D</kbd> Diamond</span>
        <span><kbd style={kbdStyle}>A</kbd> Arrow</span>
        <span><kbd style={kbdStyle}>T</kbd> Text</span>
        <span><kbd style={kbdStyle}>P</kbd> Pencil</span>
      </div>
    </div>
  );
}

// Style for keyboard hint keys.
const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 5px',
  fontSize: '10px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  backgroundColor: '#fff',
  border: '1px solid #ddd',
  borderRadius: '3px',
  boxShadow: '0 1px 1px rgba(0,0,0,0.1)',
  marginRight: '4px',
};
