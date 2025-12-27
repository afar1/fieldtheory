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

import { useState, useCallback, useEffect, useRef } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
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
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SketchView.tsx:40',message:'handleSave called',data:{hasAPI:!!excalidrawAPI,isSaving},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (!excalidrawAPI || isSaving) return;

    const elements = excalidrawAPI.getSceneElements();
    
    // Filter out deleted elements.
    const activeElements = elements.filter(el => !el.isDeleted);
    
    if (activeElements.length === 0) {
      alert('Please draw something before saving.');
      return;
    }

    setIsSaving(true);
    
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SketchView.tsx:54',message:'Starting export',data:{activeElementsCount:activeElements.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

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
        
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SketchView.tsx:72',message:'FileReader onloadend fired',data:{dataUrlLength:dataUrl?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        
        // Get dimensions from the blob (estimate based on elements bounds).
        const appState = excalidrawAPI.getAppState();
        const width = appState.width || 800;
        const height = appState.height || 600;

        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SketchView.tsx:80',message:'Calling onSave callback',data:{width,height},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

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

  // Track the last selected tool to prevent auto-switch back to cursor
  const lastToolRef = useRef<string>('selection');

  // Track changes to enable/disable save button and monitor tool changes.
  const handleChange = useCallback(() => {
    if (excalidrawAPI) {
      const elements = excalidrawAPI.getSceneElements();
      const activeElements = elements.filter((el: any) => !el.isDeleted);
      setHasChanges(activeElements.length > 0);

      // Also check tool state on change (fallback if store.listen doesn't work)
      const appState = excalidrawAPI.getAppState();
      const currentTool = appState?.activeTool?.type || 'selection';
      if (currentTool !== 'selection') {
        lastToolRef.current = currentTool;
      } else if (lastToolRef.current !== 'selection') {
        // Tool switched back to selection - restore previous tool
        setTimeout(() => {
          if (excalidrawAPI && excalidrawAPI.getAppState().activeTool.type === 'selection') {
            excalidrawAPI.setActiveTool({ type: lastToolRef.current as any });
          }
        }, 50);
      }
    }
  }, [excalidrawAPI]);

  // Hide Excalidraw footer links by finding and hiding elements with link text
  useEffect(() => {
    const hideFooterLinks = () => {
      // Find all links and check their text content
      const allLinks = document.querySelectorAll('.excalidraw a, .excalidraw [role="link"]');
      allLinks.forEach((link) => {
        const text = link.textContent?.toLowerCase() || '';
        const href = link.getAttribute('href') || '';
        if (
          text.includes('github') ||
          text.includes('discord') ||
          text.includes('follow us') ||
          text.includes('twitter') ||
          href.includes('github') ||
          href.includes('discord') ||
          href.includes('twitter') ||
          href.includes('x.com')
        ) {
          (link as HTMLElement).style.display = 'none';
          // Also hide parent if it's a list item or container
          const parent = link.parentElement;
          if (parent && (parent.tagName === 'LI' || parent.classList.contains('links') || parent.textContent?.includes('Excalidraw links'))) {
            parent.style.display = 'none';
          }
        }
      });

      // Hide "Excalidraw links" heading/text
      const allElements = document.querySelectorAll('.excalidraw *');
      allElements.forEach((el) => {
        const text = el.textContent || '';
        if (text === 'Excalidraw links' || (text.includes('GitHub') && text.includes('Discord') && text.includes('Follow'))) {
          (el as HTMLElement).style.display = 'none';
        }
      });
    };

    // Run immediately and on a delay to catch dynamically rendered elements
    hideFooterLinks();
    const timer = setTimeout(hideFooterLinks, 500);
    const timer2 = setTimeout(hideFooterLinks, 1000);

    // Also watch for DOM changes
    const observer = new MutationObserver(hideFooterLinks);
    const excalidrawContainer = document.querySelector('.excalidraw');
    if (excalidrawContainer) {
      observer.observe(excalidrawContainer, { childList: true, subtree: true });
    }

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      observer.disconnect();
    };
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
          onClick={(e) => {
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/3ea40dd5-7ebe-4b7f-a951-45855cee9c03',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SketchView.tsx:203',message:'Save button clicked',data:{isSaving,hasChanges},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H'})}).catch(()=>{});
            // #endregion
            handleSave();
          }}
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
        minHeight: 0,
        width: '100%',
        height: '100%',
        ...noDragStyle,
      }}>
        {/* Hide Excalidraw footer links and shape library with CSS */}
        <style>{`
          /* Hide footer links - multiple selector strategies */
          .excalidraw .App-menu__footer,
          .excalidraw .App-menu__footer a,
          [data-testid="excalidraw-footer"],
          .excalidraw-footer,
          .excalidraw footer,
          .excalidraw [class*="footer"],
          .excalidraw [class*="Footer"],
          /* Hide links containing GitHub, Discord, Twitter text */
          .excalidraw a[href*="github"],
          .excalidraw a[href*="discord"],
          .excalidraw a[href*="twitter"],
          .excalidraw a[href*="x.com"],
          /* More aggressive - hide any link in menu area */
          .excalidraw .App-menu a,
          .excalidraw .menu-container a,
          /* Hide "Excalidraw links" section */
          .excalidraw [class*="links"],
          .excalidraw [class*="Links"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
          }
          /* Hide shape library sidebar */
          .excalidraw .library-menu,
          .excalidraw .library-menu__header,
          .excalidraw .library-menu__items,
          [data-testid="library-menu"],
          .excalidraw-library-menu,
          .excalidraw [class*="library"],
          .excalidraw [class*="Library"] {
            display: none !important;
          }
          /* Hide shape library button/toggle */
          .excalidraw .ToolIcon_type_library,
          .excalidraw button[aria-label*="library" i],
          .excalidraw button[aria-label*="shapes" i] {
            display: none !important;
          }
        `}</style>
        <Excalidraw
          excalidrawAPI={(api) => {
            setExcalidrawAPI(api);
            // Track tool changes to prevent auto-switch back to selection after drawing
            if (api) {
              // Try using store.listen if available
              if (api.store && typeof api.store.listen === 'function') {
                let isRestoringTool = false;
                const unsubscribe = api.store.listen(() => {
                  if (isRestoringTool) return; // Prevent infinite loop
                  
                  const appState = api.getAppState();
                  const currentTool = appState?.activeTool?.type || 'selection';
                  
                  if (currentTool !== 'selection') {
                    // Remember the tool we're actively using
                    lastToolRef.current = currentTool;
                  } else if (lastToolRef.current !== 'selection' && !isRestoringTool) {
                    // Tool was auto-switched back to selection - restore previous tool
                    isRestoringTool = true;
                    setTimeout(() => {
                      if (api && api.getAppState().activeTool.type === 'selection') {
                        api.setActiveTool({ type: lastToolRef.current as any });
                      }
                      isRestoringTool = false;
                    }, 50);
                  }
                });
              }
            }
          }}
          onChange={handleChange}
          theme="light"
          UIOptions={{
            canvasActions: {
              changeViewBackgroundColor: true, // Keep background color picker
              clearCanvas: true, // Keep clear canvas
              export: false, // Hide export (we handle save)
              loadScene: false, // Hide load scene
              saveToActiveFile: false, // Hide save to file
              toggleTheme: false, // Hide theme toggle
              saveAsImage: false, // Hide save as image
            },
            // Hide Excalidraw branding/links
            welcomeScreen: false,
            footer: false,
            // Hide shape library sidebar
            tools: {
              image: false, // Hide image tool
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
        gap: '12px',
        fontSize: '10px',
        color: '#888',
        flexWrap: 'wrap',
      }}>
        <span><kbd style={kbdStyle}>⌘S</kbd> Save</span>
        <span><kbd style={kbdStyle}>Esc</kbd> Cancel</span>
        <span style={{ marginLeft: '8px' }}>Tools:</span>
        <span><kbd style={kbdStyle}>V</kbd> or <kbd style={kbdStyle}>1</kbd> Select</span>
        <span><kbd style={kbdStyle}>R</kbd> or <kbd style={kbdStyle}>2</kbd> Rectangle</span>
        <span><kbd style={kbdStyle}>D</kbd> or <kbd style={kbdStyle}>3</kbd> Diamond</span>
        <span><kbd style={kbdStyle}>O</kbd> or <kbd style={kbdStyle}>4</kbd> Ellipse</span>
        <span><kbd style={kbdStyle}>A</kbd> or <kbd style={kbdStyle}>5</kbd> Arrow</span>
        <span><kbd style={kbdStyle}>L</kbd> or <kbd style={kbdStyle}>6</kbd> Line</span>
        <span><kbd style={kbdStyle}>P</kbd> or <kbd style={kbdStyle}>7</kbd> Pencil</span>
        <span><kbd style={kbdStyle}>T</kbd> or <kbd style={kbdStyle}>8</kbd> Text</span>
        <span><kbd style={kbdStyle}>E</kbd> or <kbd style={kbdStyle}>0</kbd> Eraser</span>
        <span><kbd style={kbdStyle}>F</kbd> Frame</span>
        <span><kbd style={kbdStyle}>K</kbd> Laser</span>
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
