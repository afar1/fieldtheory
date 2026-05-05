// =============================================================================
// DynamicIsland - Fixed-position overlay near the macOS notch.
// Two pills: left (history + cancel) and right (waveform + stack state).
// The ?side= query param determines which pill to render.
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  countAppendedWords,
  estimateWordsPerLine,
  getCarouselWordVisual,
  splitDrawerTranscriptForRender,
  summarizeDrawerTranscript,
  summarizeTranscriptForHistory,
  summarizeTranscriptForIsland
} from '../utils/textUtils';
import {
  AudioLevelRingBuffer,
  scaleAudioLevel,
  WAVEFORM_BAR_COUNT,
} from '../utils/audioWaveform';
import { PillSlot, PILL_SLOT_CONTENT_FADE_MS } from './PillSlot';
import {
  computeLeftPillWidth,
  computeRightPillWidth,
  FLOATING_WAVEFORM_STACK_GAP,
  floatingPipeSlotWidthForCount,
  pipeSlotWidthForCount,
  WAVEFORM_WIDTH,
} from './pillWidths';

type IslandState = 'idle' | 'silentStacking' | 'recording' | 'transcribing' | 'completing' | 'showing-transcript' | 'improving';

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

interface HotMicRuntimeStatus {
  state: string;
  condition: string | null;
  engineReady: boolean;
  whisperFallbackActive: boolean;
  queueDepth: number;
  lastChunkAgeMs: number | null;
  chunksReceived: number;
  micHealthy: boolean;
  engine: {
    selectedEngine: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual';
    readiness:
      | 'ready'
      | 'warming'
      | 'cold'
      | 'not-installed'
      | 'not-downloaded'
      | 'corrupt'
      | 'unsupported-arch'
      | 'disabled';
    detail: string | null;
  } | null;
  timing: {
    chunkIntervalMs: number | null;
    queueWaitMs: number | null;
    transcribeMs: number | null;
    postProcessMs: number | null;
    totalPipelineMs: number | null;
    avgTranscribeMs: number | null;
    avgTotalPipelineMs: number | null;
  };
}

// Detect which pill this instance should render.
const params = new URLSearchParams(window.location.search);
const side = params.get('side') || 'left';
const TRANSCRIPT_LEADING_WORDS = 5;
const TRANSCRIPT_TRAILING_WORDS = 7;
const DRAWER_LEADING_WORDS = 3;
const DRAWER_TRAILING_WORDS = 10;
const DRAWER_LEADING_CONTEXT_HOLD_MS = 2400;
const DRAWER_WORD_ENTER_MAX_WORDS = 3;
const DRAWER_WORD_ENTER_DURATION_MS = 180;
const DRAWER_WORD_ENTER_STAGGER_MS = 50;
const HISTORY_PREVIEW_TRAILING_WORDS = 5;
const HISTORY_PREVIEW_MAX_LINES = 3;
const HISTORY_PILL_OFFSET_PX = 82;
const HISTORY_LAYOUT_MIN_WIDTH_PX = 120;
const FLOATING_CANCEL_FADE_MS = 180;
const FLOATING_COMPLETE_SETTLE_MS = 60;
const FLOATING_CONTENT_FALLBACK_WIDTH = WAVEFORM_WIDTH;
const STATIC_WAVEFORM_LEVELS = new Array(WAVEFORM_BAR_COUNT).fill(0);
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
// Right pill — waveform + pipe bars
// =============================================================================

