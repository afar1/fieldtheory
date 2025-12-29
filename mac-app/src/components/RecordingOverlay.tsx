// =============================================================================
// RecordingOverlay - Shows recording state indicator
// =============================================================================

import { useEffect, useState } from 'react';

type OverlayState = 'recording' | 'transcribing' | 'dismiss' | 'confirmation';
type OverlayStyle = 'rectangle' | 'top-emerging';

export default function RecordingOverlay() {
  const [state, setState] = useState<OverlayState>('recording');
  const [style, setStyle] = useState<OverlayStyle>('rectangle');
  const [stackCount, setStackCount] = useState<number>(0);

  // IPC listeners for overlay state and style
  useEffect(() => {
    if (!window.overlayAPI) return;
    window.overlayAPI.onStateChange(setState);
    if (window.overlayAPI.onStyleChange) {
      window.overlayAPI.onStyleChange(setStyle);
    }
    return () => {
      window.overlayAPI?.removeAllListeners('overlay-state');
      window.overlayAPI?.removeAllListeners('overlay-style');
    };
  }, []);

  // Stack count listener (shows how many screenshots have been captured during recording)
  useEffect(() => {
    if (!window.transcribeAPI) return;
    
    window.transcribeAPI.getStackCount().then(count => {
      setStackCount(count || 0);
    });
    
    const unsubscribe = window.transcribeAPI.onStackChanged?.((count: number) => {
      setStackCount(count);
    });
    
    return () => {
      unsubscribe?.();
    };
  }, []);
  
  // Handle keyboard events for confirmation dialog.
  // Escape triggers abandon, any other key continues recording.
  useEffect(() => {
    if (state !== 'confirmation') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.overlayAPI?.confirmAbandon?.();
      } else {
        e.preventDefault();
        window.overlayAPI?.cancelAbandon?.();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);
  
  // Handle confirmation state - show abandon confirmation UI.
  if (state === 'confirmation') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '20px 24px',
        background: 'rgba(0, 0, 0, 0.9)',
        borderRadius: '16px',
        backdropFilter: 'blur(20px)',
      }}>
        {/* Warning message */}
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#fff',
          textAlign: 'center',
        }}>
          Abandon recording?
        </div>
        
        {/* Action buttons */}
        <div style={{
          display: 'flex',
          gap: '10px',
        }}>
          <button
            onClick={() => window.overlayAPI?.confirmAbandon?.()}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#fff',
              backgroundColor: '#ff3b30',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            Abandon
          </button>
          <button
            onClick={() => window.overlayAPI?.cancelAbandon?.()}
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#fff',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            Keep Recording
          </button>
        </div>
        
        {/* Hint */}
        <div style={{
          fontSize: '10px',
          color: 'rgba(255, 255, 255, 0.6)',
          marginTop: '4px',
        }}>
          Esc = abandon, any other key = keep recording
        </div>
      </div>
    );
  }

  const isTopEmerging = style === 'top-emerging';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: isTopEmerging ? '8px' : '6px',
      padding: isTopEmerging ? '8px 16px' : '0',
      background: isTopEmerging ? 'rgba(0, 0, 0, 0.85)' : 'transparent',
      borderRadius: isTopEmerging ? '20px' : '0',
      backdropFilter: isTopEmerging ? 'blur(20px)' : 'none',
      borderTopLeftRadius: isTopEmerging ? '20px' : '0',
      borderTopRightRadius: isTopEmerging ? '20px' : '0',
      boxShadow: isTopEmerging ? '0 4px 12px rgba(0, 0, 0, 0.3)' : 'none',
    }}>
      {/* Recording indicator - red dot when actively recording */}
      {state === 'recording' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: isTopEmerging ? '6px' : '4px',
        }}>
          <div style={{
            width: isTopEmerging ? 12 : 10,
            height: isTopEmerging ? 12 : 10,
            borderRadius: '50%',
            background: '#ff3b30',
            boxShadow: isTopEmerging ? '0 0 12px rgba(255, 59, 48, 0.6)' : '0 0 8px #ff3b30',
          }} />
          {/* Stack count indicator - shows screenshots captured during recording */}
          {stackCount > 0 && (
            <div style={{
              minWidth: isTopEmerging ? '18px' : '16px',
              height: isTopEmerging ? '18px' : '16px',
              padding: '0 4px',
              borderRadius: isTopEmerging ? '9px' : '8px',
              background: isTopEmerging ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isTopEmerging ? '10px' : '9px',
              fontWeight: 600,
              color: isTopEmerging ? '#fff' : '#333',
            }}>
              {stackCount}
            </div>
          )}
        </div>
      )}

      {/* Transcribing indicator - purple dot when processing */}
      {state === 'transcribing' && (
        <div style={{
          width: isTopEmerging ? 12 : 10,
          height: isTopEmerging ? 12 : 10,
          borderRadius: '50%',
          background: '#af52de',
          boxShadow: isTopEmerging ? '0 0 12px rgba(175, 82, 222, 0.6)' : '0 0 8px #af52de',
        }} />
      )}
    </div>
  );
}

declare global {
  interface Window {
    overlayAPI?: {
      onStateChange: (cb: (s: OverlayState) => void) => void;
      onStyleChange?: (cb: (s: OverlayStyle) => void) => void;
      confirmAbandon?: () => void;
      cancelAbandon?: () => void;
      removeAllListeners: (c: string) => void;
    };
  }
}
