// =============================================================================
// CursorStatus - Cursor-following status indicator
// Shows a colored dot that follows cursor, with text label when cursor is idle.
// =============================================================================

import { useEffect, useState, useRef } from 'react';

type StatusState = 'idle' | 'recording' | 'transcribing' | 'improving' | 'done' | 'confirmation' | 'paste-failed';

// Colors for each state
const STATE_COLORS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: '#ff3b30',      // Red
  transcribing: '#af52de',   // Purple
  improving: '#007aff',      // Blue - distinct from purple/green
  done: '#34c759',           // Green
  confirmation: '#ff3b30',   // Red (still recording)
  'paste-failed': '#ff9500', // Orange
};

// Glow colors (slightly transparent for the shadow effect)
const STATE_GLOWS: Record<StatusState, string> = {
  idle: 'transparent',
  recording: 'rgba(255, 59, 48, 0.5)',
  transcribing: 'rgba(175, 82, 222, 0.5)',
  improving: 'rgba(0, 122, 255, 0.5)',
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
  
  // Done state: for paste failure, shows transcription then "saved" message
  const [doneTranscription, setDoneTranscription] = useState<string>('');
  const [showDoneSavedMessage, setShowDoneSavedMessage] = useState(false);
  const [pasteWasSuccessful, setPasteWasSuccessful] = useState(true);
  
  // Stack count state for pipe indicator (screenshots during recording).
  const [pipeCount, setPipeCount] = useState<number>(0);
  const [animatedPipes, setAnimatedPipes] = useState<Set<number>>(new Set());
  
  // Hide labels setting - show only colored dots without text.
  const [hideLabels, setHideLabels] = useState<boolean>(false);
  
  // Progressive label visibility - these are computed from usage counts.
  // After thresholds are reached, labels auto-hide (unless user re-enables via settings).
  const [showTranscribingLabel, setShowTranscribingLabel] = useState<boolean>(true);
  const [showSayAnythingLabel, setShowSayAnythingLabel] = useState<boolean>(true);
  
  // Screenshot mode - shifts indicator right to avoid overlap with screenshot UI.
  const [screenshotMode, setScreenshotMode] = useState<boolean>(false);
  
  // Tutorial hint - custom text shown during onboarding, overrides default recording text.
  const [tutorialHint, setTutorialHint] = useState<string | null>(null);

  // Recording note - informational message shown to the right of the recording indicator.
  // Used for warnings like "Note: Stacking 10+ images, some input fields may have limits"
  const [recordingNote, setRecordingNote] = useState<string | null>(null);

  // Refs for animation intervals
  const dotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingTextTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pasteFailedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingNoteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for state changes from main process
  useEffect(() => {
    if (!window.cursorStatusAPI) return;
    
    window.cursorStatusAPI.onStateChange((newState) => {
      setState(newState);
      
      // When recording starts, show "Say anything" text briefly then fade it out
      if (newState === 'recording') {
        setShowRecordingText(true);
        // Clear any existing timeout
        if (recordingTextTimeoutRef.current) {
          clearTimeout(recordingTextTimeoutRef.current);
        }
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
        // Store transcription
        setDoneTranscription(data.transcription);
        setPasteFailedText(data.transcription);
        
        // Track if paste was successful (paste-failed means it wasn't)
        const isFailed = data.pasteFailed === true;
        setPasteWasSuccessful(!isFailed);
        
        if (isFailed) {
          // For paste-failed: show text then switch to "Saved to Field Theory"
          setShowSavedMessage(false);
          setShowDoneSavedMessage(false);
          if (pasteFailedTimeoutRef.current) {
            clearTimeout(pasteFailedTimeoutRef.current);
          }
          pasteFailedTimeoutRef.current = setTimeout(() => {
            setShowSavedMessage(true);
            setShowDoneSavedMessage(true);
            pasteFailedTimeoutRef.current = null;
          }, 2000);
        }
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
  
  // Listen for stack count changes (screenshots during recording).
  useEffect(() => {
    if (!window.cursorStatusAPI?.onStackChange) return;
    
    window.cursorStatusAPI.onStackChange((count) => {
      if (count < pipeCount) {
        // Count decreased - reset for new recording.
        setPipeCount(count);
        setAnimatedPipes(new Set());
      } else if (count > pipeCount) {
        // New screenshot - animate in the new pipe.
        setPipeCount(count);
        // Trigger animation after a brief delay so CSS sees the change.
        setTimeout(() => {
          setAnimatedPipes(prev => {
            const next = new Set(prev);
            for (let i = pipeCount; i < count; i++) {
              next.add(i);
            }
            return next;
          });
        }, 50);
      }
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-stack');
    };
  }, [pipeCount]);
  
  // Listen for hide labels setting changes.
  useEffect(() => {
    if (!window.cursorStatusAPI?.onHideLabelsChange) return;
    
    window.cursorStatusAPI.onHideLabelsChange((hide) => {
      setHideLabels(hide);
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-hide-labels');
    };
  }, []);

  // Listen for progressive label visibility updates.
  // These control whether to show labels based on usage count thresholds.
  useEffect(() => {
    if (!window.cursorStatusAPI?.onLabelVisibilityChange) return;
    
    window.cursorStatusAPI.onLabelVisibilityChange((visibility: { showTranscribingLabel: boolean; showSayAnythingLabel: boolean }) => {
      setShowTranscribingLabel(visibility.showTranscribingLabel);
      setShowSayAnythingLabel(visibility.showSayAnythingLabel);
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-label-visibility');
    };
  }, []);
  
  // Listen for screenshot mode changes (shifts indicator right during screenshot).
  useEffect(() => {
    if (!window.cursorStatusAPI?.onScreenshotModeChange) return;
    
    window.cursorStatusAPI.onScreenshotModeChange((active) => {
      setScreenshotMode(active);
    });
    
    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-screenshot-mode');
    };
  }, []);

  // Listen for tutorial hint changes (onboarding prompts shown next to cursor dot).
  useEffect(() => {
    if (!window.cursorStatusAPI?.onTutorialHint) return;

    window.cursorStatusAPI.onTutorialHint((hint: string | null) => {
      setTutorialHint(hint);
    });

    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-tutorial-hint');
    };
  }, []);

  // Listen for recording note changes (informational warnings during recording).
  useEffect(() => {
    if (!window.cursorStatusAPI?.onRecordingNote) return;

    window.cursorStatusAPI.onRecordingNote((note: string | null) => {
      // Clear any existing timeout
      if (recordingNoteTimeoutRef.current) {
        clearTimeout(recordingNoteTimeoutRef.current);
        recordingNoteTimeoutRef.current = null;
      }

      setRecordingNote(note);

      // Auto-dismiss after 3 seconds if note is set
      if (note) {
        recordingNoteTimeoutRef.current = setTimeout(() => {
          setRecordingNote(null);
          recordingNoteTimeoutRef.current = null;
        }, 3000);
      }
    });

    return () => {
      window.cursorStatusAPI?.removeAllListeners('cursor-status-recording-note');
      if (recordingNoteTimeoutRef.current) {
        clearTimeout(recordingNoteTimeoutRef.current);
      }
    };
  }, []);

  // Handle text visibility with fade-in when idle (for transcribing and improving)
  useEffect(() => {
    if (isIdle && (state === 'transcribing' || state === 'improving')) {
      setTextVisible(true);
    } else if (state !== 'transcribing' && state !== 'improving') {
      setTextVisible(false);
    } else {
      // Cursor moved during transcribing/improving - hide text immediately
      setTextVisible(false);
    }
  }, [isIdle, state]);

  // Old-school cycling dots animation for transcribing and improving
  useEffect(() => {
    if ((state === 'transcribing' || state === 'improving') && textVisible) {
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
  
  // Keyboard handler for paste-failed state - Escape to dismiss
  useEffect(() => {
    if (state !== 'paste-failed') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        window.cursorStatusAPI?.dismiss?.();
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
    // Tutorial hints override default recording text (used during onboarding).
    if (state === 'recording' && tutorialHint) {
      return tutorialHint;
    }
    if (state === 'recording' && showRecordingText) {
      return 'Say anything';
    }
    if (state === 'transcribing') {
      return 'transcribing' + '.'.repeat(dotCount);
    }
    if (state === 'improving') {
      return 'improving' + '.'.repeat(dotCount);
    }
    if (state === 'done') {
      // No text label on done state - just green dot then paste.
      return '';
    }
    if (state === 'confirmation') {
      return `ESC to cancel recording. Ignore to continue (${countdownSeconds}).`;
    }
    if (state === 'paste-failed') {
      // Use custom message if provided, otherwise show default.
      return pasteFailedText || 'Transcript saved to Field Theory';
    }
    return '';
  };

  const color = STATE_COLORS[state];
  const glow = STATE_GLOWS[state];
  const label = getLabel();
  
  // Label visibility logic:
  // 1. Always show: paste-failed, confirmation, and tutorial hints (critical feedback)
  // 2. If user has explicitly hidden labels (hideLabels setting), don't show normal labels
  // 3. Otherwise, check progressive visibility thresholds:
  //    - "Say anything" shows for first 2 recordings, then hides
  //    - "Transcribing..." shows for first 3 transcriptions, then hides
  // After thresholds, only the colored dots remain (stacks are the core mechanic).
  const showLabel = state === 'paste-failed' || state === 'confirmation' || 
    (state === 'recording' && tutorialHint) ||  // Always show tutorial hints
    (!hideLabels && (
      // "Say anything" during recording - respects progressive threshold
      (state === 'recording' && showRecordingText && showSayAnythingLabel) || 
      // "Transcribing..." - respects progressive threshold
      (state === 'transcribing' && textVisible && showTranscribingLabel) ||
      // "improving..." - always show when improving (it's a new feature)
      (state === 'improving' && textVisible)
    ));

  // Handle click to dismiss (for paste-failed/done states)
  const handleClick = () => {
    if (state === 'paste-failed' || state === 'done') {
      window.cursorStatusAPI?.dismiss?.();
    }
  };

  return (
    <div 
      style={{
        ...styles.container,
        cursor: (state === 'paste-failed' || state === 'done') ? 'pointer' : 'default',
      }}
      onClick={handleClick}
    >
      {/* Colored dot - always visible during active state, pulses for recording/confirmation, fades for done */}
      <div 
        style={{
          ...styles.dot,
          marginLeft: screenshotMode ? '16px' : '3px', // Shift right during screenshot to avoid overlap
          transition: 'margin-left 0.15s ease-out', // Smooth animation for screenshot mode
          backgroundColor: color,
          border: '1px solid rgba(0, 0, 0, 0.4)',
          boxShadow: `0 0 6px ${glow}`,
          animation: (state === 'recording' || state === 'confirmation') 
            ? 'pulse 1.8s ease-in-out infinite' 
            : state === 'done' 
              ? 'fadeOutDot 0.8s ease-out forwards'
              : 'none',
        }} 
      />
      
      {/* Pipe indicator - shows screenshots captured during recording */}
      {state === 'recording' && pipeCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          marginTop: '3px',
        }}>
          {/* Render up to 3 pipes, each with fade-in animation */}
          {Array.from({ length: Math.min(pipeCount, 3) }, (_, i) => (
            <div
              key={i}
              style={{
                width: '2px',
                height: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid rgba(0, 0, 0, 0.4)',
                opacity: animatedPipes.has(i) ? 1 : 0,
                transition: 'opacity 0.2s ease-in',
              }}
            />
          ))}
          {/* Show +N for overflow beyond 3 screenshots */}
          {pipeCount > 3 && (
            <span style={{
              fontSize: '8px',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.9)',
              WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.5)',
              marginLeft: '2px',
              opacity: animatedPipes.has(3) ? 1 : 0,
              transition: 'opacity 0.2s ease-in',
            }}>
              +{pipeCount - 3}
            </span>
          )}
        </div>
      )}

      {/* Recording note - informational warning shown to the right during recording */}
      {state === 'recording' && recordingNote && (
        <div style={{
          ...styles.labelContainer,
          animation: 'fadeIn 150ms ease-out',
          marginLeft: pipeCount > 0 ? '4px' : '0px',
        }}>
          <span style={styles.label}>{recordingNote}</span>
        </div>
      )}

      {/* Text label - fades in/out based on state */}
      {showLabel && label && (
        <div style={{
          ...styles.labelContainer,
          animation: state === 'recording' && showRecordingText 
            ? 'fadeInOut 2.52s ease-out forwards' 
            : state === 'done'
              ? 'fadeOutLabel 0.8s ease-out forwards'
              : state === 'paste-failed'
                ? 'fadeOutPasteFailed 3s ease-out forwards'
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
    alignItems: 'flex-start',
    gap: '5px',
    padding: '0px 4px 4px 4px',
    boxSizing: 'border-box',
  },
  dot: {
    width: '7px',
    height: '7px',
    minWidth: '7px',
    minHeight: '7px',
    maxWidth: '7px',
    maxHeight: '7px',
    aspectRatio: '1 / 1', // Force perfect circle
    borderRadius: '50%',
    flexShrink: 0,
    flexGrow: 0,
    flexBasis: '7px', // Prevent flexbox from altering size
    marginTop: '4px',
    marginLeft: '3px', // Moved 1px right to avoid overlap with screen recording measurement UI.
  },
  labelContainer: {
    backgroundColor: 'rgba(30, 30, 30, 0.85)',
    borderRadius: '4px',
    padding: '4px 4px 4px 4px',
    maxWidth: '320px',
    marginTop: '-6px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    lineHeight: '14px',
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    whiteSpace: 'nowrap', // Prevent text wrapping for short labels like "Say anything"
  },
  helpText: {
    fontSize: '10px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.6)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    textAlign: 'center' as const,
    marginTop: '6px',
    paddingTop: '4px',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
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
  @keyframes fadeOutDot {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes fadeOutLabel {
    0% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes fadeOutPasteFailed {
    0% { opacity: 1; }
    80% { opacity: 1; }
    100% { opacity: 0; }
  }
`;
document.head.appendChild(styleSheet);

// Note: CursorStatusAPI is declared in src/types/window.d.ts