interface RightPillProps {
  sectionWidth?: number;
  onSlotSumChange?: (sum: number) => void;
  sectionTransitionDelay?: string;
  floating?: boolean;
}
function RightPill({ sectionWidth, onSlotSumChange, sectionTransitionDelay, floating }: RightPillProps = {}) {
  const [pipeCount, setPipeCount] = useState(0);
  const [animatedPipes, setAnimatedPipes] = useState<Set<number>>(new Set());
  const [state, setState] = useState<IslandState>('idle');
  const [hotMicActive, setHotMicActive] = useState(false);
  const [standardAudioLevel, setStandardAudioLevel] = useState(0);
  const [filterMeterRawLevel, setFilterMeterRawLevel] = useState(0);
  const waveformBufferRef = useRef(new AudioLevelRingBuffer(WAVEFORM_BAR_COUNT));
  const [waveformLevels, setWaveformLevels] = useState<number[]>(new Array(WAVEFORM_BAR_COUNT).fill(0));
  const waveformSettled = state === 'completing';
  const waveformActive = hotMicActive || state === 'recording' || waveformSettled;
  const resetWaveform = useCallback(() => {
    waveformBufferRef.current.reset();
    setWaveformLevels(new Array(WAVEFORM_BAR_COUNT).fill(0));
  }, []);

  // Hot-mic waveform = orange, standard recording waveform = white.
  const waveformColor = hotMicActive && !waveformSettled
    ? 'rgba(249, 115, 22, 0.95)'
    : 'rgba(255, 255, 255, 0.92)';

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    if (!api) return;

    api.onStateChange?.((s: string) => {
      setState(s as IslandState);
      resetWaveform();
      if (s !== 'recording') {
        setStandardAudioLevel(0);
      }
    });
    api.onHotMicUpdate?.((data: { active: boolean }) => setHotMicActive(Boolean(data?.active)));
    api.onStandardAudioLevel?.((level: number) => setStandardAudioLevel(level));
    api.onHotMicFilterMeter?.((data: { rawLevel: number }) => setFilterMeterRawLevel(data.rawLevel));

    api.onStackChanged?.((count: number) => {
      setPipeCount((prev) => {
        if (count < prev) {
          setAnimatedPipes(new Set());
          return count;
        }
        if (count > prev) {
          setTimeout(() => {
            setAnimatedPipes((animPrev) => {
              const next = new Set(animPrev);
              for (let i = prev; i < count; i++) {
                next.add(i);
              }
              return next;
            });
          }, 50);
        }
        return count;
      });
    });

    return () => {
      api.removeAllListeners('dynamic-island-state');
      api.removeAllListeners('dynamic-island-hotmic');
      api.removeAllListeners('dynamic-island-standard-audio-level');
      api.removeAllListeners('dynamic-island-hotmic-filter-meter');
      api.removeAllListeners('dynamic-island-stack-changed');
    };
  }, [resetWaveform]);

  // Update waveform ring buffer when audio levels arrive.
  useEffect(() => {
    if (waveformSettled) return;
    const level = state === 'recording' ? standardAudioLevel : filterMeterRawLevel;
    if (state !== 'recording' && !hotMicActive) return;
    const buf = waveformBufferRef.current;
    buf.push(level);
    setWaveformLevels(buf.getOrdered().map(scaleAudioLevel));
  }, [filterMeterRawLevel, standardAudioLevel, hotMicActive, state, waveformSettled]);

  const waveformSlotMargin = pipeCount > 0 ? (floating ? FLOATING_WAVEFORM_STACK_GAP : 8) : 0;
  const pipeSlotWidth = floating ? floatingPipeSlotWidthForCount(pipeCount) : pipeSlotWidthForCount(pipeCount);
  const floatingWaveformBalanceWidth = floating && waveformActive && pipeCount > 0
    ? waveformSlotMargin + pipeSlotWidth
    : 0;
  const displayedWaveformLevels = waveformSettled
    ? STATIC_WAVEFORM_LEVELS
    : waveformLevels;

  const rightSlotSum = computeRightPillWidth({ waveformActive, pipeCount });
  useEffect(() => {
    onSlotSumChange?.(rightSlotSum);
  }, [rightSlotSum, onSlotSumChange]);

  return (
    <div
      className={`di-section di-section--right${floating ? ' di-section--floating' : ''}`}
      style={{
        width: sectionWidth,
        height: 38,
        transitionDelay: sectionTransitionDelay,
        WebkitAppRegion: floating ? 'drag' : undefined,
      } as React.CSSProperties}
    >
      <PillSlot visible={floatingWaveformBalanceWidth > 0} width={floatingWaveformBalanceWidth} marginRight={0}>
        <div aria-hidden="true" />
      </PillSlot>
      <PillSlot visible={waveformActive} width={WAVEFORM_WIDTH} marginRight={waveformSlotMargin}>
        <div aria-hidden="true" style={rightStyles.waveformContainer}>
          <WaveformBars levels={displayedWaveformLevels} color={waveformColor} />
        </div>
      </PillSlot>
      <PillSlot visible={pipeCount > 0} width={pipeSlotWidth} marginRight={0}>
        <div style={rightStyles.pipeGroup}>
          {Array.from({ length: Math.min(pipeCount, 3) }, (_, i) => (
            <span key={i} style={{ ...rightStyles.pipeChar, opacity: animatedPipes.has(i) ? 1 : 0 }}>|</span>
          ))}
          {pipeCount > 3 && (
            <span style={rightStyles.pipeOverflow}>+{pipeCount - 3}</span>
          )}
        </div>
      </PillSlot>
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
  waveformContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5px',
    height: '14px',
  },
  pipeGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  pipeChar: {
    fontSize: '11px',
    fontWeight: 300,
    color: 'rgba(255, 255, 255, 0.78)',
    lineHeight: 1,
    transition: 'opacity 0.2s ease-in',
  },
  pipeOverflow: {
    fontSize: '8px',
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.78)',
    marginLeft: '2px',
  },
};

