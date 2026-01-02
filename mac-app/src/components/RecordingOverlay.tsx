// =============================================================================
// RecordingOverlay - Shows recording state indicator
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type OverlayState = 'recording' | 'transcribing' | 'dismiss' | 'confirmation' | 'status';
type OverlayStyle = 'rectangle' | 'top-emerging';

// Track which pipe indices have been animated (for fade-in effect).
interface PipeState {
  count: number;
  animatedIndices: Set<number>;
}

export default function RecordingOverlay() {
  const [state, setState] = useState<OverlayState>('recording');
  const [style, setStyle] = useState<OverlayStyle>('rectangle');
  const [pipeState, setPipeState] = useState<PipeState>({ count: 0, animatedIndices: new Set() });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const prevCountRef = useRef<number>(0);

  // IPC listeners for overlay state, style, and status messages
  useEffect(() => {
    if (!window.overlayAPI) return;
    window.overlayAPI.onStateChange(setState);
    if (window.overlayAPI.onStyleChange) {
      window.overlayAPI.onStyleChange(setStyle);
    }
    if (window.overlayAPI.onStatusMessage) {
      window.overlayAPI.onStatusMessage(setStatusMessage);
    }
    return () => {
      window.overlayAPI?.removeAllListeners('overlay-state');
      window.overlayAPI?.removeAllListeners('overlay-style');
      window.overlayAPI?.removeAllListeners('overlay-status-message');
    };
  }, []);

  // Stack count listener (shows how many screenshots have been captured during recording)
  // When count increases, mark the new indices as needing animation.
  useEffect(() => {
    if (!window.transcribeAPI) return;
    
    window.transcribeAPI.getStackCount().then(count => {
      const c = count || 0;
      setPipeState({ count: c, animatedIndices: new Set(Array.from({ length: c }, (_, i) => i)) });
      prevCountRef.current = c;
    });
    
    const unsubscribe = window.transcribeAPI.onStackChanged?.((count: number) => {
      setPipeState(prev => {
        // For new pipes, start them as not-yet-animated (will trigger fade-in).
        const newAnimated = new Set(prev.animatedIndices);
        // When count increases, new pipes need to animate in.
        // When count decreases (new recording), reset all.
        if (count < prev.count) {
          // Reset - new recording started.
          return { count, animatedIndices: new Set() };
        }
        // Add new indices to animated set after a brief delay (for fade-in).
        for (let i = prev.count; i < count; i++) {
          setTimeout(() => {
            setPipeState(p => ({
              ...p,
              animatedIndices: new Set([...p.animatedIndices, i]),
            }));
          }, 50); // Small delay so CSS transition can see the change.
        }
        return { count, animatedIndices: newAnimated };
      });
      prevCountRef.current = count;
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
  
  // Handle status state - show brief message that fades away.
  if (state === 'status') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 16px',
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: '20px',
        backdropFilter: 'blur(20px)',
        animation: 'fadeInOut 1.5s ease-in-out',
      }}>
        <style>{`
          @keyframes fadeInOut {
            0% { opacity: 0; }
            15% { opacity: 1; }
            85% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
        <span style={{
          fontSize: '12px',
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.9)',
        }}>
          {statusMessage}
        </span>
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
          {/* Stack pipe indicator - shows screenshots captured during recording */}
          {pipeState.count > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              marginLeft: '4px',
            }}>
              {/* Render up to 3 pipes, each with fade-in animation */}
              {Array.from({ length: Math.min(pipeState.count, 3) }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: '2px',
                    height: isTopEmerging ? '12px' : '10px',
                    backgroundColor: isTopEmerging ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.4)',
                    borderRadius: '1px',
                    opacity: pipeState.animatedIndices.has(i) ? 1 : 0,
                    transition: 'opacity 0.2s ease-in',
                  }}
                />
              ))}
              {/* Show +N for overflow beyond 3 screenshots */}
              {pipeState.count > 3 && (
                <span style={{
                  fontSize: isTopEmerging ? '9px' : '8px',
                  color: isTopEmerging ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.4)',
                  marginLeft: '2px',
                  opacity: pipeState.animatedIndices.has(3) ? 1 : 0,
                  transition: 'opacity 0.2s ease-in',
                }}>
                  +{pipeState.count - 3}
                </span>
              )}
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
      onStatusMessage?: (cb: (message: string) => void) => void;
      confirmAbandon?: () => void;
      cancelAbandon?: () => void;
      removeAllListeners: (c: string) => void;
    };
  }
}
