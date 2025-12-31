// =============================================================================
// CursorStatus - Cursor-following status indicator
// Shows a colored dot that follows cursor, with text label when cursor is idle.
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type StatusState = 'idle' | 'recording' | 'transcribing' | 'done';

// Colors for each state
const STATE_COLORS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: '#ff3b30',      // Red
  transcribing: '#af52de',   // Purple
  done: '#34c759',           // Green
};

// Glow colors (slightly transparent for the shadow effect)
const STATE_GLOWS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: 'rgba(255, 59, 48, 0.5)',
  transcribing: 'rgba(175, 82, 222, 0.5)',
  done: 'rgba(52, 199, 89, 0.5)',
};

export default function CursorStatus() {
  const [state, setState] = useState<StatusState>('idle');
  const [isIdle, setIsIdle] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const [textVisible, setTextVisible] = useState(false);
  const [showRecordingText, setShowRecordingText] = useState(false);
  
  // Refs for animation intervals
  const dotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recordingTextTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Listen for state changes from main process
  useEffect(() => {
    if (!window.cursorStatusAPI) return;
    
    window.cursorStatusAPI.onStateChange((newState) => {
      setState(newState);
      
      // When recording starts, show "Recording..." text briefly then fade it out
      if (newState === 'recording') {
        setShowRecordingText(true);
        // Clear any existing timeout
        if (recordingTextTimeoutRef.current) {
          clearTimeout(recordingTextTimeoutRef.current);
        }
        // Fade out "Recording..." after 1.5s, leaving just the pulsing dot
        recordingTextTimeoutRef.current = setTimeout(() => {
          setShowRecordingText(false);
          recordingTextTimeoutRef.current = null;
        }, 1500);
      }
    });
    
    window.cursorStatusAPI.onIdleChange((idle) => {
      setIsIdle(idle);
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-state');
      window.cursorStatusAPI?.removeAllListeners('cursor-status-idle');
      if (recordingTextTimeoutRef.current) {
        clearTimeout(recordingTextTimeoutRef.current);
      }
    };
  }, []);

  // Handle text visibility with fade-in when idle (for transcribing only)
  useEffect(() => {
    if (isIdle && state === 'transcribing') {
      setTextVisible(true);
    } else if (state !== 'transcribing') {
      setTextVisible(false);
    } else {
      // Cursor moved during transcribing - hide text immediately
      setTextVisible(false);
    }
  }, [isIdle, state]);

  // Old-school cycling dots animation for transcribing
  useEffect(() => {
    if (state === 'transcribing' && textVisible) {
      dotIntervalRef.current = setInterval(() => {
        setDotCount(prev => (prev % 3) + 1);
      }, 400);
    } else {
      if (dotIntervalRef.current) {
        clearInterval(dotIntervalRef.current);
        dotIntervalRef.current = null;
      }
      setDotCount(1);
    }
    
    return () => {
      if (dotIntervalRef.current) {
        clearInterval(dotIntervalRef.current);
      }
    };
  }, [state, textVisible]);

  // Don't render anything if idle state
  if (state === 'idle') {
    return null;
  }

  // Get text label based on state
  const getLabel = (): string => {
    if (state === 'recording' && showRecordingText) {
      return 'Recording...';
    }
    if (state === 'transcribing') {
      return 'Transcribing' + '.'.repeat(dotCount);
    }
    return '';
  };

  const color = STATE_COLORS[state];
  const glow = STATE_GLOWS[state];
  const label = getLabel();
  const showLabel = (state === 'recording' && showRecordingText) || (state === 'transcribing' && textVisible);

  return (
    <div style={styles.container}>
      {/* Colored dot - always visible during active state, pulses for recording */}
      <div 
        style={{
          ...styles.dot,
          backgroundColor: color,
          boxShadow: `0 0 6px ${glow}`,
          animation: state === 'recording' ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }} 
      />
      
      {/* Text label - fades in/out based on state */}
      {showLabel && label && (
        <div style={{
          ...styles.labelContainer,
          animation: state === 'recording' && showRecordingText ? 'fadeInOut 1.5s ease-out forwards' : 'fadeIn 150ms ease-out',
        }}>
          <span style={styles.label}>{label}</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    height: '100%',
    padding: '0 4px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  labelContainer: {
    backgroundColor: 'rgba(30, 30, 30, 0.85)', // Softer, less aggressive black
    borderRadius: '4px',
    padding: '3px 6px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    whiteSpace: 'nowrap',
  },
};

// Add keyframes for animations
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeInOut {
    0% { opacity: 0; }
    15% { opacity: 1; }
    85% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;
document.head.appendChild(styleSheet);

// Type declaration for the cursor status API
declare global {
  interface Window {
    cursorStatusAPI?: {
      onStateChange: (callback: (state: StatusState) => void) => void;
      onIdleChange: (callback: (isIdle: boolean) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}
