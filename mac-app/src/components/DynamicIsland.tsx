// =============================================================================
// DynamicIsland - Fixed-position overlay near the macOS notch.
// Two pills: left (mode toggle + history) and right (drawer controls).
// The ?side= query param determines which pill to render.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { estimateWordsPerLine, summarizeTranscriptForHistory, summarizeTranscriptForIsland } from '../utils/textUtils';
import {
  getLeftModeDotPresentation,
  type DynamicIslandInputMode,
} from '../utils/dynamicIslandIndicator';

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

interface HotMicFilterMeter {
  enabled: boolean;
  strength: number;
  rawLevel: number;
  acceptedLevel: number;
  threshold: number;
  speechRatio: number;
  chunkSuppressed: boolean;
}

// Detect which pill this instance should render.
const params = new URLSearchParams(window.location.search);
const side = params.get('side') || 'left';
const TRANSCRIPT_LEADING_WORDS = 5;
const TRANSCRIPT_TRAILING_WORDS = 7;
const HISTORY_PREVIEW_TRAILING_WORDS = 5;
const HISTORY_PREVIEW_MAX_LINES = 3;
const HISTORY_PILL_OFFSET_PX = 82;
const HISTORY_LAYOUT_MIN_WIDTH_PX = 120;
const DRAWER_TEXT_SIZE_DEFAULT = 14;
const DRAWER_TEXT_SIZE_MIN = 11;
const DRAWER_TEXT_SIZE_MAX = 22;

function clampDrawerTextSize(value: number): number {
  if (!Number.isFinite(value)) return DRAWER_TEXT_SIZE_DEFAULT;
  const rounded = Math.round(value);
  return Math.max(DRAWER_TEXT_SIZE_MIN, Math.min(DRAWER_TEXT_SIZE_MAX, rounded));
}

function forceTransparentPageBacking(): void {
  document.documentElement.style.setProperty('background', 'transparent', 'important');
  document.documentElement.style.setProperty('background-color', 'transparent', 'important');
  document.body.style.setProperty('background', 'transparent', 'important');
  document.body.style.setProperty('background-color', 'transparent', 'important');
  const root = document.getElementById('root');
  if (root) {
    root.style.setProperty('background', 'transparent', 'important');
    root.style.setProperty('background-color', 'transparent', 'important');
  }
}

