// =============================================================================
// DynamicIsland - Fixed-position overlay near the macOS notch.
// Shows live transcript text during/after recording, command highlighting,
// and a hamburger menu for transcript history with copy/paste behavior.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';

type IslandState = 'idle' | 'recording' | 'transcribing' | 'showing-transcript' | 'improving';

interface HistoryItem {
  id: number;
  text: string;
  createdAt: number;
  wordCount: number;
}

interface CommandHighlight {
  phrase: string;
  startIndex: number;
  endIndex: number;
}

// How long ago something happened, in casual human language.
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DynamicIsland() {
  const [state, setState] = useState<IslandState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [isFinal, setIsFinal] = useState<boolean>(false);
  const [commands, setCommands] = useState<CommandHighlight[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [dotCount, setDotCount] = useState(1);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------------------------------------------------------------------
  // IPC listeners
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    if (!api) return;

    api.onStateChange((newState: IslandState) => {
      setState(newState);
      if (newState === 'recording') {
        setTranscript('');
        setCommands([]);
        setIsFinal(false);
      }
    });

    api.onTranscriptUpdate((data: { text: string; isFinal: boolean }) => {
      setTranscript(data.text.toLowerCase());
      setIsFinal(data.isFinal);
    });

    api.onCommandDetected((data: CommandHighlight) => {
      setCommands(prev => [...prev, data]);
    });

    api.onHistoryUpdate((items: HistoryItem[]) => {
      setHistory(items);
    });

    // Force-hide history when window loses focus.
    api.onHideHistory?.(() => {
      setHistoryVisible(false);
    });

    // Request initial history.
    api.requestHistory();

    return () => {
      api.removeAllListeners('dynamic-island-state');
      api.removeAllListeners('dynamic-island-transcript');
      api.removeAllListeners('dynamic-island-command');
      api.removeAllListeners('dynamic-island-history');
      api.removeAllListeners('dynamic-island-hide-history');
    };
  }, []);

  // Cycling dots animation for transcribing/improving states.
  useEffect(() => {
    if (state === 'transcribing' || state === 'improving') {
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
      if (dotIntervalRef.current) clearInterval(dotIntervalRef.current);
    };
  }, [state]);

  // Auto-scroll the transcript container to the bottom as text streams in.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const toggleHistory = useCallback(() => {
    const next = !historyVisible;
    setHistoryVisible(next);
    (window as any).dynamicIslandAPI?.setHistoryVisible(next);
    if (next) {
      (window as any).dynamicIslandAPI?.requestHistory();
    }
  }, [historyVisible]);

  const handleCopyPaste = useCallback((text: string, id: number) => {
    (window as any).dynamicIslandAPI?.copyAndPaste(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handleCopy = useCallback((text: string, id: number) => {
    (window as any).dynamicIslandAPI?.copyToClipboard(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  // Render transcript text with command phrase highlighting.
  // Detects [cmd:name.md] references in the text and renders them as highlighted pills.
  // Also highlights bare command names if they were detected by the transcriber.
  const renderTranscript = () => {
    if (!transcript) return null;

    // Match [cmd:something.md] patterns and command names sent from main process.
    const cmdRefPattern = /\[cmd:([^\]]+)\.md\]/gi;
    const commandNames = commands.map(c => c.phrase.toLowerCase());

    // Build a combined regex that matches both [cmd:...] refs and bare command names.
    const patterns: Array<{ regex: RegExp; type: 'ref' | 'name' }> = [];
    patterns.push({ regex: cmdRefPattern, type: 'ref' });
    commandNames.forEach(name => {
      if (name.length > 2) {
        patterns.push({ regex: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), type: 'name' });
      }
    });

    // Find all matches with their positions.
    const highlights: Array<{ start: number; end: number; text: string; type: string }> = [];
    patterns.forEach(({ regex, type }) => {
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(transcript)) !== null) {
        highlights.push({
          start: match.index,
          end: match.index + match[0].length,
          text: type === 'ref' ? match[1] : match[0],
          type,
        });
      }
    });

    if (highlights.length === 0) {
      return <span>{transcript}</span>;
    }

    // Sort by position and remove overlaps.
    highlights.sort((a, b) => a.start - b.start);
    const deduped: typeof highlights = [];
    for (const h of highlights) {
      if (deduped.length === 0 || h.start >= deduped[deduped.length - 1].end) {
        deduped.push(h);
      }
    }

    // Build JSX with highlighted segments.
    const parts: JSX.Element[] = [];
    let cursor = 0;
    deduped.forEach((h, i) => {
      if (h.start > cursor) {
        parts.push(<span key={`t-${i}`}>{transcript.slice(cursor, h.start)}</span>);
      }
      parts.push(
        <span key={`c-${i}`} style={styles.commandHighlight}>
          {h.text}
        </span>
      );
      cursor = h.end;
    });
    if (cursor < transcript.length) {
      parts.push(<span key="tail">{transcript.slice(cursor)}</span>);
    }

    return <>{parts}</>;
  };

  // Don't render anything when idle and history is closed.
  if (state === 'idle' && !historyVisible) return null;

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  const isActive = state === 'recording' || state === 'transcribing' || state === 'improving';
  const hasTranscript = transcript.length > 0;
  const showTranscript = hasTranscript && (state === 'showing-transcript' || state === 'transcribing');

  return (
    <div style={styles.outerContainer}>
      {/* The island bar */}
      <div style={styles.island}>
        {/* Hamburger / history toggle on the left side */}
        <button
          className="di-hamburger"
          onClick={toggleHistory}
          style={{
            ...styles.hamburger,
            backgroundColor: historyVisible ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
          }}
          title="transcript history"
        >
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
            <rect y="0" width="14" height="1.5" rx="0.75" fill="rgba(255,255,255,0.7)" />
            <rect y="4" width="10" height="1.5" rx="0.75" fill="rgba(255,255,255,0.7)" />
            <rect y="8" width="14" height="1.5" rx="0.75" fill="rgba(255,255,255,0.7)" />
          </svg>
        </button>

        {/* Status indicator + transcript area */}
        <div style={styles.contentArea}>
          {/* State dot */}
          {isActive && (
            <div style={{
              ...styles.dot,
              backgroundColor: state === 'recording' ? '#ff3b30'
                : state === 'improving' ? '#007aff'
                : '#af52de',
              boxShadow: state === 'recording' ? '0 0 8px rgba(255, 59, 48, 0.5)'
                : state === 'improving' ? '0 0 8px rgba(0, 122, 255, 0.5)'
                : '0 0 8px rgba(175, 82, 222, 0.5)',
              animation: state === 'recording' ? 'pulse 1.8s ease-in-out infinite' : 'none',
            }} />
          )}

          {/* Label / transcript text */}
          <div style={styles.textContainer} ref={transcriptRef}>
            {state === 'recording' && !hasTranscript && (
              <span style={styles.statusText}>recording</span>
            )}
            {state === 'transcribing' && !hasTranscript && (
              <span style={styles.statusText}>transcribing{'.'.repeat(dotCount)}</span>
            )}
            {state === 'improving' && (
              <span style={styles.statusText}>improving{'.'.repeat(dotCount)}</span>
            )}
            {showTranscript && (
              <span style={styles.transcriptText}>{renderTranscript()}</span>
            )}
            {state === 'recording' && hasTranscript && (
              <span style={styles.transcriptText}>{renderTranscript()}</span>
            )}
          </div>
        </div>
      </div>

      {/* History panel - slides down below the island */}
      {historyVisible && (
        <div style={styles.historyPanel} ref={historyScrollRef}>
          {history.length === 0 ? (
            <div style={styles.emptyHistory}>
              <span style={styles.emptyText}>no transcripts yet</span>
              <span style={styles.emptySubtext}>recordings will appear here</span>
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="di-history-item" style={styles.historyItem}>
                <div style={styles.historyTextArea} onClick={() => handleCopyPaste(item.text, item.id)}>
                  <span style={styles.historyText}>
                    {item.text.toLowerCase().slice(0, 140)}
                    {item.text.length > 140 ? '...' : ''}
                  </span>
                  <span style={styles.historyMeta}>
                    {item.wordCount} words · {timeAgo(item.createdAt)}
                  </span>
                </div>
                <button
                  className="di-copy-btn"
                  style={{
                    ...styles.copyButton,
                    backgroundColor: copiedId === item.id ? 'rgba(52, 199, 89, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  }}
                  onClick={(e) => { e.stopPropagation(); handleCopy(item.text, item.id); }}
                  title="copy to clipboard"
                >
                  {copiedId === item.id ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6L5 9L10 3" stroke="#34c759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <rect x="4" y="1" width="7" height="7" rx="1" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
                      <rect x="1" y="4" width="7" height="7" rx="1" stroke="rgba(255,255,255,0.5)" strokeWidth="1" fill="rgba(0,0,0,0.3)" />
                    </svg>
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Styles - dark, rounded, macOS dynamic-island aesthetic.
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  outerContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  },

  island: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    height: '42px',
    padding: '0 10px',
    backgroundColor: 'rgba(15, 15, 15, 0.92)',
    borderRadius: '22px',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    boxShadow: '0 2px 20px rgba(0, 0, 0, 0.4), inset 0 0.5px 0 rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
    margin: '0 auto',
    animation: 'fadeInIsland 0.2s ease-out',
  },

  hamburger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    minWidth: '28px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    flexShrink: 0,
  },

  contentArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },

  dot: {
    width: '8px',
    height: '8px',
    minWidth: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },

  textContainer: {
    flex: 1,
    minWidth: 0,
    maxHeight: '36px',
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'none',
  },

  statusText: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
  },

  transcriptText: {
    fontSize: '12px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.88)',
    lineHeight: '17px',
    letterSpacing: '0.01em',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as any,
    overflow: 'hidden',
    wordBreak: 'break-word',
  },

  commandHighlight: {
    backgroundColor: 'rgba(175, 82, 222, 0.35)',
    borderRadius: '4px',
    padding: '1px 5px',
    margin: '0 1px',
    fontWeight: 500,
    color: '#d4a5ff',
  },

  // History panel
  historyPanel: {
    width: 'calc(100% - 8px)',
    maxHeight: '320px',
    overflowY: 'auto',
    overflowX: 'hidden',
    marginTop: '4px',
    padding: '6px',
    backgroundColor: 'rgba(15, 15, 15, 0.92)',
    borderRadius: '14px',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    boxShadow: '0 2px 20px rgba(0, 0, 0, 0.4), inset 0 0.5px 0 rgba(255, 255, 255, 0.06)',
    scrollbarWidth: 'thin' as any,
    scrollbarColor: 'rgba(255,255,255,0.15) transparent',
    animation: 'slideDown 0.18s ease-out',
  },

  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 8px',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
    marginBottom: '2px',
  },

  historyTextArea: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },

  historyText: {
    fontSize: '11.5px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.82)',
    lineHeight: '16px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as any,
    wordBreak: 'break-word',
  },

  historyMeta: {
    fontSize: '10px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.35)',
  },

  copyButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    minWidth: '28px',
    borderRadius: '7px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    flexShrink: 0,
  },

  emptyHistory: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    gap: '4px',
  },

  emptyText: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.4)',
  },

  emptySubtext: {
    fontSize: '10.5px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.22)',
  },
};

