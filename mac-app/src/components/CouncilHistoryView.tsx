import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { fonts } from '../design/tokens';
import { useTheme } from '../contexts/ThemeContext';
import { formatRelativeTime } from '../utils/formatUtils';
import { formatCouncilMatchup } from '../utils/council';
import {
  buildCouncilHistoryEntries,
  extractCouncilTranscriptMeta,
  parseCouncilArtifactPath,
  type CouncilHistoryEntry,
} from '../utils/councilHistory';

type DetailMode = 'consensus' | 'transcript';

interface LoadedCouncilDetail {
  topic: string;
  matchup: string | null;
  transcriptContent: string | null;
  consensusContent: string | null;
}

interface CouncilStatusSnapshot {
  state: 'idle' | 'starting' | 'debating' | 'finalizing' | 'done' | 'error';
  currentRound: number;
  topic: string | null;
  error: string | null;
  matchup: string;
  transcriptPath: string | null;
  consensusPath: string | null;
}

function isCouncilActive(state: CouncilStatusSnapshot['state'] | undefined): boolean {
  return state === 'starting' || state === 'debating' || state === 'finalizing';
}

function getStatusTone(status: CouncilStatusSnapshot | null, theme: ReturnType<typeof useTheme>['theme']) {
  if (!status) {
    return {
      border: theme.border,
      background: theme.isDark ? theme.surface1 : '#fff',
      text: theme.textSecondary,
    };
  }

  if (status.state === 'error') {
    return {
      border: theme.error,
      background: theme.errorBg,
      text: theme.error,
    };
  }

  if (isCouncilActive(status.state)) {
    return {
      border: theme.info,
      background: theme.infoBg,
      text: theme.info,
    };
  }

  return {
    border: theme.border,
    background: theme.isDark ? theme.surface1 : '#fff',
    text: theme.textSecondary,
  };
}