// =============================================================================
// Center filler — keeps the island visually contiguous across notched,
// mirrored, and external display layouts.
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
  const [drawerTextSize, setDrawerTextSize] = useState(DRAWER_TEXT_SIZE_DEFAULT);
  const [showLeadingContext, setShowLeadingContext] = useState(true);
  const [fadingLeadingContext, setFadingLeadingContext] = useState(false);
  const [tailRevealTargetCount, setTailRevealTargetCount] = useState(0);
  const [tailRevealCount, setTailRevealCount] = useState(0);
  const leadingContextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadingContextCollapseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tailRevealStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tailRevealResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptActiveRef = useRef(false);
  const previousRawTextRef = useRef('');
  const showLeadingContextRef = useRef(true);

  const compactText = summarizeDrawerTranscript(text, {
    leadingWords: DRAWER_LEADING_WORDS,
    trailingWords: DRAWER_TRAILING_WORDS,
    showLeadingContext,
  });
  const {
    leadingText,
    trailingWords,
  } = splitDrawerTranscriptForRender(compactText, showLeadingContext);
  const normalizedTailRevealTarget = Math.max(0, Math.min(tailRevealTargetCount, trailingWords.length));
  const normalizedTailRevealCount = Math.max(0, Math.min(tailRevealCount, normalizedTailRevealTarget));
  const revealStartIndex = trailingWords.length - normalizedTailRevealTarget;
  const revealEndExclusive = revealStartIndex + normalizedTailRevealCount;
  const normalizedDrawerTextSize = clampDrawerTextSize(drawerTextSize);
  const drawerLineHeight = Math.max(16, Math.round(normalizedDrawerTextSize * 1.3));

  useEffect(() => {
    showLeadingContextRef.current = showLeadingContext;
  }, [showLeadingContext]);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onDrawerTranscript?.((t: string) => {
      const normalized = t.trim().replace(/\s+/g, ' ');
      const previousRawText = previousRawTextRef.current;
      const appendedCount = countAppendedWords(
        previousRawText,
        normalized,
        DRAWER_WORD_ENTER_MAX_WORDS
      );
      previousRawTextRef.current = normalized;

      setText(t);
      const hasText = t.trim().length > 0;
      if (!hasText) {
        transcriptActiveRef.current = false;
        previousRawTextRef.current = '';
        setShowLeadingContext(true);
        showLeadingContextRef.current = true;
        setFadingLeadingContext(false);
        setTailRevealTargetCount(0);
        setTailRevealCount(0);
        if (leadingContextTimerRef.current) {
          clearTimeout(leadingContextTimerRef.current);
          leadingContextTimerRef.current = null;
        }
        if (leadingContextCollapseRef.current) {
          clearTimeout(leadingContextCollapseRef.current);
          leadingContextCollapseRef.current = null;
        }
        if (tailRevealStepTimerRef.current) {
          clearTimeout(tailRevealStepTimerRef.current);
          tailRevealStepTimerRef.current = null;
        }
        if (tailRevealResetTimerRef.current) {
          clearTimeout(tailRevealResetTimerRef.current);
          tailRevealResetTimerRef.current = null;
        }
        return;
      }

      if (appendedCount > 0) {
        const target = Math.min(DRAWER_WORD_ENTER_MAX_WORDS, appendedCount);

        if (tailRevealStepTimerRef.current) {
          clearTimeout(tailRevealStepTimerRef.current);
          tailRevealStepTimerRef.current = null;
        }
        if (tailRevealResetTimerRef.current) {
          clearTimeout(tailRevealResetTimerRef.current);
          tailRevealResetTimerRef.current = null;
        }

        setTailRevealTargetCount(target);
        // Reveal first word immediately to reduce perceived lag; stagger only
        // the remaining words in the batch.
        setTailRevealCount(1);

        if (target <= 1) {
          tailRevealResetTimerRef.current = setTimeout(() => {
            tailRevealResetTimerRef.current = null;
            setTailRevealTargetCount(0);
            setTailRevealCount(0);
          }, DRAWER_WORD_ENTER_DURATION_MS);
          return;
        }

        let nextVisibleCount = 1;
        const revealNext = () => {
          nextVisibleCount += 1;
          setTailRevealCount(nextVisibleCount);
          if (nextVisibleCount >= target) {
            tailRevealStepTimerRef.current = null;
            tailRevealResetTimerRef.current = setTimeout(() => {
              tailRevealResetTimerRef.current = null;
              setTailRevealTargetCount(0);
              setTailRevealCount(0);
            }, DRAWER_WORD_ENTER_DURATION_MS);
            return;
          }
          tailRevealStepTimerRef.current = setTimeout(revealNext, DRAWER_WORD_ENTER_STAGGER_MS);
        };

        tailRevealStepTimerRef.current = setTimeout(revealNext, DRAWER_WORD_ENTER_STAGGER_MS);
      }

      if (!transcriptActiveRef.current) {
        transcriptActiveRef.current = true;
        setShowLeadingContext(true);
        showLeadingContextRef.current = true;
        setFadingLeadingContext(false);
        if (leadingContextTimerRef.current) {
          clearTimeout(leadingContextTimerRef.current);
        }
        if (leadingContextCollapseRef.current) {
          clearTimeout(leadingContextCollapseRef.current);
          leadingContextCollapseRef.current = null;
        }
        leadingContextTimerRef.current = setTimeout(() => {
          leadingContextTimerRef.current = null;
          setFadingLeadingContext(true);
          leadingContextCollapseRef.current = setTimeout(() => {
            leadingContextCollapseRef.current = null;
            setShowLeadingContext(false);
            showLeadingContextRef.current = false;
            setFadingLeadingContext(false);
          }, 220);
        }, DRAWER_LEADING_CONTEXT_HOLD_MS);
      }
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
      api?.removeAllListeners('dynamic-island-drawer-text-size');
      if (leadingContextTimerRef.current) {
        clearTimeout(leadingContextTimerRef.current);
        leadingContextTimerRef.current = null;
      }
      if (leadingContextCollapseRef.current) {
        clearTimeout(leadingContextCollapseRef.current);
        leadingContextCollapseRef.current = null;
      }
      if (tailRevealStepTimerRef.current) {
        clearTimeout(tailRevealStepTimerRef.current);
        tailRevealStepTimerRef.current = null;
      }
      if (tailRevealResetTimerRef.current) {
        clearTimeout(tailRevealResetTimerRef.current);
        tailRevealResetTimerRef.current = null;
      }
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
            <span style={{ opacity: fadingLeadingContext ? 0 : 1, transition: 'opacity 0.2s ease' }}>
              {leadingText}
              {trailingWords.length > 0 ? ' ' : ''}
            </span>
          )}
          {trailingWords.length > 0 && (
            <span
              style={showLeadingContext ? undefined : drawerStyles.carouselStrip}
            >
              {trailingWords.map((word, index) => {
                const isInRevealSlice = normalizedTailRevealTarget > 0
                  && index >= revealStartIndex
                  && index < revealEndExclusive;
                const isPendingReveal = normalizedTailRevealTarget > 0
                  && index >= revealStartIndex
                  && index >= revealEndExclusive;
                if (isPendingReveal) {
                  return null;
                }
                const shouldAnimateEnter = isInRevealSlice;
                const visual = getCarouselWordVisual(index, trailingWords.length);
                const wordClassName = shouldAnimateEnter
                  ? 'di-drawer-word di-drawer-word-enter'
                  : 'di-drawer-word';
                const wordStyle: React.CSSProperties = {};
                if (index < trailingWords.length - 1) {
                  wordStyle.marginRight = '0.22em';
                }
                if (shouldAnimateEnter) {
                  wordStyle.animationDuration = `${DRAWER_WORD_ENTER_DURATION_MS}ms`;
                }
                return (
                  <span
                    key={`${index}-${word}`}
                    className={wordClassName}
                    style={wordStyle}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        opacity: visual.opacity,
                        transform: `scale(${visual.scale})`,
                        filter: `blur(${visual.blurPx}px)`,
                        transition: 'opacity 120ms linear, transform 160ms ease-out, filter 160ms ease-out',
                        transformOrigin: 'center',
                      }}
                    >
                      {word}
                    </span>
                  </span>
                );
              })}
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
    textOverflow: 'clip',
    display: 'block',
    width: '100%',
    textAlign: 'left',
    lineHeight: '18px',
  },
  carouselStrip: {
    display: 'inline-block',
    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 100%)',
    maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 100%)',
  },
};

