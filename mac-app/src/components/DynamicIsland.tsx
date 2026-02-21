// =============================================================================
// DynamicIsland - Fixed-position overlay near the macOS notch.
// Two pills: left (hamburger + expanded transcript bar) and right (hot-mic dot).
// The ?side= query param determines which pill to render.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { summarizeTranscriptForIsland } from '../utils/textUtils';

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

// Detect which pill this instance should render.
const params = new URLSearchParams(window.location.search);
const side = params.get('side') || 'left';
const TRANSCRIPT_LEADING_WORDS = 3;
const TRANSCRIPT_TRAILING_WORDS = 7;

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

// =============================================================================
// Right pill — hot-mic status dot (centered, no text)
// =============================================================================

function RightPill() {
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [warnBlink, setWarnBlink] = useState(false);
  const [slideOut, setSlideOut] = useState(false);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    if (!api) return;

    api.onHotMicUpdate?.((data: { active: boolean; wordCount: number; lastWord: string }) => {
      setActive(data.active);
      if (data.active) {
        setWarnBlink(false);
        setSlideOut(false);
      }
    });

    api.onHotMicWarnDiscard?.(() => {
      setWarnBlink(true);
      setTimeout(() => setWarnBlink(false), 600);
    });

    api.onHotMicSlideOut?.(() => {
      setSlideOut(true);
      setTimeout(() => {
        setSlideOut(false);
        setActive(false);
      }, 400);
    });

    api.onHotMicMute?.((isMuted: boolean) => {
      setMuted(isMuted);
    });

    return () => {
      api.removeAllListeners('dynamic-island-hotmic');
      api.removeAllListeners('dynamic-island-hotmic-warn-discard');
      api.removeAllListeners('dynamic-island-hotmic-slide-out');
      api.removeAllListeners('dynamic-island-hotmic-mute');
    };
  }, []);

  const handleClick = useCallback(() => {
    (window as any).dynamicIslandAPI?.toggleMute?.();
  }, []);

  const dotColor = warnBlink ? '#fbbf24' : '#f97316';
  const dotShadow = warnBlink
    ? '0 0 8px rgba(251, 191, 36, 0.6)'
    : '0 0 8px rgba(249, 115, 22, 0.5)';

  return (
    <div style={rightStyles.outerContainer}>
      <div
        className="di-right-pill"
        onClick={handleClick}
        style={{
          ...rightStyles.pill,
          cursor: 'pointer',
        }}
      >
        {muted ? (
          /* Muted: gray circle with diagonal slash (⊘ / prohibition sign) */
          <svg className="di-right-dot" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" fill="none" />
            <line x1="3.5" y1="10.5" x2="10.5" y2="3.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : (
          /* Active/inactive dot */
          <div className="di-right-dot" style={{
            ...rightStyles.dot,
            opacity: (active || warnBlink) ? (slideOut ? 0 : 1) : 0,
            backgroundColor: dotColor,
            boxShadow: dotShadow,
            transition: 'opacity 0.3s ease',
          }} />
        )}
      </div>
    </div>
  );
}

const rightStyles: Record<string, React.CSSProperties> = {
  outerContainer: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '38px',
    backgroundColor: '#000000',
    WebkitMaskImage: 'radial-gradient(white, white)',
    borderRadius: '0 0 16px 0',
    overflow: 'hidden',
  },
  dot: {
    width: '8px',
    height: '8px',
    minWidth: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'opacity 0.2s ease, background-color 0.15s ease',
  },
};

// =============================================================================
// Center filler — paints the notch gap black on non-notched primary displays
// =============================================================================

function GapFill() {
  return <div style={gapFillStyles.fill} />;
}

const gapFillStyles: Record<string, React.CSSProperties> = {
  fill: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
};

// =============================================================================
// Drawer pill — live transcript text below the notch
// =============================================================================