function useTransparentBackingGuard(): void {
  useEffect(() => {
    const apply = () => forceTransparentPageBacking();

    apply();
    document.addEventListener('visibilitychange', apply);
    window.addEventListener('focus', apply);
    window.addEventListener('blur', apply);

    return () => {
      document.removeEventListener('visibilitychange', apply);
      window.removeEventListener('focus', apply);
      window.removeEventListener('blur', apply);
    };
  }, []);
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

// =============================================================================
// Right pill — drawer controls
// =============================================================================

function RightPill() {
  const [drawerTranscript, setDrawerTranscript] = useState('');
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasTranscript = drawerTranscript.trim().length > 0;

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    if (!api) return;

    api.onDrawerTranscript?.((text: string) => {
      setDrawerTranscript(text);
      if (!text.trim()) {
        setCopied(false);
      }
    });

    return () => {
      api.removeAllListeners('dynamic-island-drawer-transcript');
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const handleDismissClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    (window as any).dynamicIslandAPI?.dismissTranscript?.();
  }, []);

  const handleCopyClick = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = drawerTranscript.trim();
    if (!text) return;

    try {
      const api = (window as any).dynamicIslandAPI;
      if (api?.copyToClipboard) {
        api.copyToClipboard(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        return;
      }
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 900);
    } catch (error) {
      console.error('Failed to copy drawer transcript:', error);
    }
  }, [drawerTranscript]);

  const showDrawerControls = hasTranscript;

  return (
    <div style={rightStyles.outerContainer}>
      <div
        className="di-right-pill"
        style={{
          ...rightStyles.pill,
          justifyContent: hasTranscript ? 'flex-end' : 'center',
        }}
      >
        {showDrawerControls && (
          <button
            className="di-right-dismiss-btn"
            onClick={handleDismissClick}
            style={rightStyles.dismissButton}
            title="dismiss transcript"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <circle cx="5.5" cy="5.5" r="5" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
              <path d="M3.8 3.8L7.2 7.2M7.2 3.8L3.8 7.2" stroke="rgba(255,255,255,0.65)" strokeWidth="1" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {showDrawerControls && (
          <button
            className="di-right-copy-btn"
            onClick={handleCopyClick}
            style={rightStyles.copyButton}
            title={copied ? 'copied' : 'copy transcript'}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.2 6.2L4.8 8.8L9.8 3.8" stroke="#34c759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <rect x="4" y="1.2" width="6.2" height="6.2" rx="1" stroke="rgba(255,255,255,0.6)" strokeWidth="1" />
                <rect x="1.8" y="3.6" width="6.2" height="6.2" rx="1" stroke="rgba(255,255,255,0.6)" strokeWidth="1" fill="rgba(0,0,0,0.35)" />
              </svg>
            )}
          </button>
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
    gap: '4px',
    width: '100%',
    height: '100%',
    padding: '0 2px',
    boxSizing: 'border-box',
    backgroundColor: '#000000',
    borderRadius: '0 0 16px 0',
    overflow: 'hidden',
  },
  dismissButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '12px',
    height: '12px',
    flexShrink: 0,
    padding: 0,
    border: 'none',
    borderRadius: '999px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  copyButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '12px',
    height: '12px',
    flexShrink: 0,
    padding: 0,
    border: 'none',
    borderRadius: '999px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
};

// =============================================================================
// Center filler — paints the notch gap black on non-notched primary displays
// =============================================================================

function GapFill() {
  return <div className="di-gap-fill" style={gapFillStyles.fill} />;
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
  const [drawerTextSize, setDrawerTextSize] = useState(DRAWER_TEXT_SIZE_DEFAULT);

  const compactText = summarizeTranscriptForIsland(
    text,
    TRANSCRIPT_LEADING_WORDS,
    TRANSCRIPT_TRAILING_WORDS
  );
  const tokens = compactText.trim().split(/\s+/).filter(Boolean);
  const ellipsisIndex = tokens.indexOf('...');

  let leadingText = '';
  let trailingText = '';
  const normalizedDrawerTextSize = clampDrawerTextSize(drawerTextSize);
  const drawerLineHeight = Math.max(16, Math.round(normalizedDrawerTextSize * 1.3));
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
    api?.onDrawerTextSize?.((size: number) => {
      setDrawerTextSize(clampDrawerTextSize(size));
    });
    if (api?.getHotMicDrawerTextSize) {
      void api.getHotMicDrawerTextSize().then((size: number) => {
        setDrawerTextSize(clampDrawerTextSize(size));
      });
    }
    return () => {
      api?.removeAllListeners('dynamic-island-drawer-transcript');
      api?.removeAllListeners('dynamic-island-drawer-speaking');
      api?.removeAllListeners('dynamic-island-drawer-text-size');
    };
  }, []);

  return (
    <div className="di-drawer-container" style={drawerStyles.container}>
      <div style={drawerStyles.topZone} />
      <div style={drawerStyles.textZone}>
        <span
          style={{
            ...drawerStyles.text,
            fontSize: `${normalizedDrawerTextSize}px`,
            lineHeight: `${drawerLineHeight}px`,
          }}
        >
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
    borderRadius: '0 0 16px 16px',
    clipPath: 'inset(0 round 0 0 16px 16px)',
    overflow: 'hidden',
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
    justifyContent: 'flex-start',
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
    textAlign: 'left',
    lineHeight: '18px',
  },
};

// =============================================================================
// Left pill — mode toggle + history controls
// =============================================================================