// Add keyframes and interaction styles.
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeInIsland {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  /* Hide scrollbars in the transcript area */
  div::-webkit-scrollbar {
    display: none;
  }
  /* Hover state for history items */
  .di-history-item:hover {
    background-color: rgba(255, 255, 255, 0.06) !important;
  }
  .di-history-item:active {
    background-color: rgba(255, 255, 255, 0.1) !important;
  }
  .di-copy-btn:hover {
    background-color: rgba(255, 255, 255, 0.15) !important;
  }
  .di-hamburger:hover {
    background-color: rgba(255, 255, 255, 0.12) !important;
  }
`;
document.head.appendChild(styleSheet);

// Type declaration for the dynamic island preload API.
declare global {
  interface Window {
    dynamicIslandAPI?: {
      onStateChange: (cb: (state: string) => void) => void;
      onTranscriptUpdate: (cb: (data: { text: string; isFinal: boolean }) => void) => void;
      onCommandDetected: (cb: (data: { phrase: string; startIndex: number; endIndex: number }) => void) => void;
      onHistoryUpdate: (cb: (history: HistoryItem[]) => void) => void;
      onHideHistory?: (cb: () => void) => void;
      requestHistory: () => void;
      copyAndPaste: (text: string) => void;
      copyToClipboard: (text: string) => void;
      toggleHistory: () => void;
      setHistoryVisible: (visible: boolean) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}
