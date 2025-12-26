/**
 * SketchView - Full-featured TLDraw-based sketch canvas for Mac app.
 * 
 * Features:
 * - Full TLDraw functionality (draw, shapes, text, eraser, etc.)
 * - Box/rectangle drawing (key feature)
 * - Zoom controls (+/- buttons)
 * - White background for clarity
 * - Compact tool layout maximizing drawing space
 * - Saves to clipboard as image when done
 * - Can edit existing sketches
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Tldraw, Editor, useEditor } from '@tldraw/tldraw';
import '@tldraw/tldraw/tldraw.css';

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

// Custom zoom controls component that appears in the corner.
function ZoomControls() {
  const editor = useEditor();
  
  const handleZoomIn = useCallback(() => {
    editor.zoomIn();
  }, [editor]);
  
  const handleZoomOut = useCallback(() => {
    editor.zoomOut();
  }, [editor]);
  
  const handleZoomReset = useCallback(() => {
    editor.resetZoom();
  }, [editor]);
  
  return (
    <div style={{
      position: 'absolute',
      bottom: '12px',
      right: '12px',
      display: 'flex',
      gap: '4px',
      zIndex: 1000,
    }}>
      <button
        onClick={handleZoomOut}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '6px',
          border: '1px solid #e0e0e0',
          backgroundColor: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 'bold',
          color: '#333',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
        title="Zoom Out"
      >
        −
      </button>
      <button
        onClick={handleZoomReset}
        style={{
          height: '32px',
          padding: '0 8px',
          borderRadius: '6px',
          border: '1px solid #e0e0e0',
          backgroundColor: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          color: '#666',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
        title="Reset Zoom"
      >
        100%
      </button>
      <button
        onClick={handleZoomIn}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '6px',
          border: '1px solid #e0e0e0',
          backgroundColor: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          fontWeight: 'bold',
          color: '#333',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}
        title="Zoom In"
      >
        +
      </button>
    </div>
  );
}

export default function SketchView({ onSave, onClose, existingSketch }: SketchViewProps) {
  const editorRef = useRef<Editor | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Handle editor mount.
  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    
    // Set white background for the canvas.
    editor.user.updateUserPreferences({ colorScheme: 'light' });
    
    // Listen for changes to track if user has drawn anything.
    const unsubscribe = editor.store.listen(() => {
      const shapes = editor.getCurrentPageShapes();
      setHasChanges(shapes.length > 0);
    });
    
    // Clean up listener on unmount.
    return () => {
      unsubscribe();
    };
  }, []);
  
  // Convert SVG string to PNG blob using canvas.
  const svgToPng = async (svgString: string, width: number, height: number, scale: number = 2): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      canvas.width = width * scale;
      canvas.height = height * scale;
      
      const img = new Image();
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, 'image/png', 1);
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG'));
      };
      
      img.src = url;
    });
  };

  // Export the canvas as an image and save.
  const handleSave = useCallback(async () => {
    if (!editorRef.current || isSaving) return;
    
    const editor = editorRef.current;
    const shapes = editor.getCurrentPageShapes();
    
    if (shapes.length === 0) {
      alert('Please draw something before saving.');
      return;
    }
    
    setIsSaving(true);
    
    try {
      // Get shape IDs.
      const shapeIds = shapes.map(s => s.id);
      
      // Export using TLDraw's SVG export then convert to image.
      const svg = await editor.getSvgString(shapeIds, {
        scale: 1,
        background: true,
      });
      
      if (!svg) {
        throw new Error('Failed to generate SVG');
      }
      
      // Convert SVG to PNG using canvas.
      const blob = await svgToPng(svg.svg, svg.width, svg.height, 2);
      
      // Convert blob to data URL.
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        
        onSave({
          dataUrl,
          width: Math.round(svg.width * 2),
          height: Math.round(svg.height * 2),
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
  }, [isSaving, onSave]);
  
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
      
      {/* TLDraw canvas - takes all remaining space */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <Tldraw
          onMount={handleMount}
          inferDarkMode={false}
        >
          <ZoomControls />
        </Tldraw>
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
        <span><kbd style={kbdStyle}>D</kbd> Draw</span>
        <span><kbd style={kbdStyle}>A</kbd> Arrow</span>
        <span><kbd style={kbdStyle}>T</kbd> Text</span>
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
