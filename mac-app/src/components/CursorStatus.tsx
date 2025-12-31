// =============================================================================
// CursorStatus - Cursor-following status indicator
// Shows a colored dot that follows cursor, with text label when cursor is idle.
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type StatusState = 'idle' | 'recording' | 'transcribing' | 'done' | 'confirmation' | 'paste-failed';

// Colors for each state
const STATE_COLORS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: '#ff3b30',      // Red
  transcribing: '#af52de',   // Purple
  done: '#34c759',           // Green
  confirmation: '#ff3b30',   // Red (still recording)
  'paste-failed': '#ff9500', // Orange
};

// Glow colors (slightly transparent for the shadow effect)
const STATE_GLOWS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: 'rgba(255, 59, 48, 0.5)',
  transcribing: 'rgba(175, 82, 222, 0.5)',
  done: 'rgba(52, 199, 89, 0.5)',
  confirmation: 'rgba(255, 59, 48, 0.5)',
  'paste-failed': 'rgba(255, 149, 0, 0.5)',
};

// Confirmation countdown duration
const CONFIRMATION_COUNTDOWN_SECONDS = 7;

export default function CursorStatus() {
  const [state, setState] = useState<StatusState>('idle');
  const [isIdle, setIsIdle] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const [textVisible, setTextVisible] = useState(false);
  const [showRecordingText, setShowRecordingText] = useState(false);
  
  // Confirmation countdown state
  const [countdownSeconds, setCountdownSeconds] = useState(CONFIRMATION_COUNTDOWN_SECONDS);
  
  // Paste-failed state: shows transcription text briefly, then "Saved to Field Theory"
  const [pasteFailedText, setPasteFailedText] = useState<string>('');
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  
  // Done state: shows transcription text briefly before fading
  const [doneTranscription, setDoneTranscription] = useState<string>('');
  
  // Refs for animation intervals
  const dotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTextTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pasteFailedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for state changes from main process
  useEffect(() => {
    if (!window.cursorStatusAPI) return;
    
    window.cursorStatusAPI.onStateChange((newState) => {
      setState(newState);
      
      // When recording starts, show "Think outloud..." text briefly then fade it out
      if (newState === 'recording') {
        setShowRecordingText(true);
        // Clear any existing timeout
        if (recordingTextTimeoutRef.current) {
          clearTimeout(recordingTextTimeoutRef.current);
        }
        // Fade out text after 2.52s (20% longer than 2.1s), leaving just the pulsing dot
        recordingTextTimeoutRef.current = setTimeout(() => {
          setShowRecordingText(false);
          recordingTextTimeoutRef.current = null;
        }, 2520);
      }
      
      // When confirmation starts, begin countdown
      if (newState === 'confirmation') {
        setCountdownSeconds(CONFIRMATION_COUNTDOWN_SECONDS);
      }
      
      // Reset paste-failed state when leaving it
      if (newState !== 'paste-failed') {
        setPasteFailedText('');
        setShowSavedMessage(false);
      }
    });
    
    window.cursorStatusAPI.onIdleChange((idle) => {
      setIsIdle(idle);
    });
    
    // Listen for data (transcription text for paste-failed or done state)
    window.cursorStatusAPI.onDataChange?.((data) => {
      if (data?.transcription) {
        // For paste-failed: show text then switch to "Saved to Field Theory"
        setPasteFailedText(data.transcription);
        setShowSavedMessage(false);
        if (pasteFailedTimeoutRef.current) {
          clearTimeout(pasteFailedTimeoutRef.current);
        }
        pasteFailedTimeoutRef.current = setTimeout(() => {
          setShowSavedMessage(true);
          pasteFailedTimeoutRef.current = null;
        }, 1500);
        
        // Also store for done state
        setDoneTranscription(data.transcription);
      }
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-state');
      window.cursorStatusAPI?.removeAllListeners('cursor-status-idle');
      window.cursorStatusAPI?.removeAllListeners('cursor-status-data');
      if (recordingTextTimeoutRef.current) {
        clearTimeout(recordingTextTimeoutRef.current);
      }
      if (pasteFailedTimeoutRef.current) {
        clearTimeout(pasteFailedTimeoutRef.current);
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
  
  // Confirmation countdown timer (7 seconds)
  useEffect(() => {
    if (state !== 'confirmation') {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }
    
    countdownIntervalRef.current = setInterval(() => {
      setCountdownSeconds(prev => {
        if (prev <= 1) {
          // Countdown finished - continue recording (cancel confirmation)
          // Don't reshow "Think aloud..." - just keep the pulsing dot
          setShowRecordingText(false);
          window.cursorStatusAPI?.sendConfirmationResponse?.(false);
          return CONFIRMATION_COUNTDOWN_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [state]);
  
  // Keyboard handler for confirmation state
  useEffect(() => {
    if (state !== 'confirmation') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc = abandon recording
        e.preventDefault();
        window.cursorStatusAPI?.sendConfirmationResponse?.(true);
      } else {
        // Any other key = continue recording (dismiss confirmation)
        e.preventDefault();
        window.cursorStatusAPI?.sendConfirmationResponse?.(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  // Don't render anything if idle state
  if (state === 'idle') {
    return null;
  }

  // Get text label based on state
  const getLabel = (): string => {
    if (state === 'recording' && showRecordingText) {
      return 'Think outloud...';
    }
    if (state === 'transcribing') {
      return 'Transcribing' + '.'.repeat(dotCount);
    }
    if (state === 'done') {
      // Show transcription text if available, otherwise just "Pasted"
      return doneTranscription || 'Pasted';
    }
    if (state === 'confirmation') {
      return `Abandon transcript? (${countdownSeconds}) Do nothing to continue recording`;
    }
    if (state === 'paste-failed') {
      if (showSavedMessage) {
        return 'Saved to Field Theory';
      }
      // Truncate long transcriptions
      const maxLen = 30;
      if (pasteFailedText.length > maxLen) {
        return pasteFailedText.slice(0, maxLen) + '...';
      }
      return pasteFailedText || 'Saved to Field Theory';
    }
    return '';
  };

  const color = STATE_COLORS[state];
  const glow = STATE_GLOWS[state];
  const label = getLabel();
  const showLabel = 
    (state === 'recording' && showRecordingText) || 
    (state === 'transcribing' && textVisible) ||
    state === 'done' ||
    state === 'confirmation' ||
    state === 'paste-failed';

  return (
    <div style={styles.container}>
      {/* Colored dot - always visible during active state, pulses for recording/confirmation */}
      <div 
        style={{
          ...styles.dot,
          backgroundColor: color,
          boxShadow: `0 0 6px ${glow}`,
          animation: (state === 'recording' || state === 'confirmation') ? 'pulse 1.8s ease-in-out infinite' : 'none',
        }} 
      />
      
      {/* Text label - fades in/out based on state */}
      {showLabel && label && (
        <div style={{
          ...styles.labelContainer,
          animation: state === 'recording' && showRecordingText 
            ? 'fadeInOut 2.52s ease-out forwards' 
            : state === 'done' 
              ? 'fadeIn 150ms ease-out' 
              : 'fadeIn 150ms ease-out',
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
    width: '7px',
    height: '7px',
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
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxWidth: '280px',
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

// Note: CursorStatusAPI is declared in src/types/window.d.ts
