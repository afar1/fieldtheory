import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MaxwellRunSummary } from '../../electron/main/types/commands';
import { useTheme } from '../contexts/ThemeContext';

interface MaxwellHistoryPopoverProps {
  open: boolean;
  onClose: () => void;
  footerRef?: React.RefObject<HTMLElement | null>;
}

const DISMISS_MARGIN_PX = 15;

function formatRunTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRunStatus(status: MaxwellRunSummary['status']): string {
  switch (status) {
    case 'success':
      return 'Applied';
    case 'reverted':
      return 'Undone';
    case 'save_conflict':
      return 'Conflict';
    case 'generation_error':
    case 'selection_error':
    case 'save_error':
      return 'Failed';
    case 'generated':
      return 'Generated';
    case 'pending':
      return 'Running';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function isFailedStatus(status: MaxwellRunSummary['status']): boolean {
  return status === 'generation_error' ||
    status === 'selection_error' ||
    status === 'save_error' ||
    status === 'save_conflict';
}

function runDetail(run: MaxwellRunSummary): string {
  return run.errorMessage || run.summary || run.targetRelPath || run.targetPath.split('/').pop() || run.targetPath;
}

function pointerInRect(event: MouseEvent, rect: DOMRect): boolean {
  return event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
}

export default function MaxwellHistoryPopover({ open, onClose, footerRef }: MaxwellHistoryPopoverProps) {
  const { theme } = useTheme();
  const [runs, setRuns] = useState<MaxwellRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoingRunId, setUndoingRunId] = useState<string | null>(null);
  const [redoingRunId, setRedoingRunId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const stopDismissWatchRef = useRef<(() => void) | null>(null);

  const stopDismissWatch = useCallback(() => {
    stopDismissWatchRef.current?.();
    stopDismissWatchRef.current = null;
  }, []);

  const closeIfPointerOutsideMargin = useCallback((event: MouseEvent) => {
    const rect = popoverRef.current?.getBoundingClientRect();
    if (!rect) return;
    const footerRect = footerRef?.current?.getBoundingClientRect();

    if (footerRect && pointerInRect(event, footerRect)) {
      return;
    }

    const outsideMargin =
      event.clientX < rect.left - DISMISS_MARGIN_PX ||
      event.clientX > rect.right + DISMISS_MARGIN_PX ||
      event.clientY < rect.top - DISMISS_MARGIN_PX ||
      event.clientY > rect.bottom + DISMISS_MARGIN_PX;

    if (outsideMargin) {
      stopDismissWatch();
      onClose();
    }
  }, [footerRef, onClose, stopDismissWatch]);

  const startDismissWatch = useCallback(() => {
    stopDismissWatch();
    window.addEventListener('mousemove', closeIfPointerOutsideMargin);
    stopDismissWatchRef.current = () => {
      window.removeEventListener('mousemove', closeIfPointerOutsideMargin);
    };
  }, [closeIfPointerOutsideMargin, stopDismissWatch]);

  const refreshRuns = useCallback(async () => {
    if (!window.commandsAPI?.listMaxwellRuns) {
      setError('Restart Field Theory to load Maxwell history');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRuns(await window.commandsAPI.listMaxwellRuns(12));
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Could not load Maxwell history';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const undoRun = useCallback(async (run: MaxwellRunSummary) => {
    if (!window.commandsAPI?.undoMaxwellRun) {
      setError('Restart Field Theory to load Maxwell undo');
      return;
    }
    setUndoingRunId(run.runId);
    setError(null);
    try {
      const result = await window.commandsAPI.undoMaxwellRun(run.runId);
      if (!result.success) {
        setError(result.error);
      }
      await refreshRuns();
    } catch (undoError) {
      const message = undoError instanceof Error ? undoError.message : 'Could not undo Maxwell run';
      setError(message);
    } finally {
      setUndoingRunId(null);
    }
  }, [refreshRuns]);

  const redoRun = useCallback(async (run: MaxwellRunSummary) => {
    if (!window.commandsAPI?.redoMaxwellRun) {
      setError('Restart Field Theory to load Maxwell redo');
      return;
    }
    setRedoingRunId(run.runId);
    setError(null);
    try {
      const result = await window.commandsAPI.redoMaxwellRun(run.runId);
      if (!result.success) {
        setError(result.error);
      }
      await refreshRuns();
    } catch (redoError) {
      const message = redoError instanceof Error ? redoError.message : 'Could not redo Maxwell run';
      setError(message);
    } finally {
      setRedoingRunId(null);
    }
  }, [refreshRuns]);

  useEffect(() => {
    if (!open) return;
    void refreshRuns();
  }, [open, refreshRuns]);

  useEffect(() => {
    if (!open) {
      stopDismissWatch();
    }
    return stopDismissWatch;
  }, [open, stopDismissWatch]);

  useEffect(() => {
    if (!open) return undefined;
    return window.commandsAPI?.onLocalCommandStatus?.((status) => {
      if (status.runId && status.status !== 'running') {
        void refreshRuns();
      }
    });
  }, [open, refreshRuns]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      onMouseEnter={stopDismissWatch}
      onMouseLeave={startDismissWatch}
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '42px',
        transform: 'translateX(-50%)',
        zIndex: 30,
        width: '340px',
        maxWidth: 'calc(100% - 32px)',
        maxHeight: '280px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: theme.bg,
        border: `1px solid ${theme.border}`,
        borderRadius: '6px',
        boxShadow: theme.isDark
          ? '0 12px 32px rgba(0, 0, 0, 0.45)'
          : '0 12px 32px rgba(0, 0, 0, 0.18)',
        color: theme.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          height: '34px',
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${theme.border}`,
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        <span>Maxwell</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => void refreshRuns()}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh Maxwell history"
            style={{
              width: '22px',
              height: '22px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              color: theme.textSecondary,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.7-2.8" />
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.7 2.8" />
              <path d="M3 21v-6h6" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close Maxwell history"
            style={{
              width: '22px',
              height: '22px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              color: theme.textSecondary,
              cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
      {error && (
        <div
          style={{
            padding: '8px 10px',
            borderBottom: `1px solid ${theme.border}`,
            color: theme.error,
            fontSize: '10px',
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
      <div style={{ overflowY: 'auto', maxHeight: '246px' }}>
        {error && runs.length === 0 ? null : loading && runs.length === 0 ? (
          <div style={{ padding: '14px 10px', color: theme.textSecondary, fontSize: '10px' }}>
            Loading...
          </div>
        ) : runs.length === 0 ? (
          <div style={{ padding: '14px 10px', color: theme.textSecondary, fontSize: '10px' }}>
            No Maxwell runs yet
          </div>
        ) : (
          runs.map((run) => {
            const detail = runDetail(run);
            return (
              <div
                key={run.runId}
                style={{
                  minHeight: '48px',
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderBottom: `1px solid ${theme.border}`,
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span
                      title={run.commandName}
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: theme.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {run.commandName}
                    </span>
                    <span style={{ fontSize: '9px', color: isFailedStatus(run.status) ? theme.error : theme.textSecondary, flexShrink: 0 }}>
                      {formatRunStatus(run.status)}
                    </span>
                    <span style={{ fontSize: '9px', color: theme.textSecondary, flexShrink: 0, opacity: 0.75 }}>
                      {formatRunTime(run.createdAt)}
                    </span>
                  </div>
                  <div
                    title={detail}
                    style={{
                      marginTop: '3px',
                      fontSize: '10px',
                      color: theme.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {detail}
                  </div>
                </div>
                {run.canUndo || run.canRedo ? (
                  <button
                    onClick={() => void (run.canUndo ? undoRun(run) : redoRun(run))}
                    disabled={undoingRunId === run.runId || redoingRunId === run.runId}
                    style={{
                      flexShrink: 0,
                      padding: '3px 7px',
                      fontSize: '10px',
                      color: theme.text,
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      cursor: undoingRunId === run.runId || redoingRunId === run.runId ? 'default' : 'pointer',
                      opacity: undoingRunId === run.runId || redoingRunId === run.runId ? 0.55 : 1,
                    }}
                  >
                    {undoingRunId === run.runId
                      ? 'Undoing'
                      : redoingRunId === run.runId
                        ? 'Redoing'
                        : run.canUndo
                          ? 'Undo'
                          : 'Redo'}
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
