import { useState, useCallback, useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { useTheme } from '../contexts/ThemeContext';
import '@excalidraw/excalidraw/index.css';

type TranscriptItem = {
  id: number;
  content: string | null;
  createdAt: number;
};

interface SketchViewProps {
  onSave: (imageData: { dataUrl: string; width: number; height: number }, andCopy?: boolean) => void;
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
  hideHeader?: boolean;
  onHasChangesChange?: (hasChanges: boolean) => void;
  associatedTranscripts?: TranscriptItem[];
  onUnstackTranscript?: (transcriptId: number) => void;
}

export interface SketchViewHandle {
  save: (andCopy?: boolean) => Promise<void>;
}

export const SKETCH_EXPORT_PADDING = 48;

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function getImageDataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = reject;
    image.src = dataUrl;
  });
}

const SketchView = forwardRef<SketchViewHandle, SketchViewProps>(({ onSave, onClose, existingSketch, backgroundImage, hideHeader, onHasChangesChange, associatedTranscripts, onUnstackTranscript }, ref) => {
  const { theme } = useTheme();
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track when user explicitly exits (back, save, save copy) to prevent re-saving pendingSketch
  const isExitingRef = useRef(false);
  
  // Track container dimensions for responsive canvas sizing.
  const [containerSize, setContainerSize] = useState({ width: 1200, height: 800 });
  
  // Update container size on mount and resize.
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width || 1200, height: rect.height || 800 });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);
  
  // Floating transcript panel state.
  const [transcriptPanelExpanded, setTranscriptPanelExpanded] = useState(false);
  const [transcriptPanelVisible, setTranscriptPanelVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialData = useMemo(() => {
    const baseData: any = {
      appState: { viewBackgroundColor: '#ffffff' },
    };

    // Check for pending sketch to restore (from accidental close/blur)
    try {
      const pending = localStorage.getItem('pendingSketch');
      if (pending && !backgroundImage && !existingSketch) {
        const restored = JSON.parse(pending);
        // Only restore if less than 24 hours old
        if (restored.elements?.length > 0 && Date.now() - restored.timestamp < 24 * 60 * 60 * 1000) {
          return {
            elements: restored.elements,
            appState: restored.appState || baseData.appState,
          };
        }
      }
    } catch (e) {
      // Ignore parse errors
    }

    if (!backgroundImage) return baseData;

    // Use actual container dimensions instead of hardcoded values.
    const containerWidth = containerSize.width;
    const containerHeight = containerSize.height;
    const maxScale = 0.5;
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
  }, [backgroundImage, containerSize]);

  const handleSave = useCallback(async (andCopy: boolean = false) => {
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

    isExitingRef.current = true;
    localStorage.removeItem('pendingSketch');

    setIsSaving(true);

    try {
      // Use device pixel ratio for high-res export on Retina displays
      const exportScale = window.devicePixelRatio || 2;

      const blob = await exportToBlob({
        elements: activeElements,
        appState: {
          ...excalidrawAPI.getAppState(),
          exportWithDarkMode: theme.isDark,
          exportBackground: true,
          exportScale,
        },
        files: excalidrawAPI.getFiles(),
        mimeType: 'image/png',
        quality: 1,
        exportPadding: SKETCH_EXPORT_PADDING,
      });

      try {
        const dataUrl = await readBlobAsDataUrl(blob);
        const dimensions = await getImageDataUrlDimensions(dataUrl);
        // pendingSketch already cleared synchronously at start of handleSave
        onSave({
          dataUrl,
          width: dimensions.width,
          height: dimensions.height,
        }, andCopy);
      } catch (error) {
        console.error('Failed to read exported sketch:', error);
        alert('Failed to save sketch. Please try again.');
        setIsSaving(false);
      }
    } catch (error) {
      console.error('Failed to export sketch:', error);
      alert('Failed to save sketch. Please try again.');
      setIsSaving(false);
    }
  }, [excalidrawAPI, isSaving, onSave, backgroundImage, theme.isDark]);

  useImperativeHandle(ref, () => ({
    save: handleSave,
  }), [handleSave]);

  const handleClose = useCallback(() => {
    if (hasChanges) {
      if (confirm('You have unsaved changes. Discard drawing?')) {
        isExitingRef.current = true;
        localStorage.removeItem('pendingSketch');
        onClose();
      }
    } else {
      isExitingRef.current = true;
      localStorage.removeItem('pendingSketch');
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
    const newHasChanges = activeElements.length !== initialElementCountRef.current;
    setHasChanges(newHasChanges);
    onHasChangesChange?.(newHasChanges);

    // Persist sketch to localStorage for recovery if window closes unexpectedly
    if (newHasChanges && activeElements.length > 0 && !isExitingRef.current) {
      try {
        localStorage.setItem('pendingSketch', JSON.stringify({
          elements: activeElements,
          appState: { viewBackgroundColor: appState?.viewBackgroundColor },
          timestamp: Date.now(),
        }));
      } catch (e) {
        // Ignore storage errors
      }
    }

    if (!excalidrawAPI) return;
    
    const currentTool = appState?.activeTool?.type;
    const elementCount = activeElements.length;
    const prevCount = prevElementCountRef.current;
    prevElementCountRef.current = elementCount;
    
    // When user selects a drawing tool, lock it so it stays active after drawing.
    // Excalidraw's locked: true prevents auto-switch to selection after each stroke.
    if (currentTool && currentTool !== 'selection' && currentTool !== 'hand') {
      const currentAppState = excalidrawAPI.getAppState();
      if (!currentAppState?.activeTool?.locked) {
        excalidrawAPI.setActiveTool({ type: currentTool, locked: true });
      }
    }
  }, [excalidrawAPI, onHasChangesChange]);

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
        const title = btn.getAttribute('title') || '';
        if (
          text === 'Library' || 
          text.includes('Library') ||
          ariaLabel.toLowerCase().includes('library') ||
          title.toLowerCase().includes('library') ||
          ariaLabel.toLowerCase().includes('diamond') ||
          title.toLowerCase().includes('diamond')
        ) {
          (btn as HTMLElement).style.display = 'none';
        }
      });
      
      // Also hide any aside elements (Library sidebar).
      const asides = document.querySelectorAll('.excalidraw aside');
      asides.forEach((aside) => {
        (aside as HTMLElement).style.display = 'none';
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

  // When hideHeader is true, we're embedded in ClipboardHistory's flex layout.
  // Use relative positioning to fill the flex container instead of absolute overlay.
  const containerStyle: React.CSSProperties = hideHeader
    ? {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
        overflow: 'hidden',
        minHeight: 0,
        marginLeft: '16px',
        marginRight: '16px',
      }
    : {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
      };

  return (
    <div style={containerStyle}>
      {!hideHeader && (
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
              Save
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
              Save & Copy
            </button>
          </div>
        </div>
      )}

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
          .excalidraw [class*="Library"],
          .excalidraw .mobile-misc-tools-container,
          .excalidraw [class*="mobile"],
          .excalidraw .App-toolbar-container button[aria-label*="Library" i],
          .excalidraw .shapes-section button[aria-label*="shapes" i],
          .excalidraw .Island .ToolIcon__library,
          .excalidraw button.ToolIcon_type_button[aria-label*="Library" i] {
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
          .excalidraw button[aria-label*="rhombus" i],
          .excalidraw button[title*="rhombus" i],
          .excalidraw button[data-testid="toolbar-diamond"],
          .excalidraw .ToolIcon_type_diamond,
          .excalidraw .App-toolbar__extra-tools-trigger,
          .excalidraw [class*="diamond"],
          .excalidraw .layer-ui__wrapper__top-right,
          .excalidraw [class*="top-right"],
          .excalidraw .App-menu_top__right {
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
          theme={theme.isDark ? "dark" : "light"}
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

      {/* Floating transcript panel - positioned over the canvas */}
      {associatedTranscripts && associatedTranscripts.length > 0 && (
        <div
          onMouseEnter={() => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = setTimeout(() => setTranscriptPanelVisible(true), 500);
          }}
          onMouseLeave={() => {
            if (hoverTimerRef.current) {
              clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = null;
            }
            if (!transcriptPanelExpanded) setTranscriptPanelVisible(false);
          }}
          style={{
            position: 'absolute',
            top: hideHeader ? 12 : 56,
            right: 28,
            zIndex: 100,
          }}
        >
          {!transcriptPanelExpanded && (
            <button
              onClick={() => setTranscriptPanelExpanded(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '8px',
                backgroundColor: transcriptPanelVisible ? '#fff' : 'rgba(255,255,255,0.9)',
                border: '1px solid #ddd',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                fontSize: 14,
              }}
              title="View attached transcript"
            >
              Aa
            </button>
          )}
          
          {transcriptPanelExpanded && (
            <div
              style={{
                width: 280,
                maxHeight: 200,
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                overflow: 'hidden',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderBottom: '1px solid #eee',
                backgroundColor: '#fafafa',
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#333' }}>
                  Attached Transcript{associatedTranscripts.length > 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => setTranscriptPanelExpanded(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#666',
                    padding: '2px 4px',
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ padding: '8px 10px', maxHeight: 140, overflowY: 'auto' }}>
                {associatedTranscripts.map((t, i) => (
                  <div key={t.id} style={{ marginBottom: i < associatedTranscripts.length - 1 ? 8 : 0 }}>
                    <div style={{
                      fontSize: 11,
                      color: '#444',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {t.content || '(empty)'}
                    </div>
                    {onUnstackTranscript && (
                      <button
                        onClick={() => onUnstackTranscript(t.id)}
                        style={{
                          marginTop: 4,
                          fontSize: 10,
                          color: '#888',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                      >
                        Unstack
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {transcriptPanelVisible && !transcriptPanelExpanded && (
            <div
              style={{
                position: 'absolute',
                top: 36,
                right: 0,
                width: 260,
                maxHeight: 160,
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                padding: '10px 12px',
                overflow: 'hidden',
              }}
              onMouseEnter={() => {
                if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              }}
              onMouseLeave={() => {
                setTranscriptPanelVisible(false);
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: '#666', marginBottom: 6 }}>
                Attached Transcript
              </div>
              <div style={{
                fontSize: 11,
                color: '#444',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                maxHeight: 110,
                overflowY: 'auto',
              }}>
                {associatedTranscripts[0]?.content || '(empty)'}
              </div>
              {associatedTranscripts.length > 1 && (
                <div style={{ fontSize: 10, color: '#888', marginTop: 6 }}>
                  +{associatedTranscripts.length - 1} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px',
        backgroundColor: theme.isDark ? theme.bgSecondary : '#fafafa',
        borderTop: `1px solid ${theme.isDark ? theme.border : '#e0e0e0'}`,
        gap: '12px',
        fontSize: '10px',
        color: theme.isDark ? theme.textSecondary : '#888',
        flexWrap: 'wrap',
      }}>
        <span>save <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>⌘s</kbd></span>
        <span>cancel <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>esc</kbd></span>
        <span style={{ margin: '0 4px', color: theme.isDark ? theme.border : '#bbb' }}>|</span>
        <span>select <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>v</kbd></span>
        <span>rect <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>r</kbd></span>
        <span>ellipse <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>o</kbd></span>
        <span>arrow <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>a</kbd></span>
        <span>line <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>l</kbd></span>
        <span>pencil <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>p</kbd></span>
        <span>text <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>t</kbd></span>
        <span>eraser <kbd style={{
          display: 'inline-block',
          padding: '2px 5px',
          fontSize: '10px',
          fontWeight: 500,
          color: theme.isDark ? theme.text : '#555',
          backgroundColor: theme.isDark ? theme.surface2 : '#e8e8e8',
          borderRadius: '3px',
          marginLeft: '4px',
        }}>e</kbd></span>
      </div>
    </div>
  );
});

SketchView.displayName = 'SketchView';

export default SketchView;
