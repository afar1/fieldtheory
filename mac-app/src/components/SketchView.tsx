import { useState, useCallback, useEffect, useRef, useMemo, useImperativeHandle, forwardRef, lazy, Suspense } from 'react';
import { Draw, type DrawHandle, type Board, type Stroke } from '../vendor/drawesome';
import { DRAWING_DRAFT_KEY, readDrawingDraft, restoreStrokeIds, placeImage, exportDrawing, type DrawingDraft } from '../utils/drawing';
import { useTheme } from '../contexts/ThemeContext';

type TranscriptItem = {
  id: number;
  content: string | null;
  createdAt: number;
};

interface SketchViewProps {
  onSave: (imageData: { dataUrl: string; width: number; height: number }, andCopy?: boolean) => void | boolean | Promise<void | boolean>;
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

export { SKETCH_EXPORT_PADDING } from '../utils/drawing';

const SketchView = forwardRef<SketchViewHandle, SketchViewProps>(({ onSave, onClose, existingSketch, backgroundImage, hideHeader, onHasChangesChange, associatedTranscripts, onUnstackTranscript }, ref) => {
  const { theme } = useTheme();

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const drawRef = useRef<DrawHandle>(null);
  const exiting = useRef(false);
  const pendingDraft = useRef<DrawingDraft | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraft = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (exiting.current || pendingDraft.current === null) return;
    try { localStorage.setItem(DRAWING_DRAFT_KEY, JSON.stringify(pendingDraft.current)); }
    catch { /* The live drawing remains usable if storage is full. */ }
  }, []);
  useEffect(() => {
    window.addEventListener('beforeunload', flushDraft);
    return () => { window.removeEventListener('beforeunload', flushDraft); flushDraft(); };
  }, [flushDraft]);
  const [draft] = useState(() => !backgroundImage && !existingSketch ? readDrawingDraft() : null);
  const initialStrokes = useMemo(() => draft ? restoreStrokeIds(draft.strokes) : undefined, [draft]);
  const [board, setBoard] = useState<Board | null>(draft?.board ?? null);
  const [paper] = useState(() => draft?.paper ?? (theme.isDark ? '#202124' : '#ffffff'));
  const [existingImage, setExistingImage] = useState(() => existingSketch ? {
    dataUrl: existingSketch.imageData.startsWith('data:') ? existingSketch.imageData : `data:image/png;base64,${existingSketch.imageData}`,
    width: existingSketch.width || 1200,
    height: existingSketch.height || 800,
  } : null);
  useEffect(() => {
    if (!existingImage || (existingSketch?.width && existingSketch?.height)) return;
    let active = true;
    const img = new Image();
    img.onload = () => { if (active) setExistingImage(old => old && ({ ...old, width: img.naturalWidth, height: img.naturalHeight })); };
    img.src = existingImage.dataUrl;
    return () => { active = false; };
  }, [existingImage?.dataUrl, existingSketch?.width, existingSketch?.height]);
  const source = backgroundImage ?? existingImage ?? draft?.image ?? null;
  const image = useMemo(() => source && board ? placeImage(source, board) : null, [source, board]);
  const [transcriptPanelExpanded, setTranscriptPanelExpanded] = useState(false);
  const [transcriptPanelVisible, setTranscriptPanelVisible] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.height) setBoard(old => old ?? { w: rect.width, h: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); };
  }, []);
  const handleChange = useCallback((strokes: Stroke[]) => {
    const dirty = strokes.some(stroke => !stroke.erase && stroke.points.length > 0);
    setHasChanges(dirty);
    onHasChangesChange?.(dirty);
    if (!board || exiting.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (dirty) {
      pendingDraft.current = { version: 1, engine: 'drawesome', strokes, board, paper, image: source ?? undefined, timestamp: Date.now() };
      persistTimer.current = setTimeout(flushDraft, 150);
    } else {
      pendingDraft.current = null;
      localStorage.removeItem(DRAWING_DRAFT_KEY);
    }
  }, [board, paper, source, onHasChangesChange, flushDraft]);
  const handleSave = useCallback(async (andCopy = false) => {
    if (!drawRef.current || !board || isSaving) return;
    const strokes = drawRef.current.getStrokes();
    if (!strokes.some(s => !s.erase)) { alert('Please draw something before saving.'); return; }
    flushDraft();
    setIsSaving(true);
    try {
      const result = await exportDrawing(strokes, board, paper, image, window.devicePixelRatio || 2);
      if (await onSave(result, andCopy) === false) return;
      exiting.current = true;
      localStorage.removeItem(DRAWING_DRAFT_KEY);
    } catch (error) {
      console.error('Failed to save drawing:', error);
      alert('Failed to save drawing. Please try again.');
    } finally { setIsSaving(false); }
  }, [board, paper, image, isSaving, onSave, flushDraft]);
  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);
  const handleClose = useCallback(() => {
    if (isSaving) return;
    if (hasChanges && !confirm('You have unsaved changes. Discard drawing?')) return;
    exiting.current = true;
    localStorage.removeItem(DRAWING_DRAFT_KEY);
    onClose();
  }, [hasChanges, isSaving, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void handleSave(); }
      if (event.key === 'Escape') { event.preventDefault(); handleClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        {board && <>
          <svg width="100%" height="100%" viewBox={`0 0 ${board.w} ${board.h}`} style={{ position: 'absolute', inset: 0, background: paper, pointerEvents: 'none' }}>
            {image && <image href={image.dataUrl} x={image.x} y={image.y} width={image.width} height={image.height} />}
          </svg>
          <Draw shapes ref={drawRef} board={board} initialStrokes={initialStrokes} onChange={handleChange}
            shortcuts={!isSaving} style={{ pointerEvents: isSaving ? 'none' : undefined }}
            background="transparent" theme={theme.isDark ? 'dark' : 'light'} look="studio" motion="none" />
        </>}

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
        <span>Rectangle R · Line L · Circle O · Shift: square or angled line · ⌘Z undo · ⇧⌘Z redo</span>
        <span>Saved images reopen as a background.</span>
      </div>
    </div>
  );
});

SketchView.displayName = 'SketchView';

const LegacySketchView = lazy(() => import('./LegacySketchView'));
const DrawingEntry = forwardRef<SketchViewHandle, SketchViewProps>((props, ref) => {
  const [legacy, setLegacy] = useState(false);
  const [hasLegacy] = useState(() => Boolean(localStorage.getItem('pendingSketch')));
  if (legacy) return <Suspense fallback={<div>Recovering previous drawing…</div>}><LegacySketchView {...props} ref={ref} /></Suspense>;
  return <>
    {hasLegacy && !props.backgroundImage && !props.existingSketch && <div style={{ position: 'absolute', top: props.hideHeader ? 8 : 52, left: 20, padding: 8, zIndex: 101, background: '#fff', color: '#333', borderRadius: 6 }}>
      An earlier Excalidraw draft is preserved. <button onClick={() => setLegacy(true)}>Recover previous drawing</button>
    </div>}
    <SketchView {...props} ref={ref} />
  </>;
});
DrawingEntry.displayName = 'DrawingEntry';
export default DrawingEntry;