function DrawerPill() {
  const [text, setText] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const compactText = summarizeTranscriptForIsland(
    text,
    TRANSCRIPT_LEADING_WORDS,
    TRANSCRIPT_TRAILING_WORDS
  );
  const tokens = compactText.trim().split(/\s+/).filter(Boolean);
  const ellipsisIndex = tokens.indexOf('...');

  let leadingText = '';
  let trailingText = '';
  if (tokens.length > 0) {
    if (ellipsisIndex >= 0) {
      leadingText = tokens.slice(0, ellipsisIndex + 1).join(' ');
      trailingText = tokens.slice(ellipsisIndex + 1).join(' ');
    } else if (tokens.length > TRANSCRIPT_TRAILING_WORDS) {
      leadingText = tokens.slice(0, -TRANSCRIPT_TRAILING_WORDS).join(' ');
      trailingText = tokens.slice(-TRANSCRIPT_TRAILING_WORDS).join(' ');
    } else {
      trailingText = compactText;
    }
  }

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onDrawerTranscript?.((t: string) => {
      setText(t);
    });
    api?.onDrawerSpeaking?.((isSpeaking: boolean) => {
      setSpeaking(isSpeaking);
    });
    return () => {
      api?.removeAllListeners('dynamic-island-drawer-transcript');
      api?.removeAllListeners('dynamic-island-drawer-speaking');
    };
  }, []);

  return (
    <div style={drawerStyles.container}>
      <div style={drawerStyles.topZone} />
      <div style={drawerStyles.textZone}>
        <span style={drawerStyles.text}>
          {leadingText && (
            <span>
              {leadingText}
              {trailingText ? ' ' : ''}
            </span>
          )}
          {trailingText && (
            <span className={speaking ? 'di-drawer-tail-speaking' : undefined}>
              {trailingText}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

const drawerStyles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    clipPath: 'inset(0 round 0 0 12px 12px)',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  },
  topZone: {
    height: '38px',
    flexShrink: 0,
  },
  textZone: {
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 16px',
    boxSizing: 'border-box',
  },
  text: {
    fontSize: '13.5px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.75)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    width: '100%',
    textAlign: 'center',
    lineHeight: '18px',
  },
};

// =============================================================================
// Left pill — hamburger + expanded transcript bar (existing behavior)
// =============================================================================

function LeftPill() {
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
      const summarized = summarizeTranscriptForIsland(
        data.text.toLowerCase(),
        TRANSCRIPT_LEADING_WORDS,
        TRANSCRIPT_TRAILING_WORDS
      );
      setTranscript(summarized);
      setIsFinal(data.isFinal);
    });

    api.onCommandDetected((data: CommandHighlight) => {
      setCommands(prev => [...prev, data]);
    });

    api.onHistoryUpdate((items: HistoryItem[]) => {
      setHistory(items);
    });

    api.onHideHistory?.(() => {
      setHistoryVisible(false);
    });

    api.onShowHistory?.(() => {
      setHistoryVisible(true);
    });

    api.requestHistory();

    return () => {
      api.removeAllListeners('dynamic-island-state');
      api.removeAllListeners('dynamic-island-transcript');
      api.removeAllListeners('dynamic-island-command');
      api.removeAllListeners('dynamic-island-history');
      api.removeAllListeners('dynamic-island-hide-history');
      api.removeAllListeners('dynamic-island-show-history');
    };
  }, []);

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

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const toggleHistory = useCallback(() => {
    const next = !historyVisible;
    (window as any).dynamicIslandAPI?.setHistoryVisible(next);
    if (next) {
      (window as any).dynamicIslandAPI?.requestHistory();
    } else {
      setHistoryVisible(false);
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

  const handleOpenFieldTheory = useCallback(() => {
    (window as any).dynamicIslandAPI?.openFieldTheory?.();
  }, []);

  const renderTranscript = () => {
    if (!transcript) return null;

    const cmdRefPattern = /\[cmd:([^\]]+)\.md\]/gi;
    const commandNames = commands.map(c => c.phrase.toLowerCase());

    const patterns: Array<{ regex: RegExp; type: 'ref' | 'name' }> = [];
    patterns.push({ regex: cmdRefPattern, type: 'ref' });
    commandNames.forEach(name => {
      if (name.length > 2) {
        patterns.push({ regex: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), type: 'name' });
      }
    });

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

    highlights.sort((a, b) => a.start - b.start);
    const deduped: typeof highlights = [];
    for (const h of highlights) {
      if (deduped.length === 0 || h.start >= deduped[deduped.length - 1].end) {
        deduped.push(h);
      }
    }

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

  const isIdle = state === 'idle' && !historyVisible;
  const isActive = state === 'recording' || state === 'transcribing' || state === 'improving';
  const hasTranscript = transcript.length > 0;
  const showTranscript = hasTranscript && (state === 'showing-transcript' || state === 'transcribing');

  return (
    <div style={styles.outerContainer}>
      <div style={{
        ...styles.island,
        ...(isIdle ? styles.islandIdle : {}),
      }}>
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

        {!isIdle && <div style={styles.contentArea}>
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
        </div>}
      </div>

      {historyVisible && (
        <div style={styles.historyPanel} ref={historyScrollRef}>
          <div style={styles.historyList}>
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
          <button
            className="di-open-ft-btn"
            style={styles.openFieldTheoryButton}
            onClick={handleOpenFieldTheory}
            title="open field theory window"
          >
            open field theory
          </button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Styles
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
    backgroundColor: '#000000',
    WebkitMaskImage: 'radial-gradient(white, white)',
    borderRadius: '0 0 22px 22px',
    boxShadow: 'none',
    overflow: 'hidden',
    margin: '0 auto',
    animation: 'fadeInIsland 0.2s ease-out',
    transition: 'width 0.2s ease, padding 0.2s ease',
  },

  islandIdle: {
    height: '38px',
    justifyContent: 'center',
    borderRadius: '0 0 0 16px',
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
    maxHeight: '20px',
    overflowY: 'hidden',
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
    fontSize: '14px',
    fontWeight: 400,
    color: 'rgba(255, 255, 255, 0.88)',
    lineHeight: '18px',
    letterSpacing: '0.01em',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  commandHighlight: {
    backgroundColor: 'rgba(175, 82, 222, 0.35)',
    borderRadius: '4px',
    padding: '1px 5px',
    margin: '0 1px',
    fontWeight: 500,
    color: '#d4a5ff',
  },

  historyPanel: {
    width: 'calc(100% - 8px)',
    maxHeight: '320px',
    marginTop: '4px',
    padding: '6px',
    backgroundColor: '#000000',
    WebkitMaskImage: 'radial-gradient(white, white)',
    borderRadius: '14px',
    boxShadow: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    animation: 'slideDown 0.18s ease-out',
  },

  historyList: {
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollbarWidth: 'thin' as any,
    scrollbarColor: 'rgba(255,255,255,0.15) transparent',
    maxHeight: '272px',
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

  openFieldTheoryButton: {
    width: '100%',
    height: '30px',
    border: 'none',
    borderRadius: '9px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: '11px',
    fontWeight: 500,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
    textTransform: 'lowercase',
  },
};

// Keyframes and interaction styles.
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
  @keyframes drawerTailSoftPulse {
    0%, 100% { opacity: 0.96; }
    50% { opacity: 0.78; }
  }
  div::-webkit-scrollbar {
    display: none;
  }
  .di-history-item:hover {
    background-color: rgba(255, 255, 255, 0.06) !important;
  }
  .di-history-item:active {
    background-color: rgba(255, 255, 255, 0.1) !important;
  }
  .di-copy-btn:hover {
    background-color: rgba(255, 255, 255, 0.15) !important;
  }
  .di-open-ft-btn:hover {
    background-color: rgba(255, 255, 255, 0.16) !important;
  }
  .di-hamburger:hover {
    background-color: rgba(255, 255, 255, 0.12) !important;
  }
  .di-right-pill:hover .di-right-dot {
    filter: brightness(1.2);
  }
  .di-drawer-tail-speaking {
    color: rgba(255, 255, 255, 0.9);
    animation: drawerTailSoftPulse 1.5s ease-in-out infinite;
  }
`;
document.head.appendChild(styleSheet);

// =============================================================================
// Root — delegates to left or right pill based on query param
// =============================================================================

export default function DynamicIsland() {
  if (side === 'drawer') return <DrawerPill />;
  if (side === 'right') return <RightPill />;
  if (side === 'filler') return <GapFill />;
  return <LeftPill />;
}

declare global {
  interface Window {
    dynamicIslandAPI?: {
      onStateChange: (cb: (state: string) => void) => void;
      onTranscriptUpdate: (cb: (data: { text: string; isFinal: boolean }) => void) => void;
      onCommandDetected: (cb: (data: { phrase: string; startIndex: number; endIndex: number }) => void) => void;
      onHistoryUpdate: (cb: (history: HistoryItem[]) => void) => void;
      onHideHistory?: (cb: () => void) => void;
      onShowHistory?: (cb: () => void) => void;
      onHotMicUpdate?: (cb: (data: { active: boolean; wordCount: number; lastWord: string }) => void) => void;
      onHotMicWarnDiscard?: (cb: () => void) => void;
      onHotMicSlideOut?: (cb: () => void) => void;
      onHotMicMute?: (cb: (muted: boolean) => void) => void;
      toggleMute?: () => void;
      onDrawerTranscript?: (cb: (text: string) => void) => void;
      onDrawerSpeaking?: (cb: (speaking: boolean) => void) => void;
      openFieldTheory?: () => void;
      requestHistory: () => void;
      copyAndPaste: (text: string) => void;
      copyToClipboard: (text: string) => void;
      toggleHistory: () => void;
      setHistoryVisible: (visible: boolean) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}