export default function CouncilHistoryView() {
  const { theme } = useTheme();
  const [entries, setEntries] = useState<CouncilHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>('consensus');
  const [detail, setDetail] = useState<LoadedCouncilDetail | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [status, setStatus] = useState<CouncilStatusSnapshot | null>(null);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId],
  );
  const activeEntryId = useMemo(() => {
    if (!isCouncilActive(status?.state)) {
      return null;
    }

    const parsedStatusPath = status?.transcriptPath
      ? parseCouncilArtifactPath(status.transcriptPath)?.id
      : null;

    return parsedStatusPath ?? entries[0]?.id ?? null;
  }, [entries, status?.state, status?.transcriptPath]);

  const refreshHistory = useCallback(async () => {
    if (!window.commandsAPI?.getHandoffs) {
      setHistoryError('Council history is unavailable in this build.');
      setHistoryLoading(false);
      return;
    }

    setHistoryError(null);

    try {
      const handoffs = await window.commandsAPI.getHandoffs(40);
      const nextEntries = buildCouncilHistoryEntries(handoffs);
      setEntries(nextEntries);
      setSelectedId((current) => {
        if (current && nextEntries.some((entry) => entry.id === current)) {
          return current;
        }
        return nextEntries[0]?.id ?? null;
      });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Failed to load council history.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!window.councilAPI) {
      return;
    }

    window.councilAPI.getStatus().then((nextStatus) => {
      setStatus(nextStatus as CouncilStatusSnapshot);
    }).catch(() => {
      setStatus(null);
    });

    return window.councilAPI.onStatusChanged((nextStatus) => {
      setStatus(nextStatus as CouncilStatusSnapshot);
    });
  }, []);

  useEffect(() => {
    if (!isCouncilActive(status?.state)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshHistory();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshHistory, status?.state]);

  useEffect(() => {
    if (!selectedEntry) {
      setDetail(null);
      return;
    }

    if (!window.commandsAPI?.getHandoffContent) {
      setDetailError('Council artifact loading is unavailable in this build.');
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    const loadSelected = async () => {
      try {
        const [transcript, consensus] = await Promise.all([
          selectedEntry.transcriptPath ? window.commandsAPI!.getHandoffContent!(selectedEntry.transcriptPath) : Promise.resolve(null),
          selectedEntry.consensusPath ? window.commandsAPI!.getHandoffContent!(selectedEntry.consensusPath) : Promise.resolve(null),
        ]);

        if (cancelled) {
          return;
        }

        const transcriptMeta = transcript?.content
          ? extractCouncilTranscriptMeta(transcript.content)
          : { topic: null, matchup: null };

        setDetail({
          topic: transcriptMeta.topic ?? selectedEntry.topicPreview,
          matchup: transcriptMeta.matchup,
          transcriptContent: transcript?.content ?? null,
          consensusContent: consensus?.content ?? null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setDetailError(error instanceof Error ? error.message : 'Failed to load council artifact.');
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadSelected();

    return () => {
      cancelled = true;
    };
  }, [
    selectedEntry?.consensusLastModified,
    selectedEntry?.consensusPath,
    selectedEntry?.id,
    selectedEntry?.topicPreview,
    selectedEntry?.transcriptLastModified,
    selectedEntry?.transcriptPath,
  ]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }
    setDetailMode(selectedEntry.consensusPath ? 'consensus' : 'transcript');
  }, [selectedEntry?.consensusPath, selectedEntry?.id]);

  const detailContent = detailMode === 'consensus'
    ? detail?.consensusContent
    : detail?.transcriptContent;
  const statusTone = getStatusTone(status, theme);
  const selectedTopic = detail?.topic ?? selectedEntry?.topicPreview ?? 'Council debate';
  const selectedMatchup = detail?.matchup ?? null;

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        borderTop: `1px solid ${theme.border}`,
      }}
    >
      <aside
        style={{
          width: '260px',
          minWidth: '260px',
          borderRight: `1px solid ${theme.border}`,
          backgroundColor: theme.isDark ? theme.surface1 : '#fcfcfd',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px 10px 16px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
              Debate History
            </div>
            <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
              Recent council transcripts and combined conclusions
            </div>
          </div>
          <button
            onClick={() => void refreshHistory()}
            style={{
              padding: '5px 8px',
              fontSize: '10px',
              fontWeight: 600,
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
            }}
            title="Refresh council history"
          >
            Refresh
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {historyLoading ? (
            <div style={{ padding: '18px 16px', color: theme.textSecondary, fontSize: '12px' }}>
              Loading council debates...
            </div>
          ) : historyError ? (
            <div style={{ padding: '18px 16px', color: theme.error, fontSize: '12px' }}>
              {historyError}
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: '18px 16px', color: theme.textSecondary, fontSize: '12px', lineHeight: 1.5 }}>
              No council debates found yet. Start one with `/debate` and it will appear here.
            </div>
          ) : (
            entries.map((entry) => {
              const isSelected = entry.id === selectedEntry?.id;
              const isLive = entry.id === activeEntryId;

              return (
                <button
                  key={entry.id}
                  onClick={() => setSelectedId(entry.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 14px',
                    border: 'none',
                    borderBottom: `1px solid ${theme.border}`,
                    backgroundColor: isSelected
                      ? (theme.isDark ? theme.surface2 : '#fff')
                      : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: theme.text,
                      lineHeight: 1.35,
                      marginBottom: '6px',
                    }}
                  >
                    {entry.topicPreview}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {entry.consensusPath && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: theme.success,
                      }}>
                        Conclusion
                      </span>
                    )}
                    {!entry.consensusPath && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: theme.warning,
                      }}>
                        Transcript
                      </span>
                    )}
                    {isLive && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: theme.info,
                      }}>
                        Live
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '6px' }}>
                    Updated {formatRelativeTime(entry.lastModified)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.bg,
        }}
      >
        <div
          style={{
            padding: '18px 20px 14px 20px',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '20px',
                  lineHeight: 1.2,
                  fontWeight: 600,
                  color: theme.text,
                  fontFamily: fonts.sans,
                }}
              >
                {selectedTopic}
              </h2>
              <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '6px' }}>
                {selectedMatchup ? formatCouncilMatchup(selectedMatchup) : 'Council debate'}
                {selectedEntry ? ` · Updated ${formatRelativeTime(selectedEntry.lastModified)}` : ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {window.councilAPI && (
                <button
                  onClick={() => void window.councilAPI?.showWindow()}
                  style={{
                    padding: '7px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#fff',
                    backgroundColor: theme.accent,
                    border: 'none',
                    borderRadius: '7px',
                    cursor: 'pointer',
                  }}
                >
                  Show Window
                </button>
              )}
              {selectedEntry && (
                <button
                  onClick={() => void window.shellAPI?.showItemInFolder(
                    selectedEntry.consensusPath ?? selectedEntry.transcriptPath ?? '',
                  )}
                  style={{
                    padding: '7px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '7px',
                    cursor: 'pointer',
                  }}
                  disabled={!selectedEntry.consensusPath && !selectedEntry.transcriptPath}
                >
                  Show In Finder
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '10px 12px',
              border: `1px solid ${statusTone.border}`,
              borderRadius: '10px',
              backgroundColor: statusTone.background,
            }}
          >
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: statusTone.text }}>
                {isCouncilActive(status?.state)
                  ? 'Background debate active'
                  : status?.state === 'error'
                    ? 'Latest debate hit an error'
                    : 'Council runs in the background'}
              </div>
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '4px', lineHeight: 1.45 }}>
                {isCouncilActive(status?.state)
                  ? `Minimizing the dedicated Council window does not stop the debate. This tab will keep refreshing while it runs${status?.currentRound ? `, currently at round ${status.currentRound}.` : '.'}`
                  : status?.state === 'error'
                    ? (status.error ?? 'The last council run reported an error.')
                    : 'Use this tab to reopen prior transcripts and consensus without relying on the separate window.'}
              </div>
            </div>
            {status?.topic && (
              <div
                style={{
                  minWidth: '180px',
                  maxWidth: '240px',
                  fontSize: '11px',
                  color: theme.textSecondary,
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ color: theme.text }}>Now:</strong> {status.topic}
              </div>
            )}
          </div>

          {selectedEntry && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(['consensus', 'transcript'] as DetailMode[]).map((mode) => {
                const disabled = mode === 'consensus'
                  ? !selectedEntry.consensusPath
                  : !selectedEntry.transcriptPath;
                const selected = detailMode === mode;

                return (
                  <button
                    key={mode}
                    onClick={() => setDetailMode(mode)}
                    disabled={disabled}
                    style={{
                      padding: '6px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '999px',
                      border: `1px solid ${selected ? theme.accent : theme.border}`,
                      backgroundColor: selected ? theme.accent : 'transparent',
                      color: selected ? '#fff' : (disabled ? theme.textSecondary : theme.text),
                      opacity: disabled ? 0.45 : 1,
                      cursor: disabled ? 'default' : 'pointer',
                    }}
                  >
                    {mode === 'consensus' ? 'Conclusion' : 'Transcript'}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            justifyContent: 'center',
            padding: '24px 20px 48px 20px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '760px' }}>
            {detailLoading ? (
              <div style={{ fontSize: '13px', color: theme.textSecondary }}>
                Loading {detailMode}...
              </div>
            ) : detailError ? (
              <div style={{ fontSize: '13px', color: theme.error }}>
                {detailError}
              </div>
            ) : !selectedEntry ? (
              <div style={{ fontSize: '13px', color: theme.textSecondary }}>
                Select a council debate to inspect it here.
              </div>
            ) : !detailContent ? (
              <div
                style={{
                  padding: '18px',
                  borderRadius: '10px',
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.isDark ? theme.surface1 : '#fff',
                  fontSize: '13px',
                  color: theme.textSecondary,
                  lineHeight: 1.55,
                }}
              >
                {detailMode === 'consensus'
                  ? 'This debate has not written a conclusion yet. The transcript is still available while the debate is running.'
                  : 'No transcript content is available for this debate.'}
              </div>
            ) : (
              <div
                style={{
                  fontSize: '14px',
                  lineHeight: 1.65,
                  color: theme.text,
                  fontFamily: fonts.sans,
                }}
              >
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => (
                      <h1 style={{ fontSize: '24px', lineHeight: 1.2, marginTop: 0, marginBottom: '12px', color: theme.text }}>
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 style={{ fontSize: '18px', lineHeight: 1.3, marginTop: '22px', marginBottom: '8px', color: theme.text }}>
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 style={{ fontSize: '15px', lineHeight: 1.35, marginTop: '18px', marginBottom: '6px', color: theme.text }}>
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p style={{ margin: '0 0 12px 0' }}>{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul style={{ paddingLeft: '22px', margin: '0 0 16px 0' }}>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol style={{ paddingLeft: '22px', margin: '0 0 16px 0' }}>{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li style={{ marginBottom: '6px' }}>{children}</li>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote
                        style={{
                          margin: '0 0 16px 0',
                          paddingLeft: '12px',
                          borderLeft: `3px solid ${theme.accent}`,
                          color: theme.textSecondary,
                        }}
                      >
                        {children}
                      </blockquote>
                    ),
                    code: ({ children, className }) => {
                      if (!className) {
                        return (
                          <code
                            style={{
                              fontFamily: fonts.mono,
                              fontSize: '0.92em',
                              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                              padding: '1px 4px',
                              borderRadius: '4px',
                            }}
                          >
                            {children}
                          </code>
                        );
                      }

                      return (
                        <code
                          style={{
                            display: 'block',
                            whiteSpace: 'pre-wrap',
                            fontFamily: fonts.mono,
                            fontSize: '12px',
                          }}
                        >
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => (
                      <pre
                        style={{
                          margin: '0 0 18px 0',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          overflowX: 'auto',
                          backgroundColor: theme.isDark ? theme.surface1 : '#fff',
                          border: `1px solid ${theme.border}`,
                        }}
                      >
                        {children}
                      </pre>
                    ),
                    hr: () => (
                      <hr
                        style={{
                          border: 'none',
                          borderTop: `1px solid ${theme.border}`,
                          margin: '22px 0',
                        }}
                      />
                    ),
                  }}
                >
                  {detailContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
