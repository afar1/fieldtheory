/**
 * CouncilPanel — Debate viewer and launcher.
 *
 * Two states:
 * 1. Idle: topic input + options + start button
 * 2. Active: streaming debate turns with stop button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  clampCouncilMaxTurns,
  CouncilTurnActivityState,
  COUNCIL_MATCHUP_OPTIONS,
  DEFAULT_COUNCIL_MATCHUP,
  DEFAULT_COUNCIL_MAX_TURNS,
  formatCouncilElapsed,
  formatCouncilMatchup,
  getCouncilSpeakerColor,
  getCouncilTurnActivityState,
  MAX_COUNCIL_MAX_TURNS,
  MIN_COUNCIL_MAX_TURNS,
} from '../utils/council';

const councilAPI = window.councilAPI!;
const themeAPI = window.themeAPI;

// =============================================================================
// Types
// =============================================================================

interface Turn {
  speaker: string;
  content: string;
  round: string;
  convergence?: string;
  action?: string;
  complete: boolean;
}

type DebateState = 'idle' | 'starting' | 'debating' | 'finalizing' | 'done' | 'error';

interface CouncilDiagnostic {
  speaker: string;
  message: string;
  level: 'stderr' | 'error';
  atMs: number;
}

function getActivityDotStyle(activity: CouncilTurnActivityState | null, nowMs: number): React.CSSProperties {
  const tone = activity?.tone ?? 'working';
  const colors = {
    working: '#3b82f6',
    quiet: '#94a3b8',
    warning: '#f59e0b',
    error: '#ef4444',
  } as const;
  const pulse = 0.78 + ((Math.sin(nowMs / 260) + 1) * 0.16);
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: colors[tone],
    boxShadow: `0 0 0 4px ${colors[tone]}22`,
    transform: `scale(${pulse})`,
    opacity: tone === 'quiet' ? 0.7 : 1,
    flexShrink: 0,
  };
}

// =============================================================================
// Styles
// =============================================================================

// =============================================================================
// Component
// =============================================================================

export function CouncilPanel() {
  const [isDark, setIsDark] = useState(true);
  const [topic, setTopic] = useState('');
  const [matchup, setMatchup] = useState<CouncilMatchup>(DEFAULT_COUNCIL_MATCHUP);
  const [maxTurns, setMaxTurns] = useState(DEFAULT_COUNCIL_MAX_TURNS);
  const [debateState, setDebateState] = useState<DebateState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentTurn, setCurrentTurn] = useState<Turn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [activeTopic, setActiveTopic] = useState('');
  const [activeMatchup, setActiveMatchup] = useState<CouncilMatchup>(DEFAULT_COUNCIL_MATCHUP);
  const [turnStartedAtMs, setTurnStartedAtMs] = useState<number | null>(null);
  const [lastOutputAtMs, setLastOutputAtMs] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<CouncilDiagnostic[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, currentTurn]);

  // Get theme
  useEffect(() => {
    themeAPI?.getTheme?.().then(setIsDark);
    councilAPI.getPreferences?.().then((prefs) => {
      if (!prefs) return;
      setMatchup(prefs.defaultMatchup);
      setMaxTurns(prefs.defaultMaxTurns);
    });
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Check initial status
  useEffect(() => {
    councilAPI.getStatus().then((status) => {
      if (status.state !== 'idle') {
        setDebateState(status.state as DebateState);
        setCurrentRound(status.currentRound);
        if (status.topic) setActiveTopic(status.topic);
        if (status.matchup) setActiveMatchup(status.matchup);
        if (status.error) setError(status.error);
      }
    });
  }, []);

  // Use a ref to accumulate current turn content without re-rendering per chunk.
  // Only flush to state when the turn is complete or a new turn starts.
  const pendingTurnRef = useRef<Turn | null>(null);

  const commitPendingTurn = useCallback((overrides?: Partial<Turn>) => {
    const pending = pendingTurnRef.current;
    if (pending) {
      const committed = { ...pending, ...overrides, complete: true };
      setTurns((t) => [...t, committed]);
      pendingTurnRef.current = null;
      setCurrentTurn(null);
    }
  }, []);

  const addDiagnostic = useCallback((level: CouncilDiagnostic['level'], speaker: string, message: string) => {
    const normalizedMessage = message.replace(/\s+/g, ' ').trim();
    if (!normalizedMessage) {
      return;
    }
    setDiagnostics((items) => [
      ...items.slice(-5),
      {
        speaker,
        level,
        message: normalizedMessage.slice(0, 280),
        atMs: Date.now(),
      },
    ]);
  }, []);

  const isActive = debateState !== 'idle' && debateState !== 'error';
  const allTurns = currentTurn ? [...turns, currentTurn] : turns;

  // Subscribe to events
  useEffect(() => {
    // Throttle UI updates for turn_chunk events
    let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubEvent = councilAPI.onEvent((event) => {
      switch (event.type) {
        case 'debate_start':
          setActiveTopic(event.topic);
          if (event.matchup) setActiveMatchup(event.matchup);
          break;

        case 'turn_start':
          // Commit any previous in-progress turn
          commitPendingTurn();
          setTurnStartedAtMs(Date.now());
          setLastOutputAtMs(null);
          pendingTurnRef.current = {
            speaker: event.speaker,
            content: '',
            round: event.round,
            complete: false,
          };
          setCurrentTurn(pendingTurnRef.current);
          if (event.round !== 'final') {
            setCurrentRound(parseInt(event.round, 10) || 0);
          }
          break;

        case 'turn_chunk':
          setLastOutputAtMs(Date.now());
          if (pendingTurnRef.current) {
            pendingTurnRef.current = {
              ...pendingTurnRef.current,
              content: pendingTurnRef.current.content + event.content + '\n',
            };
          } else {
            pendingTurnRef.current = {
              speaker: event.speaker,
              content: event.content + '\n',
              round: '?',
              complete: false,
            };
          }
          // Throttle UI updates to ~60ms to avoid re-rendering per line
          if (!chunkFlushTimer) {
            chunkFlushTimer = setTimeout(() => {
              chunkFlushTimer = null;
              setCurrentTurn(pendingTurnRef.current);
            }, 60);
          }
          break;

        case 'turn_end':
          if (chunkFlushTimer) {
            clearTimeout(chunkFlushTimer);
            chunkFlushTimer = null;
          }
          setTurnStartedAtMs(null);
          setLastOutputAtMs(null);
          commitPendingTurn({
            convergence: event.convergence,
            action: event.action,
          });
          break;

        case 'state_change':
          if (event.to === 'FINALIZING') {
            setDebateState('finalizing');
          }
          break;

        case 'stderr':
          addDiagnostic('stderr', event.speaker, event.content);
          break;

        case 'error':
          addDiagnostic('error', event.speaker, event.message);
          break;

        case 'debate_complete':
          if (chunkFlushTimer) {
            clearTimeout(chunkFlushTimer);
            chunkFlushTimer = null;
          }
          setTurnStartedAtMs(null);
          setLastOutputAtMs(null);
          commitPendingTurn();
          setDebateState('done');
          break;
      }
    });

    const unsubStatus = councilAPI.onStatusChanged((status) => {
      setDebateState(status.state as DebateState);
      setCurrentRound(status.currentRound);
      if (status.error) setError(status.error);
    });

    return () => {
      unsubEvent();
      unsubStatus();
      if (chunkFlushTimer) clearTimeout(chunkFlushTimer);
    };
  }, [addDiagnostic, commitPendingTurn]);

  useEffect(() => {
    if (!isActive && !currentTurn) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 400);
    return () => clearInterval(timer);
  }, [currentTurn?.round, currentTurn?.speaker, isActive]);

  const handleStart = useCallback(async () => {
    if (!topic.trim()) return;
    setError(null);
    setTurns([]);
    setCurrentTurn(null);
    setDiagnostics([]);
    setTurnStartedAtMs(null);
    setLastOutputAtMs(null);
    setDebateState('starting');

    const result = await councilAPI.start({
      topic: topic.trim(),
      matchup,
      maxTurns,
    });

    if (!result.success) {
      setError(result.error || 'Failed to start debate');
      setDebateState('error');
    }
  }, [topic, matchup, maxTurns]);

  const handleStop = useCallback(async () => {
    await councilAPI.stop();
  }, []);

  const handleNewDebate = useCallback(() => {
    setDebateState('idle');
    setTurns([]);
    setCurrentTurn(null);
    setActiveTopic('');
    setActiveMatchup(matchup);
    setTopic('');
    setError(null);
    setDiagnostics([]);
    setTurnStartedAtMs(null);
    setLastOutputAtMs(null);
    pendingTurnRef.current = null;
  }, [matchup]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  }, [handleStart]);

  const copyTurn = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const latestErrorForCurrentTurn = currentTurn
    ? diagnostics
        .slice()
        .reverse()
        .find((entry) => entry.level === 'error' && entry.speaker === currentTurn.speaker)?.message ?? null
    : null;

  const currentTurnActivity: CouncilTurnActivityState | null = currentTurn && turnStartedAtMs
    ? getCouncilTurnActivityState({
        speaker: currentTurn.speaker,
        startedAtMs: turnStartedAtMs,
        lastOutputAtMs,
        hasOutput: currentTurn.content.trim().length > 0,
        latestError: latestErrorForCurrentTurn,
        nowMs,
      })
    : null;

  const recentDiagnostics = diagnostics.slice(-3).reverse();

  // Colors
  const bg = isDark ? '#1a1a1a' : '#fafafa';
  const textColor = isDark ? '#e5e5e5' : '#1a1a1a';
  const mutedColor = isDark ? '#737373' : '#a3a3a3';
  const inputBg = isDark ? '#262626' : '#f5f5f5';
  const borderColor = isDark ? '#333' : '#e5e5e5';

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 13,
      color: textColor,
      background: bg,
      ...({ WebkitAppRegion: 'drag' } as any),
    }}>
      {/* Title bar spacer for hiddenInset */}
      <div style={{ height: 38, flexShrink: 0 }} />

      {/* Header */}
      <div style={{
        padding: '0 16px 12px',
        borderBottom: `1px solid ${borderColor}`,
        flexShrink: 0,
        ...({ WebkitAppRegion: 'no-drag' } as any),
      }}>
        {isActive ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  {activeTopic}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: debateState === 'done' ? '#166534' : debateState === 'finalizing' ? '#854d0e' : '#1e40af',
                    color: '#fff',
                  }}>
                    {debateState === 'done' ? 'Complete' : debateState === 'finalizing' ? 'Finalizing' : `Round ${currentRound}`}
                  </span>
                  <span style={{ fontSize: 11, color: mutedColor }}>
                    {formatCouncilMatchup(activeMatchup)}
                  </span>
                  <span style={{ fontSize: 11, color: mutedColor }}>
                    {allTurns.length} turns
                  </span>
                </div>
              </div>
              {debateState !== 'done' && (
                <button
                  onClick={handleStop}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#dc2626',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Stop
                </button>
              )}
              {debateState === 'done' && (
                <button
                  onClick={handleNewDebate}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: `1px solid ${borderColor}`,
                    background: 'transparent',
                    color: textColor,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  New Debate
                </button>
              )}
            </div>

            {debateState !== 'done' && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                background: isDark ? '#202020' : '#fff',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={getActivityDotStyle(currentTurnActivity, nowMs)} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
                      {currentTurnActivity
                        ? currentTurnActivity.headline
                        : debateState === 'starting'
                          ? 'Launching council process'
                          : 'Waiting for the next turn'}
                    </span>
                    <span style={{ fontSize: 11, color: mutedColor }}>
                      {currentTurnActivity
                        ? currentTurnActivity.detail
                        : debateState === 'starting'
                          ? 'Setting up the debate and waiting for the first model turn.'
                          : 'No model is actively streaming right now.'}
                    </span>
                  </div>
                </div>

                {recentDiagnostics.length > 0 && (
                  <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                    {recentDiagnostics.map((entry, index) => (
                      <div
                        key={`${entry.atMs}-${index}`}
                        style={{
                          padding: '7px 8px',
                          borderRadius: 6,
                          background: entry.level === 'error'
                            ? (isDark ? '#3b1111' : '#fef2f2')
                            : (isDark ? '#1f2937' : '#eff6ff'),
                          color: entry.level === 'error' ? '#fca5a5' : (isDark ? '#bfdbfe' : '#1d4ed8'),
                          fontSize: 11,
                          lineHeight: 1.4,
                        }}
                      >
                        <strong style={{ fontWeight: 600 }}>
                          {entry.speaker} {entry.level === 'error' ? 'error' : 'stderr'}
                        </strong>
                        {' '}
                        {entry.message}
                        <span style={{ color: mutedColor }}>
                          {' · '} {formatCouncilElapsed(Math.max(0, nowMs - entry.atMs))} ago
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Council
            </div>
            <input
              ref={inputRef}
              type="text"
              placeholder="What should the models debate?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${borderColor}`,
                background: inputBg,
                color: textColor,
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 84px auto',
              gap: 8,
              marginTop: 8,
              alignItems: 'center',
            }}>
              <select
                value={matchup}
                onChange={(e) => setMatchup(e.target.value as CouncilMatchup)}
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  background: inputBg,
                  color: textColor,
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                {COUNCIL_MATCHUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={MIN_COUNCIL_MAX_TURNS}
                max={MAX_COUNCIL_MAX_TURNS}
                value={maxTurns}
                onChange={(e) => setMaxTurns(clampCouncilMaxTurns(parseInt(e.target.value || '0', 10)))}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  background: inputBg,
                  color: textColor,
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                onClick={handleStart}
                disabled={!topic.trim()}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: topic.trim() ? '#2563eb' : (isDark ? '#333' : '#ddd'),
                  color: topic.trim() ? '#fff' : mutedColor,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: topic.trim() ? 'pointer' : 'default',
                }}
              >
                Start
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: mutedColor }}>
              Matchup and turn limit default from Council settings; this window can override them per debate.
            </div>
            {error && (
              <div style={{
                marginTop: 8,
                padding: '6px 10px',
                borderRadius: 6,
                background: isDark ? '#3b1111' : '#fef2f2',
                color: '#ef4444',
                fontSize: 12,
              }}>
                {error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Turns */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 16px',
          ...({ WebkitAppRegion: 'no-drag' } as any),
        }}
      >
        {allTurns.length === 0 && isActive && debateState === 'starting' && (
          <div style={{
            textAlign: 'center',
            padding: '40px 0',
            color: mutedColor,
            fontSize: 12,
          }}>
            Starting debate...
          </div>
        )}

        {allTurns.map((turn, i) => {
          const colors = getCouncilSpeakerColor(turn.speaker);
          const isCurrentTurn = !turn.complete && currentTurn?.speaker === turn.speaker && currentTurn?.round === turn.round;
          const turnActivity = isCurrentTurn ? currentTurnActivity : null;
          const showWaitingState = !turn.complete && !turn.content.trim();
          return (
            <div
              key={i}
              style={{
                marginBottom: 12,
                borderRadius: 8,
                border: `1px solid ${colors.border}30`,
                overflow: 'hidden',
              }}
            >
              {/* Turn header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: colors.bg,
                borderBottom: `1px solid ${colors.border}20`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.text,
                  }}>
                    {turn.speaker}
                  </span>
                  <span style={{ fontSize: 10, color: mutedColor }}>
                    {turn.round === 'final' ? 'Final Plan' : `Turn ${turn.round}`}
                  </span>
                  {turn.convergence && (
                    <span style={{
                      fontSize: 10,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: turn.convergence === 'high' ? '#166534' : turn.convergence === 'medium' ? '#854d0e' : '#7f1d1d',
                      color: '#fff',
                    }}>
                      {turn.convergence}
                    </span>
                  )}
                </div>
                {turn.complete && (
                  <button
                    onClick={() => copyTurn(turn.content)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: mutedColor,
                      fontSize: 10,
                      cursor: 'pointer',
                      padding: '2px 6px',
                    }}
                    title="Copy this turn"
                  >
                    Copy
                  </button>
                )}
              </div>

              {/* Turn content */}
              {showWaitingState ? (
                <div style={{ padding: '12px 12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={getActivityDotStyle(turnActivity, nowMs)} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
                        {turnActivity?.headline ?? `${turn.speaker} is working`}
                      </span>
                      <span style={{ fontSize: 11, color: mutedColor }}>
                        {turnActivity?.detail ?? 'Waiting for the first output from this turn.'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <pre style={{
                    margin: 0,
                    padding: '8px 10px',
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
                    color: textColor,
                    background: 'transparent',
                    maxHeight: 400,
                    overflowY: 'auto',
                  }}>
                    {turn.content}
                  </pre>
                  {!turn.complete && turnActivity && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '0 10px 10px',
                      color: mutedColor,
                      fontSize: 11,
                    }}>
                      <span style={getActivityDotStyle(turnActivity, nowMs)} />
                      <span>
                        {turnActivity.headline} · {turnActivity.detail}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {debateState === 'done' && (
          <div style={{
            textAlign: 'center',
            padding: '16px 0',
            color: mutedColor,
            fontSize: 12,
          }}>
            Debate complete — transcript saved to handoffs
          </div>
        )}
      </div>
    </div>
  );
}