function LeftPill() {
  const [state, setState] = useState<IslandState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [isFinal, setIsFinal] = useState<boolean>(false);
  const [commands, setCommands] = useState<CommandHighlight[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [dotCount, setDotCount] = useState(1);
  const [inputMode, setInputMode] = useState<DynamicIslandInputMode>('standard');
  const [historyWordsPerLine, setHistoryWordsPerLine] = useState(10);
  const [voiceTuningVisible, setVoiceTuningVisible] = useState(false);
  const [backgroundFilterEnabled, setBackgroundFilterEnabled] = useState(false);
  const [backgroundFilterStrength, setBackgroundFilterStrength] = useState(50);
  const [compactPillWidth, setCompactPillWidth] = useState<number>(() => window.innerWidth);
  const [compactPillHeight, setCompactPillHeight] = useState<number>(() => window.innerHeight);
  const [filterMeter, setFilterMeter] = useState<HotMicFilterMeter>({
    enabled: false,
    strength: 50,
    rawLevel: 0,
    acceptedLevel: 0,
    threshold: 0,
    speechRatio: 0,
    chunkSuppressed: false,
  });

  const transcriptRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

    api.onInputMode?.((mode: DynamicIslandInputMode) => {
      setInputMode(mode);
    });
    if (api.getInputMode) {
      void api.getInputMode().then((mode: DynamicIslandInputMode) => setInputMode(mode));
    }

    void api.getHotMicBackgroundFilterEnabled?.().then((enabled: boolean) => {
      setBackgroundFilterEnabled(enabled);
      setFilterMeter((prev) => ({ ...prev, enabled }));
    });
    void api.getHotMicBackgroundFilterStrength?.().then((strength: number) => {
      const normalized = Math.max(0, Math.min(100, Math.round(strength)));
      setBackgroundFilterStrength(normalized);
      setFilterMeter((prev) => ({ ...prev, strength: normalized }));
    });
    api.onHotMicFilterMeter?.((data: HotMicFilterMeter) => {
      setFilterMeter(data);
      setBackgroundFilterEnabled(data.enabled);
      setBackgroundFilterStrength(Math.max(0, Math.min(100, Math.round(data.strength))));
    });

    api.requestHistory();

    return () => {
      api.removeAllListeners('dynamic-island-state');
      api.removeAllListeners('dynamic-island-transcript');
      api.removeAllListeners('dynamic-island-command');
      api.removeAllListeners('dynamic-island-history');
      api.removeAllListeners('dynamic-island-hide-history');
      api.removeAllListeners('dynamic-island-show-history');
      api.removeAllListeners('dynamic-island-input-mode');
      api.removeAllListeners('dynamic-island-hotmic-filter-meter');
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
      if (deletedTimerRef.current) {
        clearTimeout(deletedTimerRef.current);
        deletedTimerRef.current = null;
      }
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

  useEffect(() => {
    if (!historyVisible) return;
    const panel = historyScrollRef.current;
    if (!panel) return;

    const updateEstimate = () => {
      setHistoryWordsPerLine(estimateWordsPerLine(panel.clientWidth || null));
    };

    updateEstimate();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateEstimate());
      observer.observe(panel);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateEstimate);
    return () => window.removeEventListener('resize', updateEstimate);
  }, [historyVisible]);

  useEffect(() => {
    const syncCompactPillSize = () => {
      if (historyVisible) return;
      setCompactPillWidth(window.innerWidth);
      setCompactPillHeight(window.innerHeight);
    };

    syncCompactPillSize();
    window.addEventListener('resize', syncCompactPillSize);
    return () => window.removeEventListener('resize', syncCompactPillSize);
  }, [historyVisible]);

  const toggleHistory = useCallback(() => {
    // Keep hamburger decoupled from left-pill geometry:
    // it only toggles the main history window now.
    (window as any).dynamicIslandAPI?.openFieldTheory?.();
  }, []);

  const toggleInputMode = useCallback(() => {
    const nextMode: DynamicIslandInputMode = inputMode === 'hot-mic' ? 'standard' : 'hot-mic';
    const previousMode = inputMode;
    const setMode = (window as any).dynamicIslandAPI?.setInputMode;
    if (setMode) {
      void setMode(nextMode)
        .then((savedMode: DynamicIslandInputMode) => {
          setInputMode(savedMode);
        })
        .catch(() => {
          setInputMode(previousMode);
        });
    }
    setInputMode(nextMode);
  }, [inputMode]);

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

  const handleDelete = useCallback((id: number) => {
    (window as any).dynamicIslandAPI?.deleteHistoryItem?.(id);
    setDeletedId(id);
    setHistory(prev => prev.filter(item => item.id !== id));
    if (deletedTimerRef.current) clearTimeout(deletedTimerRef.current);
    deletedTimerRef.current = setTimeout(() => setDeletedId(null), 1500);
  }, []);

  const handleOpenFieldTheory = useCallback(() => {
    (window as any).dynamicIslandAPI?.openFieldTheory?.();
  }, []);

  const handleBackgroundFilterToggle = useCallback(() => {
    const next = !backgroundFilterEnabled;
    setBackgroundFilterEnabled(next);
    setFilterMeter((prev) => ({ ...prev, enabled: next }));
    void (window as any).dynamicIslandAPI
      ?.setHotMicBackgroundFilterEnabled?.(next)
      .then((saved: boolean) => {
        setBackgroundFilterEnabled(saved);
        setFilterMeter((prev) => ({ ...prev, enabled: saved }));
      });
  }, [backgroundFilterEnabled]);

  const handleBackgroundFilterStrengthChange = useCallback((value: number) => {
    const normalized = Math.max(0, Math.min(100, Math.round(value)));
    setBackgroundFilterStrength(normalized);
    setFilterMeter((prev) => ({ ...prev, strength: normalized }));
    void (window as any).dynamicIslandAPI
      ?.setHotMicBackgroundFilterStrength?.(normalized)
      .then((saved: number) => {
        const clamped = Math.max(0, Math.min(100, Math.round(saved)));
        setBackgroundFilterStrength(clamped);
        setFilterMeter((prev) => ({ ...prev, strength: clamped }));
      });
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

  const incomingPct = Math.round(Math.max(0, Math.min(1, filterMeter.rawLevel)) * 100);
  const acceptedPct = Math.round(Math.max(0, Math.min(1, filterMeter.acceptedLevel)) * 100);
  const thresholdPct = Math.round(Math.max(0, Math.min(1, filterMeter.threshold)) * 100);
  const speechRatioPct = Math.round(Math.max(0, Math.min(1, filterMeter.speechRatio)) * 100);
  const modeDot = getLeftModeDotPresentation(inputMode, state);

  return (
    <div style={styles.outerContainer}>
      <div
        className="di-left-pill"
        style={{
          ...styles.island,
          ...styles.islandIdle,
          width: `${compactPillWidth}px`,
          height: `${compactPillHeight}px`,
        }}
      >
        <button
          className="di-mode-toggle"
          onClick={toggleInputMode}
          style={styles.modeToggle}
          title={inputMode === 'hot-mic' ? 'switch to standard mode' : 'switch to hot mic mode'}
        >
          <span
            aria-hidden="true"
            style={{
              ...styles.modeStateDot,
              backgroundColor: modeDot.color,
              boxShadow: modeDot.shadow,
            }}
          />
        </button>
        <button
          className="di-hamburger"
          onClick={toggleHistory}
          style={{
            ...styles.hamburger,
            backgroundColor: 'transparent',
          }}
          title="transcript history"
        >
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" shapeRendering="crispEdges" aria-hidden="true">
            <path d="M0 1H14V2H0V1Z" fill="rgba(255,255,255,0.78)" />
            <path d="M0 5H10V6H0V5Z" fill="rgba(255,255,255,0.78)" />
            <path d="M0 9H14V10H0V9Z" fill="rgba(255,255,255,0.78)" />
          </svg>
        </button>

      </div>

      {historyVisible && (
        <div className="di-history-panel" style={styles.historyPanel} ref={historyScrollRef}>
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
                      {summarizeTranscriptForHistory(
                        item.text.toLowerCase(),
                        historyWordsPerLine,
                        HISTORY_PREVIEW_TRAILING_WORDS,
                        HISTORY_PREVIEW_MAX_LINES
                      )}
                    </span>
                    <span style={styles.historyMeta}>
                      {item.wordCount} words · {timeAgo(item.createdAt)}
                    </span>
                  </div>
                  <button
                    className="di-delete-btn"
                    style={{
                      ...styles.deleteButton,
                      backgroundColor: deletedId === item.id ? 'rgba(255, 69, 58, 0.35)' : 'rgba(255, 255, 255, 0.08)',
                    }}
                    onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                    title="delete transcript"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M4 1.5H8L8.6 2.4H10.5V3.4H1.5V2.4H3.4L4 1.5Z" fill="rgba(255,255,255,0.7)" />
                      <path d="M3 4.2H9V9.2C9 9.75 8.55 10.2 8 10.2H4C3.45 10.2 3 9.75 3 9.2V4.2Z" stroke="rgba(255,255,255,0.7)" strokeWidth="0.9" />
                      <path d="M5 5.2V8.4M7 5.2V8.4" stroke="rgba(255,255,255,0.7)" strokeWidth="0.9" strokeLinecap="round" />
                    </svg>
                  </button>
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
            className="di-voice-tuning-btn"
            style={styles.voiceTuningButton}
            onClick={() => setVoiceTuningVisible((prev) => !prev)}
            title="hot mic voice tuning"
          >
            {voiceTuningVisible ? 'hide voice tuning' : 'voice tuning'}
          </button>
          {voiceTuningVisible && (
            <div style={styles.voiceTuningPanel}>
              <div style={styles.voiceTuningRow}>
                <span style={styles.voiceTuningLabel}>background voice filter</span>
                <button
                  onClick={handleBackgroundFilterToggle}
                  style={{
                    ...styles.smallToggle,
                    backgroundColor: backgroundFilterEnabled ? 'rgba(52, 199, 89, 0.9)' : 'rgba(255, 255, 255, 0.2)',
                  }}
                >
                  <span style={{
                    ...styles.smallToggleKnob,
                    transform: backgroundFilterEnabled ? 'translateX(14px)' : 'translateX(2px)',
                  }}
                  />
                </button>
              </div>
              <div style={styles.voiceTuningSliderWrap}>
                <div style={styles.voiceMetaRow}>
                  <span style={styles.voiceMetaLabel}>strictness</span>
                  <span style={styles.voiceMetaValue}>{backgroundFilterStrength}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={backgroundFilterStrength}
                  onChange={(e) => handleBackgroundFilterStrengthChange(Number(e.target.value))}
                  style={styles.voiceSlider}
                />
              </div>
              <div style={styles.voiceMeters}>
                <div style={styles.voiceMetaRow}>
                  <span style={styles.voiceMetaLabel}>incoming</span>
                  <span style={styles.voiceMetaValue}>{incomingPct}%</span>
                </div>
                <div style={styles.voiceMeterTrack}>
                  <div style={{ ...styles.voiceMeterFillIncoming, width: `${incomingPct}%` }} />
                </div>
                <div style={styles.voiceMetaRow}>
                  <span style={styles.voiceMetaLabel}>accepted</span>
                  <span style={styles.voiceMetaValue}>{acceptedPct}%</span>
                </div>
                <div style={styles.voiceMeterTrack}>
                  <div style={{ ...styles.voiceMeterFillAccepted, width: `${acceptedPct}%` }} />
                </div>
                <div style={styles.voiceStats}>
                  threshold {thresholdPct}% · speech {speechRatioPct}%
                  {filterMeter.chunkSuppressed ? ' · suppressed chunk' : ''}
                </div>
              </div>
            </div>
          )}
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
    alignItems: 'flex-start',
    width: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
  },

  island: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '48px',
    height: '38px',
    padding: '0 10px',
    boxSizing: 'border-box',
    backgroundColor: '#000000',
    borderRadius: '0 0 22px 22px',
    boxShadow: 'none',
    overflow: 'hidden',
    margin: '0',
    animation: 'fadeInIsland 0.2s ease-out',
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
    width: '22px',
    height: '22px',
    minWidth: '22px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
    flexShrink: 0,
  },

  modeToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    minWidth: '22px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  },

  modeStateDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
  },

  contentArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
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
    whiteSpace: 'normal',
    overflow: 'hidden',
    display: 'block',
    maxHeight: '48px',
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

  deleteButton: {
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

  voiceTuningButton: {
    width: '100%',
    height: '36px',
    border: 'none',
    borderRadius: '11px',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: '12px',
    fontWeight: 560,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
    textTransform: 'lowercase',
  },

  voiceTuningPanel: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  voiceTuningRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },

  voiceTuningLabel: {
    fontSize: '10.5px',
    color: 'rgba(255, 255, 255, 0.84)',
    textTransform: 'lowercase',
  },

  smallToggle: {
    position: 'relative',
    width: '34px',
    height: '20px',
    border: 'none',
    borderRadius: '12px',
    padding: 0,
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
  },

  smallToggleKnob: {
    position: 'absolute',
    top: '2px',
    left: 0,
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: '#ffffff',
    transition: 'transform 0.12s ease',
  },

  voiceTuningSliderWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },

  voiceSlider: {
    width: '100%',
    accentColor: '#34c759',
  },

  voiceMetaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  voiceMetaLabel: {
    fontSize: '10px',
    color: 'rgba(255, 255, 255, 0.54)',
    textTransform: 'lowercase',
  },

  voiceMetaValue: {
    fontSize: '10px',
    color: 'rgba(255, 255, 255, 0.78)',
    fontVariantNumeric: 'tabular-nums',
  },

  voiceMeters: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },

  voiceMeterTrack: {
    width: '100%',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },

  voiceMeterFillIncoming: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: 'rgba(255, 193, 7, 0.95)',
    transition: 'width 80ms linear',
  },

  voiceMeterFillAccepted: {
    height: '100%',
    borderRadius: '999px',
    backgroundColor: 'rgba(52, 199, 89, 0.95)',
    transition: 'width 80ms linear',
  },

  voiceStats: {
    marginTop: '2px',
    fontSize: '9.5px',
    color: 'rgba(255, 255, 255, 0.48)',
    textTransform: 'lowercase',
  },

  openFieldTheoryButton: {
    width: '100%',
    height: '40px',
    border: 'none',
    borderRadius: '11px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: 'rgba(255, 255, 255, 0.86)',
    fontSize: '12.5px',
    fontWeight: 560,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
    textTransform: 'lowercase',
  },
};

