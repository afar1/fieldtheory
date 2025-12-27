import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

interface SketchViewProps {
  onSave: (imageData: { dataUrl: string; width: number; height: number }, andPaste?: boolean) => void;
  onClose: () => void;
  existingSketch?: {
    id: number;
    imageData: string;
    width?: number;
    height?: number;
  } | null;
  backgroundImage?: {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
}

export default function SketchView({ onSave, onClose, existingSketch, backgroundImage }: SketchViewProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastToolRef = useRef<string | null>(null);

  const initialData = useMemo(() => {
    const baseData: any = {
      appState: { viewBackgroundColor: '#ffffff' },
    };
    
    if (!backgroundImage) return baseData;

    const containerWidth = 1200;
    const containerHeight = 800;
    const maxScale = 0.6;
    const maxWidth = containerWidth * maxScale;
    const maxHeight = containerHeight * maxScale;
    
    const scale = Math.min(maxWidth / backgroundImage.width, maxHeight / backgroundImage.height, 1);
    const finalWidth = backgroundImage.width * scale;
    const finalHeight = backgroundImage.height * scale;
    const x = (containerWidth - finalWidth) / 2;
    const y = (containerHeight - finalHeight) / 2;

    const fileId = `bg-${backgroundImage.dataUrl.length}-${backgroundImage.width}x${backgroundImage.height}`;
    const dataUrl = backgroundImage.dataUrl;
    const mime = dataUrl.split(',')[0].match(/:(.*?);/)?.[1] || 'image/png';
    
    return {
      ...baseData,
      elements: [{
        type: 'image',
        id: `img-${fileId}`,
        x,
        y,
        width: finalWidth,
        height: finalHeight,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: null,
        seed: 12345,
        version: 1,
        versionNonce: 12345,
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        fileId: fileId,
        scale: [1, 1],
        status: 'saved',
      }],
      files: {
        [fileId]: {
          id: fileId,
          dataURL: dataUrl,
          mimeType: mime,
          created: Date.now(),
        },
      },
    };
  }, [backgroundImage]);

  const handleSave = useCallback(async (andPaste: boolean = false) => {
    if (!excalidrawAPI || isSaving) return;

    const elements = excalidrawAPI.getSceneElements();
    const activeElements = elements.filter((el: any) => !el.isDeleted);
    
    // Require at least one element (drawing or image).
    if (activeElements.length === 0) {
      alert('Please draw something before saving.');
      return;
    }
    
    // If only a background image exists with no drawings, warn user.
    if (backgroundImage && activeElements.length === 1 && activeElements[0].type === 'image') {
      alert('Please draw something on the image before saving.');
      return;
    }

    setIsSaving(true);

    try {
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

      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const appState = excalidrawAPI.getAppState();
        onSave({
          dataUrl,
          width: Math.round(appState.width || 800),
          height: Math.round(appState.height || 600),
        }, andPaste);
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

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Discard drawing?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [hasChanges, onClose]);

  const prevElementCountRef = useRef(0);
  const initialElementCountRef = useRef<number | null>(null);
  
  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    const activeElements = elements.filter((el: any) => !el.isDeleted);
    
    // Track initial element count (e.g., 1 if background image, 0 if blank).
    // User has made changes if element count differs from initial.
    if (initialElementCountRef.current === null) {
      initialElementCountRef.current = activeElements.length;
    }
    setHasChanges(activeElements.length !== initialElementCountRef.current);
    
    if (!excalidrawAPI) return;
    
    const currentTool = appState?.activeTool?.type;
    const elementCount = activeElements.length;
    const prevCount = prevElementCountRef.current;
    prevElementCountRef.current = elementCount;
    
    // Track when user selects a drawing tool (not selection/hand).
    if (currentTool && currentTool !== 'selection' && currentTool !== 'hand') {
      lastToolRef.current = currentTool;
    }
    
    // After drawing, Excalidraw switches to selection. Restore the drawing tool.
    const justAddedElement = elementCount > prevCount;
    if (justAddedElement && currentTool === 'selection' && lastToolRef.current) {
      requestAnimationFrame(() => {
        if (excalidrawAPI && lastToolRef.current) {
          excalidrawAPI.setActiveTool({ type: lastToolRef.current });
        }
      });
    }
  }, [excalidrawAPI]);

  useEffect(() => {
    const hideFooterLinks = () => {
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
          const parent = link.parentElement;
          if (parent && (parent.tagName === 'LI' || parent.classList.contains('links') || parent.textContent?.includes('Excalidraw links'))) {
            parent.style.display = 'none';
          }
        }
      });

      const allElements = document.querySelectorAll('.excalidraw *');
      allElements.forEach((el) => {
        const text = el.textContent || '';
        if (text === 'Excalidraw links' || (text.includes('GitHub') && text.includes('Discord') && text.includes('Follow'))) {
          (el as HTMLElement).style.display = 'none';
        }
      });
      
      // Hide Library button and diamond tool.
      const buttons = document.querySelectorAll('.excalidraw button');
      buttons.forEach((btn) => {
        const text = btn.textContent?.trim() || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        if (text === 'Library' || ariaLabel.toLowerCase().includes('diamond')) {
          (btn as HTMLElement).style.display = 'none';
        }
      });
    };