// =============================================================================
/** Renders the real-time waveform driven by audio level data. */
function WaveformBars({ levels, color }: { levels: number[]; color: string }) {
  return (
    <>
      {levels.map((level, i) => (
        <div
          key={i}
          style={{
            width: '2px',
            borderRadius: '1px',
            backgroundColor: color,
            height: `${Math.max(2, Math.round(level * 14))}px`,
            opacity: 0.5 + 0.5 * level,
            transition: 'height 0.08s ease-out, opacity 0.08s ease-out',
          }}
          data-waveform-bar="true"
        />
      ))}
    </>
  );
}

// =============================================================================
// Left pill — mode toggle + history controls
// =============================================================================

interface LeftPillProps {
  sectionWidth?: number;
  onSlotSumChange?: (sum: number) => void;
  sectionTransitionDelay?: string;
}
function LeftPill({ sectionWidth, onSlotSumChange, sectionTransitionDelay }: LeftPillProps = {}) {
  const [state, setState] = useState<IslandState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [isFinal, setIsFinal] = useState<boolean>(false);
  const [commands, setCommands] = useState<CommandHighlight[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [hotMicActive, setHotMicActive] = useState(false);
  const [stackCount, setStackCount] = useState(0);
  const [historyWordsPerLine, setHistoryWordsPerLine] = useState(10);
  const [voiceTuningVisible, setVoiceTuningVisible] = useState(false);
  const [backgroundFilterEnabled, setBackgroundFilterEnabled] = useState(false);
  const [backgroundFilterStrength, setBackgroundFilterStrength] = useState(50);
  const [filterMeter, setFilterMeter] = useState<HotMicFilterMeter>({
    enabled: false,
    strength: 50,
    rawLevel: 0,
    acceptedLevel: 0,
    threshold: 0,
    speechRatio: 0,
    chunkSuppressed: false,
  });
  const [runtimeStatus, setRuntimeStatus] = useState<HotMicRuntimeStatus>({
    state: 'idle',
    condition: null,
    engineReady: false,
    whisperFallbackActive: false,
    queueDepth: 0,
    lastChunkAgeMs: null,
    chunksReceived: 0,
    micHealthy: true,
    engine: null,
    timing: {
      chunkIntervalMs: null,
      queueWaitMs: null,
      transcribeMs: null,
      postProcessMs: null,
      totalPipelineMs: null,
      avgTranscribeMs: null,
      avgTotalPipelineMs: null,
    },
  });

  const transcriptRef = useRef<HTMLDivElement>(null);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Waveform: ring buffer of recent audio levels for visualization (hot-mic and standard).
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
      if (newState === 'idle') {
        setStackCount(0);
      }
    });

    api.onStackChanged?.((count: number) => {
      setStackCount(count);
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

    api.onHotMicUpdate?.((data: { active: boolean }) => {
      setHotMicActive(Boolean(data?.active));
    });

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
    api.onHotMicRuntimeStatus?.((status: HotMicRuntimeStatus) => {
      setRuntimeStatus(status);
    });

    api.requestHistory();

    return () => {
      api.removeAllListeners('dynamic-island-state');
      api.removeAllListeners('dynamic-island-transcript');
      api.removeAllListeners('dynamic-island-command');
      api.removeAllListeners('dynamic-island-history');
      api.removeAllListeners('dynamic-island-hide-history');
      api.removeAllListeners('dynamic-island-show-history');
      api.removeAllListeners('dynamic-island-hotmic');
      api.removeAllListeners('dynamic-island-hotmic-filter-meter');
      api.removeAllListeners('dynamic-island-hotmic-runtime');
      api.removeAllListeners('dynamic-island-stack-changed');
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

  const toggleHistory = useCallback(() => {
    // Keep hamburger decoupled from left-pill geometry:
    // it only toggles the main history window now.
    (window as any).dynamicIslandAPI?.openFieldTheory?.();
  }, []);

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
  const formatMs = (value: number | null): string => (
    value === null ? '--' : `${Math.max(0, Math.round(value))}ms`
  );
  const chunkAgeLabel = formatMs(runtimeStatus.lastChunkAgeMs);
  const chunkIntervalLabel = formatMs(runtimeStatus.timing.chunkIntervalMs);
  const queueWaitLabel = formatMs(runtimeStatus.timing.queueWaitMs);
  const asrMsLabel = formatMs(runtimeStatus.timing.transcribeMs);
  const postMsLabel = formatMs(runtimeStatus.timing.postProcessMs);
  const totalPipelineLabel = formatMs(runtimeStatus.timing.totalPipelineMs);
  const avgAsrMsLabel = formatMs(runtimeStatus.timing.avgTranscribeMs);
  const avgTotalPipelineLabel = formatMs(runtimeStatus.timing.avgTotalPipelineMs);
  const runtimeConditionLabel = runtimeStatus.condition ?? 'idle';
  const engineLabel = runtimeStatus.engine?.selectedEngine ?? 'n/a';
  const readinessLabel = runtimeStatus.engine?.readiness ?? 'n/a';
  const healthLabel = runtimeStatus.micHealthy ? 'mic ok' : 'mic stale';
  const healthTone = runtimeStatus.micHealthy ? styles.hudPillGood : styles.hudPillWarn;
  const pressureTone =
    runtimeStatus.queueDepth >= 4 || (runtimeStatus.lastChunkAgeMs ?? 0) >= 1800
      ? styles.hudPillWarn
      : styles.hudPillGood;

  const expanded = hotMicActive || state === 'recording' || state === 'silentStacking' || (state === 'idle' && stackCount > 0);
  const historyChipVisible = !(hotMicActive || state === 'recording' || state === 'silentStacking');

  const leftSlotSum = computeLeftPillWidth({
    xExpanded: expanded,
    agentsSlotSum: 0,
    hamburgerExpanded: historyChipVisible,
  });
  useEffect(() => {
    onSlotSumChange?.(leftSlotSum);
  }, [leftSlotSum, onSlotSumChange]);

  const handleCancelSession = useCallback(() => {
    (window as any).dynamicIslandAPI?.cancelSession?.();
  }, []);

  return (
    <div
      className={historyVisible ? 'di-history-visible' : ''}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        height: '100%',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      }}
    >
      <div
        className="di-section di-section--left"
        style={{ width: sectionWidth, height: 38, transitionDelay: sectionTransitionDelay }}
      >
        <PillSlot
          visible={expanded}
          marginRight={historyChipVisible ? 8 : 0}
          onClick={handleCancelSession}
          title="cancel session"
          style={{ opacity: 0.5 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="rgba(255,255,255,0.78)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </PillSlot>
        <PillSlot
          visible={historyChipVisible}
          marginRight={0}
          onClick={toggleHistory}
          title="transcript history"
        >
          <svg width="12" height="8" viewBox="0 0 14 10" fill="none" shapeRendering="crispEdges" aria-hidden="true">
            <path d="M0 1H14V2H0V1Z" fill="rgba(255,255,255,0.78)" />
            <path d="M0 5H10V6H0V5Z" fill="rgba(255,255,255,0.78)" />
            <path d="M0 9H14V10H0V9Z" fill="rgba(255,255,255,0.78)" />
          </svg>
        </PillSlot>
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
              <div style={styles.runtimeHud}>
                <div style={styles.runtimeHudHeader}>
                  <span style={styles.runtimeHudTitle}>live hud</span>
                  <span style={{ ...styles.runtimeHudPill, ...healthTone }}>{healthLabel}</span>
                  <span style={{ ...styles.runtimeHudPill, ...pressureTone }}>q{runtimeStatus.queueDepth}</span>
                </div>
                <div style={styles.runtimeHudStatLine}>
                  age {chunkAgeLabel} · chunks {runtimeStatus.chunksReceived}
                </div>
                <div style={styles.runtimeHudStatLine}>
                  cad {chunkIntervalLabel} · qwait {queueWaitLabel} · asr {asrMsLabel} · post {postMsLabel} · total {totalPipelineLabel}
                </div>
                <div style={styles.runtimeHudMetaLine}>
                  avg asr {avgAsrMsLabel} · avg total {avgTotalPipelineLabel}
                </div>
                <div style={styles.runtimeHudMetaLine}>
                  {engineLabel} · {readinessLabel} · {runtimeConditionLabel}
                  {runtimeStatus.whisperFallbackActive ? ' · fallback' : ''}
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
    height: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
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

  runtimeHud: {
    marginTop: '4px',
    padding: '6px',
    borderRadius: '8px',
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },

  runtimeHudHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },

  runtimeHudTitle: {
    fontSize: '9.5px',
    color: 'rgba(255, 255, 255, 0.55)',
    textTransform: 'lowercase',
    marginRight: 'auto',
  },

  runtimeHudPill: {
    padding: '1px 5px',
    borderRadius: '999px',
    fontSize: '9px',
    fontWeight: 600,
    letterSpacing: '0.01em',
  },

  hudPillGood: {
    color: 'rgba(34, 197, 94, 0.96)',
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
  },

  hudPillWarn: {
    color: 'rgba(255, 159, 10, 0.97)',
    backgroundColor: 'rgba(255, 159, 10, 0.18)',
  },

  runtimeHudStatLine: {
    fontSize: '10px',
    color: 'rgba(255, 255, 255, 0.78)',
    fontVariantNumeric: 'tabular-nums',
    textTransform: 'lowercase',
  },

  runtimeHudMetaLine: {
    fontSize: '9.5px',
    color: 'rgba(255, 255, 255, 0.56)',
    textTransform: 'lowercase',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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
  .di-history-visible .di-left-pill {
    margin-left: ${HISTORY_PILL_OFFSET_PX}px !important;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes waveformPulse {
    0%, 100% { transform: scaleY(0.15); }
    50% { transform: scaleY(1); }
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeInIsland {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
  @keyframes drawerWordEnter {
    from {
      opacity: 0;
      filter: blur(1.1px);
    }
    to {
      opacity: 1;
      filter: blur(0);
    }
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
  .di-cancel-btn:hover {
    opacity: 1 !important;
  }
  .di-drawer-word {
    display: inline-block;
  }
  .di-drawer-word-enter {
    animation: drawerWordEnter 0.18s ease-out;
    animation-fill-mode: both;
    will-change: opacity, filter;
  }
`;
document.head.appendChild(styleSheet);

// =============================================================================
// Unified island — single bar spanning left pill, notch gap, and right pill.
// =============================================================================

function UnifiedIsland() {
  // Main sizes the Electron window (and these outer wrappers) to fit the MAX
  // possible pill for the current state; renderer computes the ACTUAL pill
  // width from visible slots and animates the inner section within.
  // The notch stays centered because outer wrappers are symmetric and the
  // middle strip is the fixed notch width.
  const initParams = new URLSearchParams(window.location.search);
  const initRightW = parseInt(initParams.get('rightWidth') || '72', 10);
  const initLeftW = parseInt(initParams.get('leftWidth') || '72', 10);
  const [outerLeft, setOuterLeft] = useState(initLeftW);
  const [outerRight, setOuterRight] = useState(initRightW);
  const [leftSum, setLeftSum] = useState(0);
  const [rightSum, setRightSum] = useState(0);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onResize?.((data: { leftWidth: number; rightWidth: number }) => {
      setOuterLeft(data.leftWidth);
      if (data.rightWidth !== undefined) setOuterRight(data.rightWidth);
    });
  }, []);

  const pillWidth = Math.max(leftSum, rightSum);

  // Shrink the section AFTER slot content has faded; grow is instant so the
  // slot has room to open into. Delaying shrink keeps flex-end-anchored
  // dots still during the fade, then both collapse in sync.
  const prevPillWidthRef = useRef(pillWidth);
  const sectionTransitionDelay =
    pillWidth < prevPillWidthRef.current ? `${PILL_SLOT_CONTENT_FADE_MS}ms` : '0ms';
  useEffect(() => {
    prevPillWidthRef.current = pillWidth;
  }, [pillWidth]);

  useEffect(() => {
    const clipLeft = pillWidth > outerLeft;
    const clipRight = pillWidth > outerRight;
    const api = (window as any).dynamicIslandAPI;
    api?.debugRender?.({
      leftSum, rightSum, section: pillWidth,
      outerLeft, outerRight,
      clipLeft, clipRight,
      windowInnerWidth: window.innerWidth,
    });
  }, [leftSum, rightSum, pillWidth, outerLeft, outerRight]);

  return (
    <div style={{
      display: 'flex',
      width: '100%',
      height: '100%',
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: outerLeft,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        pointerEvents: 'none',
      }}>
        <LeftPill sectionWidth={pillWidth} onSlotSumChange={setLeftSum} sectionTransitionDelay={sectionTransitionDelay} />
      </div>
      <div style={{ flex: 1, height: 38, background: '#000' }} />
      <div style={{
        width: outerRight,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        pointerEvents: 'none',
      }}>
        <RightPill sectionWidth={pillWidth} onSlotSumChange={setRightSum} sectionTransitionDelay={sectionTransitionDelay} />
      </div>
    </div>
  );
}

function FloatingPill() {
  const initParams = new URLSearchParams(window.location.search);
  const initRightW = parseInt(initParams.get('rightWidth') || String(FLOATING_CONTENT_FALLBACK_WIDTH), 10);
  const [rightWidth, setRightWidth] = useState(Number.isFinite(initRightW) ? initRightW : FLOATING_CONTENT_FALLBACK_WIDTH);
  const [hovered, setHovered] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = (window as any).dynamicIslandAPI;
    api?.onResize?.((data: { leftWidth: number; rightWidth: number }) => {
      setRightWidth(data.rightWidth ?? data.leftWidth ?? FLOATING_CONTENT_FALLBACK_WIDTH);
    });

    api?.onStateChange?.((state: string) => {
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
      if (state === 'completing') {
        completeTimerRef.current = setTimeout(() => {
          completeTimerRef.current = null;
          setFadingOut(true);
        }, FLOATING_COMPLETE_SETTLE_MS);
      } else if (state !== 'idle') {
        setFadingOut(false);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (cancelTimerRef.current) {
        clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = null;
      }
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
        completeTimerRef.current = null;
      }
    };
  }, []);

  const openFieldTheory = useCallback(() => {
    (window as any).dynamicIslandAPI?.openFieldTheory?.();
  }, []);

  const cancelSession = useCallback(() => {
    if (cancelTimerRef.current) return;
    setFadingOut(true);
    cancelTimerRef.current = setTimeout(() => {
      cancelTimerRef.current = null;
      (window as any).dynamicIslandAPI?.cancelSession?.();
    }, FLOATING_CANCEL_FADE_MS);
  }, []);

  return (
    <div
      className="di-floating-shell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        padding: '0 6px',
        boxSizing: 'border-box',
        borderRadius: '19px',
        background: '#000',
        opacity: fadingOut ? 0 : 1,
        pointerEvents: fadingOut ? 'none' : 'auto',
        transition: `opacity ${FLOATING_CANCEL_FADE_MS}ms ease`,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <button
        type="button"
        className="di-floating-button di-floating-open"
        title="open Field Theory"
        aria-label="open Field Theory"
        onClick={openFieldTheory}
        style={{
          ...floatingButtonStyle,
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered && !fadingOut ? 'auto' : 'none',
        }}
      >
        <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden="true">
          <path d="M2 3H12M2 6H12M2 9H12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <RightPill sectionWidth={rightWidth} floating />
      <button
        type="button"
        className="di-floating-button di-floating-cancel"
        title="cancel session"
        aria-label="cancel session"
        disabled={fadingOut}
        onClick={cancelSession}
        style={{
          ...floatingButtonStyle,
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered && !fadingOut ? 'auto' : 'none',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="rgba(255,255,255,0.78)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const floatingButtonStyle = {
  width: '22px',
  height: '22px',
  flex: '0 0 22px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: 'opacity 140ms ease',
  color: 'rgba(255,255,255,0.78)',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

// =============================================================================
// Root — delegates to left or right pill based on query param
// =============================================================================

export default function DynamicIsland() {
  useTransparentBackingGuard();

  if (side === 'drawer') return <DrawerPill />;
  if (side === 'right') return <RightPill />;
  if (side === 'filler') return <GapFill />;
  if (side === 'unified') return <UnifiedIsland />;
  if (side === 'floating') return <FloatingPill />;
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
      onHotMicRuntimeStatus?: (cb: (status: HotMicRuntimeStatus) => void) => void;
      onStackChanged?: (cb: (count: number) => void) => void;
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
      onAgentsChange?: (cb: (agents: Array<{
        agentId: string;
        tool: 'claude' | 'codex';
        pid: number;
        cwd: string;
        ttyTitle: string;
        terminalApp: string;
        waitingSince: number;
      }>) => void) => void;
      onAgentLayout?: (cb: (layout: {
        kind: 'row' | 'grid';
        slots: Array<{ position: number; agentIds: string[] }>;
        unmatched: string[];
      } | null) => void) => void;
      focusAgent?: (agentId: string) => Promise<boolean>;
      removeAllListeners: (channel: string) => void;
    };
  }
}