// Keyframes and interaction styles.
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  :root, html, body, #root {
    background: transparent !important;
  }
  .di-left-pill {
    margin-left: 0 !important;
  }
  @media (min-width: ${HISTORY_LAYOUT_MIN_WIDTH_PX}px) {
    .di-left-pill {
      margin-left: ${HISTORY_PILL_OFFSET_PX}px !important;
    }
  }
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
  .di-delete-btn:hover {
    background-color: rgba(255, 69, 58, 0.25) !important;
  }
  .di-open-ft-btn:hover {
    background-color: rgba(255, 255, 255, 0.16) !important;
  }
  .di-voice-tuning-btn:hover {
    background-color: rgba(255, 255, 255, 0.16) !important;
  }
  .di-hamburger,
  .di-hamburger:hover,
  .di-hamburger:active,
  .di-hamburger:focus,
  .di-hamburger:focus-visible {
    background-color: transparent !important;
    outline: none !important;
    box-shadow: none !important;
  }
  .di-mode-toggle:hover {
    background-color: transparent !important;
  }
  .di-right-dismiss-btn:hover,
  .di-right-copy-btn:hover {
    background-color: rgba(255, 255, 255, 0.12) !important;
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
  useTransparentBackingGuard();

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
      onHotMicUpdate?: (cb: (data: { active: boolean; wordCount: number; lastWord: string; muted?: boolean }) => void) => void;
      onHotMicWarnDiscard?: (cb: () => void) => void;
      onHotMicSlideOut?: (cb: () => void) => void;
      onHotMicMute?: (cb: (muted: boolean) => void) => void;
      onHotMicFilterMeter?: (cb: (data: HotMicFilterMeter) => void) => void;
      onInputMode?: (cb: (mode: 'hot-mic' | 'standard') => void) => void;
      getInputMode?: () => Promise<'hot-mic' | 'standard'>;
      setInputMode?: (mode: 'hot-mic' | 'standard') => Promise<'hot-mic' | 'standard'>;
      toggleMute?: () => void;
      dismissTranscript?: () => void;
      onDrawerTranscript?: (cb: (text: string) => void) => void;
      onDrawerSpeaking?: (cb: (speaking: boolean) => void) => void;
      onDrawerTextSize?: (cb: (size: number) => void) => void;
      getHotMicBackgroundFilterEnabled?: () => Promise<boolean>;
      setHotMicBackgroundFilterEnabled?: (enabled: boolean) => Promise<boolean>;
      getHotMicBackgroundFilterStrength?: () => Promise<number>;
      setHotMicBackgroundFilterStrength?: (strength: number) => Promise<number>;
      getHotMicDrawerTextSize?: () => Promise<number>;
      openFieldTheory?: () => void;
      requestHistory: () => void;
      copyAndPaste: (text: string) => void;
      copyToClipboard: (text: string) => void;
      deleteHistoryItem?: (id: number) => void;
      toggleHistory: () => void;
      setHistoryVisible: (visible: boolean) => void;
      removeAllListeners: (channel: string) => void;
    };
  }
}
