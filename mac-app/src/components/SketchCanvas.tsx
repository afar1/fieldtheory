/**
 * SketchCanvas - One-shot sketch capture component for Mac.
 * 
 * User clicks FAB → draws with mouse → clicks Done.
 * The sketch is immediately finalized into a PNG image (immutable; no later editing).
 * 
 * Features:
 * - Mouse-first drawing optimized for desktop
 * - Minimal controls: pen, eraser, clear, undo, done, cancel
 * - Exports to PNG at retina-safe resolution
 * - Dark canvas with light stroke for visibility
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Canvas dimensions - responsive to window size
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;

// Preset colors matching iOS implementation
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

// Brush sizes available for cycling
const BRUSH_SIZES = [2, 4, 8, 12];

interface SketchCanvasProps {
  // Called when user clicks Done with the sketch image data
  onComplete: (data: {
    imageData: string; // base64 PNG
    width: number;
    height: number;
  }) => void;
  
  // Called when user cancels without saving
  onCancel: () => void;
  
  // Whether the modal is visible
  visible: boolean;
}

interface Path {
  points: Array<{ x: number; y: number }>;
  color: string;
  size: number;
  isEraser: boolean;
}

export function SketchCanvas({ onComplete, onCancel, visible }: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { theme } = useTheme();
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [brushSizeIndex, setBrushSizeIndex] = useState(1); // Start at 4px
  const [isEraser, setIsEraser] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [paths, setPaths] = useState<Path[]>([]);
  const [currentPath, setCurrentPath] = useState<Path | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const brushSize = BRUSH_SIZES[brushSizeIndex];

  // Initialize canvas on mount
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas for retina displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    ctx.scale(dpr, dpr);

    // Set background
    ctx.fillStyle = '#2C2C2E';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }, []);

  // Redraw canvas when paths change
  useEffect(() => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and redraw background
    ctx.fillStyle = '#2C2C2E';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Redraw all paths
    paths.forEach((path) => {
      if (path.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = path.isEraser ? '#2C2C2E' : path.color;
      ctx.lineWidth = path.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (path.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(path.points[i].x, path.points[i].y);
      }
      ctx.stroke();
    });

    // Draw current path if drawing
    if (currentPath && currentPath.points.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = currentPath.isEraser ? '#2C2C2E' : currentPath.color;
      ctx.lineWidth = currentPath.size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (currentPath.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }

      ctx.moveTo(currentPath.points[0].x, currentPath.points[0].y);
      for (let i = 1; i < currentPath.points.length; i++) {
        ctx.lineTo(currentPath.points[i].x, currentPath.points[i].y);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [paths, currentPath]);

  // Get mouse position relative to canvas
  const getMousePos = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  // Start drawing
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    if (!pos) return;

    setIsDrawing(true);
    setHasDrawn(true);
    setCurrentPath({
      points: [pos],
      color: selectedColor,
      size: brushSize,
      isEraser,
    });
  }, [getMousePos, selectedColor, brushSize, isEraser]);

  // Continue drawing
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentPath) return;
    
    const pos = getMousePos(e);
    if (!pos) return;

    setCurrentPath({
      ...currentPath,
      points: [...currentPath.points, pos],
    });
  }, [isDrawing, currentPath, getMousePos]);

  // Finish drawing
  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentPath) return;

    if (currentPath.points.length > 0) {
      setPaths((prev) => [...prev, currentPath]);
    }
    setCurrentPath(null);
    setIsDrawing(false);
  }, [isDrawing, currentPath]);

  // Handle mouse leave (finish drawing)
  const handleMouseLeave = useCallback(() => {
    handleMouseUp();
  }, [handleMouseUp]);

  // Clear the entire canvas
  const handleClear = useCallback(() => {
    if (!hasDrawn) return;
    
    if (window.confirm('Clear Canvas\n\nAre you sure you want to clear everything?')) {
      setPaths([]);
      setCurrentPath(null);
      setHasDrawn(false);
    }
  }, [hasDrawn]);

  // Undo the last stroke
  const handleUndo = useCallback(() => {
    if (paths.length === 0) return;
    setPaths((prev) => prev.slice(0, -1));
    if (paths.length === 1) {
      setHasDrawn(false);
    }
  }, [paths]);

  // Toggle eraser mode
  const handleToggleEraser = useCallback(() => {
    setIsEraser((prev) => !prev);
  }, []);

  // Handle cancel with confirmation if there's unsaved work
  const handleCancel = useCallback(() => {
    if (hasDrawn) {
      if (!window.confirm('Discard Sketch?\n\nYou have unsaved changes. Are you sure you want to discard?')) {
        return;
      }
    }
    
    // Reset state
    setPaths([]);
    setCurrentPath(null);
    setHasDrawn(false);
    setIsEraser(false);
    setBrushSizeIndex(1);
    setSelectedColor(PRESET_COLORS[0]);
    onCancel();
  }, [hasDrawn, onCancel]);

  // Export the drawing as PNG and call onComplete
  const handleDone = useCallback(async () => {
    if (!hasDrawn) {
      window.alert('Empty Canvas\n\nPlease draw something before saving.');
      return;
    }

    if (isExporting || !canvasRef.current) return;

    try {
      setIsExporting(true);

      // Export canvas as PNG (already at retina resolution)
      const canvas = canvasRef.current;
      const imageData = canvas.toDataURL('image/png');
      
      // Get actual dimensions (accounting for device pixel ratio)
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(CANVAS_WIDTH * dpr);
      const height = Math.round(CANVAS_HEIGHT * dpr);

      onComplete({
        imageData,
        width,
        height,
      });
      
      // Reset state for next sketch
      setPaths([]);
      setCurrentPath(null);
      setHasDrawn(false);
      setIsEraser(false);
      setBrushSizeIndex(1);
      setSelectedColor(PRESET_COLORS[0]);
    } catch (error) {
      console.error('Failed to export sketch:', error);
      window.alert('Export Failed\n\nFailed to save the sketch. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [hasDrawn, isExporting, onComplete]);

  // Select a color from presets
  const handleSelectColor = useCallback((color: string) => {
    setSelectedColor(color);
    setIsEraser(false); // Switch back to pen when selecting color
  }, []);

  // Cycle through brush sizes
  const handleCycleBrushSize = useCallback(() => {
    setBrushSizeIndex((prev) => (prev + 1) % BRUSH_SIZES.length);
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          handleCancel();
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#1C1C1E',
          borderRadius: '12px',
          width: '90%',
          maxWidth: `${CANVAS_WIDTH + 32}px`,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          // @ts-ignore
          WebkitAppRegion: 'no-drag',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Cancel and Done */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #38383A',
          }}
        >
          <button
            onClick={handleCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#FF453A',
              fontSize: '17px',
              cursor: 'pointer',
              padding: '8px 12px',
            }}
          >
            Cancel
          </button>
          
          <div style={{ fontSize: '17px', fontWeight: 600, color: '#FFFFFF' }}>
            New Sketch
          </div>
          
          <button
            onClick={handleDone}
            disabled={!hasDrawn || isExporting}
            style={{
              background: !hasDrawn || isExporting ? '#48484A' : '#007AFF',
              border: 'none',
              borderRadius: '8px',
              color: '#FFFFFF',
              fontSize: '17px',
              fontWeight: 600,
              cursor: !hasDrawn || isExporting ? 'not-allowed' : 'pointer',
              padding: '8px 16px',
              minWidth: '80px',
            }}
          >
            {isExporting ? 'Saving...' : 'Done'}
          </button>
        </div>

        {/* Canvas Area */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            flex: 1,
            overflow: 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{
              backgroundColor: '#2C2C2E',
              borderRadius: '12px',
              border: '1px solid #48484A',
              cursor: isEraser ? 'crosshair' : 'crosshair',
              touchAction: 'none',
            }}
          />
        </div>

        {/* Color Picker Row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '12px 16px',
            gap: '12px',
          }}
        >
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => handleSelectColor(color)}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '16px',
                backgroundColor: color,
                border: selectedColor === color && !isEraser ? '2px solid #007AFF' : '2px solid transparent',
                cursor: 'pointer',
                boxShadow: selectedColor === color && !isEraser ? '0 0 8px rgba(0, 122, 255, 0.5)' : 'none',
              }}
            />
          ))}
        </div>

        {/* Tools Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            padding: '16px',
            borderTop: '1px solid #38383A',
          }}
        >
          {/* Pen Tool */}
          <button
            onClick={() => setIsEraser(false)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: !isEraser ? 'rgba(0, 122, 255, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              minWidth: '60px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={!isEraser ? '#007AFF' : '#8E8E93'} strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span style={{ fontSize: '11px', color: !isEraser ? '#007AFF' : '#8E8E93', marginTop: '4px', fontWeight: !isEraser ? 600 : 400 }}>
              Pen
            </span>
          </button>

          {/* Eraser Tool */}
          <button
            onClick={handleToggleEraser}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: isEraser ? 'rgba(255, 149, 0, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              minWidth: '60px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isEraser ? '#FF9500' : '#8E8E93'} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="8" y1="8" x2="16" y2="16" />
            </svg>
            <span style={{ fontSize: '11px', color: isEraser ? '#FF9500' : '#8E8E93', marginTop: '4px', fontWeight: isEraser ? 600 : 400 }}>
              Eraser
            </span>
          </button>

          {/* Brush Size */}
          <button
            onClick={handleCycleBrushSize}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              minWidth: '60px',
            }}
          >
            <div
              style={{
                width: `${brushSize * 2.5}px`,
                height: `${brushSize * 2.5}px`,
                borderRadius: '50%',
                backgroundColor: '#FFFFFF',
                minWidth: '8px',
                minHeight: '8px',
              }}
            />
            <span style={{ fontSize: '11px', color: '#8E8E93', marginTop: '4px' }}>
              {brushSize}px
            </span>
          </button>

          {/* Undo */}
          <button
            onClick={handleUndo}
            disabled={paths.length === 0}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: paths.length === 0 ? 'not-allowed' : 'pointer',
              opacity: paths.length === 0 ? 0.4 : 1,
              minWidth: '60px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span style={{ fontSize: '11px', color: '#8E8E93', marginTop: '4px' }}>
              Undo
            </span>
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            disabled={!hasDrawn}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: !hasDrawn ? 'not-allowed' : 'pointer',
              opacity: !hasDrawn ? 0.4 : 1,
              minWidth: '60px',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={hasDrawn ? '#FF3B30' : '#48484A'} strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span style={{ fontSize: '11px', color: hasDrawn ? '#FF3B30' : '#48484A', marginTop: '4px' }}>
              Clear
            </span>
          </button>
        </div>

        {/* Hint Text */}
        <div style={{ fontSize: '13px', color: '#8E8E93', textAlign: 'center', paddingBottom: '16px' }}>
          Draw with your mouse • Click Done to save as image
        </div>
      </div>
    </div>
  );
}
