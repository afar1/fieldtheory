// =============================================================================
// RecordingOverlay - Simplified for debugging
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type OverlayState = 'recording' | 'transcribing' | 'dismiss';

export default function RecordingOverlay() {
  const [state, setState] = useState<OverlayState>('recording');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [bars, setBars] = useState<number[]>([4, 6, 8, 10, 8, 6, 4]);
  const frameRef = useRef<number>();

  // IPC listeners
  useEffect(() => {
    if (!window.overlayAPI) return;
    window.overlayAPI.onStateChange(setState);
    return () => window.overlayAPI?.removeAllListeners('overlay-state');
  }, []);

  useEffect(() => {
    if (!window.overlayAPI || state !== 'recording') return;
    window.overlayAPI.onAudioLevel((l) => setAudioLevel(l));
    return () => window.overlayAPI?.removeAllListeners('audio-level');
  }, [state]);

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

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
    }}>
      {/* Recording indicator */}
      {state === 'recording' && (
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#ff3b30',
          boxShadow: '0 0 8px #ff3b30',
        }} />
      )}

      {/* Bars */}
      {bars.map((h, i) => (
        <div key={i} style={{
          width: 4,
          height: h,
          background: 'white',
          borderRadius: 2,
        }} />
      ))}

      {/* Transcribing indicator */}
      {state === 'transcribing' && (
        <div style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#af52de',
          boxShadow: '0 0 8px #af52de',
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
      removeAllListeners: (c: string) => void;
    };
  }
}