    hideFooterLinks();
    const timer = setTimeout(hideFooterLinks, 500);
    const timer2 = setTimeout(hideFooterLinks, 1000);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleClose]);

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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#fafafa',
        position: 'relative',
        zIndex: 100,
        ...dragStyle,
      }}>
        <button
          onClick={handleClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
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
          <span style={{
            fontSize: '10px',
            backgroundColor: '#e8e8e8',
            padding: '2px 5px',
            borderRadius: '3px',
            fontWeight: 500,
          }}>Esc</span>
          Cancel
        </button>

        <span style={{ fontSize: '13px', fontWeight: 500, color: '#333' }}>
          {existingSketch ? 'Edit' : 'Draw'}
        </span>

        <div style={{ display: 'flex', gap: '8px', ...noDragStyle }}>
          <button
            onClick={() => handleSave(false)}
            disabled={isSaving || !hasChanges}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              backgroundColor: 'transparent',
              border: `1px solid ${hasChanges ? '#999' : '#ccc'}`,
              borderRadius: '6px',
              cursor: hasChanges ? 'pointer' : 'default',
              color: hasChanges ? '#666' : '#aaa',
              fontWeight: 500,
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => handleSave(true)}
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
            }}
          >
            Save & Paste
          </button>
        </div>
      </div>

      <div 
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          minHeight: 0,
          width: '100%',
          height: '100%',
          ...noDragStyle,
        }}>
        <style>{`
          .excalidraw .App-menu__footer,
          .excalidraw .App-menu__footer a,
          [data-testid="excalidraw-footer"],
          .excalidraw-footer,
          .excalidraw footer,
          .excalidraw [class*="footer"],
          .excalidraw [class*="Footer"],
          .excalidraw a[href*="github"],
          .excalidraw a[href*="discord"],
          .excalidraw a[href*="twitter"],
          .excalidraw a[href*="x.com"],
          .excalidraw .App-menu a,
          .excalidraw .menu-container a,
          .excalidraw [class*="links"],
          .excalidraw [class*="Links"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
          }
          .excalidraw .library-menu,
          .excalidraw .library-menu__header,
          .excalidraw .library-menu__items,
          [data-testid="library-menu"],
          .excalidraw-library-menu,
          .excalidraw [class*="library"],
          .excalidraw [class*="Library"] {
            display: none !important;
          }
          .excalidraw .ToolIcon_type_library,
          .excalidraw button[aria-label*="library" i],
          .excalidraw button[aria-label*="shapes" i],
          .excalidraw .library-button,
          .excalidraw [class*="libraryButton"],
          .excalidraw .Island button[aria-label*="Library" i],
          .excalidraw aside,
          .excalidraw .layer-ui__wrapper aside,
          .excalidraw button:has(.ToolIcon_type_library),
          .excalidraw [class*="library-unit"],
          .excalidraw .library-unit,
          .excalidraw .App-toolbar button[title*="Library" i],
          .excalidraw button[title*="Library" i],
          .excalidraw button[aria-label*="diamond" i],
          .excalidraw button[title*="diamond" i],
          .excalidraw .ToolIcon_type_diamond {
            display: none !important;
          }
          /* Hide hamburger button, show menu content always */
          .excalidraw .dropdown-menu-button,
          .excalidraw button[aria-label="Menu"],
          .excalidraw [class*="menu-button"] {
            display: none !important;
          }
          .excalidraw .dropdown-menu-container {
            display: block !important;
            position: static !important;
            opacity: 1 !important;
            visibility: visible !important;
          }
          /* Hide help dialog and shortcut hints */
          .excalidraw .HelpDialog,
          .excalidraw [class*="HelpDialog"],
          .excalidraw [class*="help-dialog"],
          .excalidraw [class*="ShortcutsDialog"],
          .excalidraw [class*="shortcuts"],
          .excalidraw .help-icon,
          .excalidraw button[aria-label*="Help" i],
          .excalidraw button[aria-label*="Keyboard" i] {
            display: none !important;
          }
        `}</style>
        <Excalidraw
          key={backgroundImage ? `with-image-${backgroundImage.dataUrl.length}` : 'no-image'}
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
            welcomeScreen: false,
            tools: { image: true },
          }}
          initialData={initialData}
        />
      </div>

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
        <span style={{ margin: '0 4px', color: '#bbb' }}>|</span>
        <span><kbd style={kbdStyle}>V</kbd> Select</span>
        <span><kbd style={kbdStyle}>R</kbd> Rect</span>
        <span><kbd style={kbdStyle}>O</kbd> Ellipse</span>
        <span><kbd style={kbdStyle}>A</kbd> Arrow</span>
        <span><kbd style={kbdStyle}>L</kbd> Line</span>
        <span><kbd style={kbdStyle}>P</kbd> Pencil</span>
        <span><kbd style={kbdStyle}>T</kbd> Text</span>
        <span><kbd style={kbdStyle}>E</kbd> Eraser</span>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 5px',
  fontSize: '10px',
  fontWeight: 500,
  color: '#555',
  backgroundColor: '#e8e8e8',
  borderRadius: '3px',
  marginRight: '4px',
};
