/**
 * CouncilPanel — Debate viewer and launcher.
 *
 * Two states:
 * 1. Idle: topic input + options + start button
 * 2. Active: streaming debate turns with stop button
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

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

// =============================================================================
// Styles
// =============================================================================

const SPEAKER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Claude': { bg: '#1e3a5f', text: '#93c5fd', border: '#3b82f6' },
  'Claude A': { bg: '#1e3a5f', text: '#93c5fd', border: '#3b82f6' },
  'Codex': { bg: '#1a3d2e', text: '#86efac', border: '#22c55e' },
  'Claude B': { bg: '#3d1a3d', text: '#d8b4fe', border: '#a855f7' },
};

const DEFAULT_SPEAKER_COLOR = { bg: '#2d2d2d', text: '#e5e5e5', border: '#525252' };

function getSpeakerColor(speaker: string) {
  return SPEAKER_COLORS[speaker] || DEFAULT_SPEAKER_COLOR;
}

// =============================================================================
// Component
// =============================================================================

export function CouncilPanel() {
  const [isDark, setIsDark] = useState(true);
  const [topic, setTopic] = useState('');
  const [opusVsOpus, setOpusVsOpus] = useState(true);
  const [debateState, setDebateState] = useState<DebateState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentTurn, setCurrentTurn] = useState<Turn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [activeTopic, setActiveTopic] = useState('');
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

  // Subscribe to events
  useEffect(() => {
    // Throttle UI updates for turn_chunk events
    let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubEvent = councilAPI.onEvent((event) => {
      switch (event.type) {
        case 'debate_start':
          setActiveTopic(event.topic);
          break;

        case 'turn_start':
          // Commit any previous in-progress turn
          commitPendingTurn();
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

        case 'debate_complete':
          if (chunkFlushTimer) {
            clearTimeout(chunkFlushTimer);
            chunkFlushTimer = null;
          }
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
  }, [commitPendingTurn]);

  const handleStart = useCallback(async () => {
    if (!topic.trim()) return;
    setError(null);
    setTurns([]);
    setCurrentTurn(null);
    setDebateState('starting');

    const result = await councilAPI.start({
      topic: topic.trim(),
      opusVsOpus,
    });

    if (!result.success) {
      setError(result.error || 'Failed to start debate');
      setDebateState('error');
    }
  }, [topic, opusVsOpus]);

  const handleStop = useCallback(async () => {
    await councilAPI.stop();
  }, []);

  const handleNewDebate = useCallback(() => {
    setDebateState('idle');
    setTurns([]);
    setCurrentTurn(null);
    setActiveTopic('');
    setTopic('');
    setError(null);
    pendingTurnRef.current = null;
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  }, [handleStart]);

  const copyTurn = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);

  const isActive = debateState !== 'idle' && debateState !== 'error';
  const allTurns = currentTurn ? [...turns, currentTurn] : turns;

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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: mutedColor,
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={opusVsOpus}
                  onChange={(e) => setOpusVsOpus(e.target.checked)}
                  style={{ margin: 0 }}
                />
                Opus vs Opus
              </label>
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
          const colors = getSpeakerColor(turn.speaker);
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
