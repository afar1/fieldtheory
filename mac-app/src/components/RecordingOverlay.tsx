// =============================================================================
// RecordingOverlay - Simplified for debugging
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type OverlayState = 'recording' | 'transcribing' | 'dismiss';
type OverlayStyle = 'rectangle' | 'top-emerging';

export default function RecordingOverlay() {
  const [state, setState] = useState<OverlayState>('recording');
  const [style, setStyle] = useState<OverlayStyle>('rectangle');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [stackCount, setStackCount] = useState<number>(0);
  const [bars, setBars] = useState<number[]>([4, 6, 8, 10, 8, 6, 4]);
  const frameRef = useRef<number>();

  // IPC listeners
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

  useEffect(() => {
    if (!window.overlayAPI || state !== 'recording') return;
    window.overlayAPI.onAudioLevel((l) => setAudioLevel(l));
    return () => window.overlayAPI?.removeAllListeners('audio-level');
  }, [state]);

  // Listen for stack count changes
  useEffect(() => {
    if (!window.transcribeAPI) return;
    
    // Get initial stack count
    (async () => {
      try {
        const count = await window.transcribeAPI.getStackCount() || 0;
        setStackCount(count);
      } catch (e) {
        // Ignore if not available
      }
    })();
    
    // Listen for stack changed events
    const unsubscribe = window.transcribeAPI.onStackChanged?.((count: number) => {
      setStackCount(count);
    });
    
    return () => {
      unsubscribe?.();
    };
  }, []);

  // Animation
  useEffect(() => {
    let t = 0;
    const animate = () => {
      t += 0.1;
      const newBars = state === 'recording'
        ? [4, 6, 8, 10, 8, 6, 4].map((h, i) => 
            Math.max(3, h + Math.sin(t + i) * 4 + audioLevel * 10))
        : state === 'transcribing'
        ? [4, 6, 8, 10, 8, 6, 4].map((h, i) => 
            Math.max(3, h + Math.sin(t * 0.5 + i * 0.5) * 5))
        : [3, 3, 3, 3, 3, 3, 3];
      setBars(newBars);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [state, audioLevel]);

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
      // For top-emerging, make it look like it's emerging from the notch
      borderTop: isTopEmerging ? 'none' : 'none',
    }}>
      {/* Recording indicator */}
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
          {/* Stack count indicator */}
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

      {/* Bars */}
      {bars.map((h, i) => (
        <div key={i} style={{
          width: isTopEmerging ? 5 : 4,
          height: isTopEmerging ? h * 1.2 : h,
          background: isTopEmerging ? 'rgba(255, 255, 255, 0.9)' : 'white',
          borderRadius: isTopEmerging ? 3 : 2,
        }} />
      ))}

      {/* Transcribing indicator */}
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
      onAudioLevel: (cb: (l: number) => void) => void;
      onStyleChange?: (cb: (s: OverlayStyle) => void) => void;
      removeAllListeners: (c: string) => void;
    };
  }
}
