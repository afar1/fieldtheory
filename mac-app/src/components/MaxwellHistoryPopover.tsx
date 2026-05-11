import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MaxwellMemoryState, MaxwellRunSummary } from '../../electron/main/types/commands';
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

function formatRunDuration(run: MaxwellRunSummary): string | null {
  const elapsedMs = Math.max(0, run.updatedAt - run.createdAt);
  if (elapsedMs <= 0) return null;
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  if (elapsedMs < 10_000) return `${(elapsedMs / 1000).toFixed(1)}s`;
  return `${Math.round(elapsedMs / 1000)}s`;
}

function formatHarness(harness: string | null): string {
  switch (harness) {
    case 'codex':
      return 'Codex harness';
    case 'direct':
      return 'Direct Gemma';
    default:
      return 'Maxwell';
  }
}

function formatRunMode(mode: MaxwellRunSummary['mode']): string {
  return mode === 'selection' ? 'Selection' : 'Document';
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

function runMeta(run: MaxwellRunSummary): string {
  return [
    formatHarness(run.harness),
    run.memoryUsed ? 'Memory' : null,
    run.model,
    formatRunMode(run.mode),
    formatRunDuration(run),
  ].filter(Boolean).join(' / ');
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
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryContent, setMemoryContent] = useState('');
  const [savedMemoryContent, setSavedMemoryContent] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [savedMemoryEnabled, setSavedMemoryEnabled] = useState(true);
  const [memoryPath, setMemoryPath] = useState('');
  const [memoryMaxChars, setMemoryMaxChars] = useState(12_000);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const stopDismissWatchRef = useRef<(() => void) | null>(null);

  const memoryDirty = memoryContent !== savedMemoryContent || memoryEnabled !== savedMemoryEnabled;

  const applyMemoryState = useCallback((memory: MaxwellMemoryState) => {
    setMemoryContent(memory.content);
    setSavedMemoryContent(memory.content);
    setMemoryEnabled(memory.enabled);
    setSavedMemoryEnabled(memory.enabled);
    setMemoryPath(memory.path);
    setMemoryMaxChars(memory.maxChars);
  }, []);

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

  const refreshMemory = useCallback(async () => {
    if (!window.commandsAPI?.getMaxwellMemory) {
      setMemoryError('Restart Field Theory to load Maxwell memory');
      return;
    }
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      applyMemoryState(await window.commandsAPI.getMaxwellMemory());
    } catch (memoryLoadError) {
      const message = memoryLoadError instanceof Error ? memoryLoadError.message : 'Could not load Maxwell memory';
      setMemoryError(message);
    } finally {
      setMemoryLoading(false);
    }
  }, [applyMemoryState]);

  const saveMemory = useCallback(async () => {
    if (!window.commandsAPI?.saveMaxwellMemory) {
      setMemoryError('Restart Field Theory to save Maxwell memory');
      return;
    }
    if (memoryContent.length > memoryMaxChars) {
      setMemoryError(`Maxwell memory is too large (${memoryContent.length} characters, limit ${memoryMaxChars}).`);
      return;
    }
    setMemorySaving(true);
    setMemoryError(null);
    try {
      const result = await window.commandsAPI.saveMaxwellMemory({
        enabled: memoryEnabled,
        content: memoryContent,
      });
      if (!result.success) {
        setMemoryError(result.error ?? 'Could not save Maxwell memory');
      }
      if (result.memory) {
        applyMemoryState(result.memory);
      }
    } catch (memorySaveError) {
      const message = memorySaveError instanceof Error ? memorySaveError.message : 'Could not save Maxwell memory';
      setMemoryError(message);
    } finally {
      setMemorySaving(false);
    }
  }, [applyMemoryState, memoryContent, memoryEnabled, memoryMaxChars]);

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
    if (!open || !memoryOpen) return;
    void refreshMemory();
  }, [memoryOpen, open, refreshMemory]);

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
        top: '48px',
        right: '12px',
        bottom: '42px',
        zIndex: 30,
        width: '360px',
        maxWidth: 'calc(100% - 24px)',
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
            onClick={() => setMemoryOpen((next) => !next)}
            title="Maxwell memory"
            aria-label="Open Maxwell memory"
            style={{
              width: '22px',
              height: '22px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: memoryOpen ? theme.accent : 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              color: memoryOpen ? '#fff' : theme.textSecondary,
              cursor: 'pointer',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 4h12" />
              <path d="M6 12h12" />
              <path d="M6 20h12" />
              <path d="M3 4h.01" />
              <path d="M3 12h.01" />
              <path d="M3 20h.01" />
            </svg>
          </button>
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
      {memoryOpen && (
        <div
          style={{
            padding: '9px 10px 10px',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '7px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: theme.text }}>
              <input
                type="checkbox"
                checked={memoryEnabled}
                onChange={(event) => setMemoryEnabled(event.target.checked)}
                style={{ margin: 0 }}
              />
              Use memory
            </label>
            <span style={{ fontSize: '9px', color: memoryContent.length > memoryMaxChars ? theme.error : theme.textSecondary }}>
              {memoryContent.length}/{memoryMaxChars}
            </span>
          </div>
          <textarea
            aria-label="Maxwell memory content"
            value={memoryContent}
            onChange={(event) => setMemoryContent(event.target.value)}
            spellCheck={false}
            disabled={memoryLoading || memorySaving}
            style={{
              width: '100%',
              minHeight: '104px',
              resize: 'vertical',
              boxSizing: 'border-box',
              border: `1px solid ${theme.border}`,
              borderRadius: '4px',
              padding: '7px 8px',
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : '#fff',
              color: theme.text,
              fontSize: '11px',
              lineHeight: 1.4,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span
              title={memoryPath}
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '9px',
                color: theme.textSecondary,
              }}
            >
              {memoryPath ? 'maxwell/memory.md' : 'memory.md'}
            </span>
            <button
              onClick={() => void refreshMemory()}
              disabled={memoryLoading || memorySaving}
              style={{
                padding: '3px 7px',
                fontSize: '10px',
                color: theme.text,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                cursor: memoryLoading || memorySaving ? 'default' : 'pointer',
                opacity: memoryLoading || memorySaving ? 0.55 : 1,
              }}
            >
              Reload
            </button>
            <button
              onClick={() => void saveMemory()}
              disabled={!memoryDirty || memorySaving || memoryLoading || memoryContent.length > memoryMaxChars}
              style={{
                padding: '3px 7px',
                fontSize: '10px',
                color: memoryDirty ? '#fff' : theme.textSecondary,
                backgroundColor: memoryDirty ? theme.accent : 'transparent',
                border: `1px solid ${memoryDirty ? theme.accent : theme.border}`,
                borderRadius: '4px',
                cursor: !memoryDirty || memorySaving || memoryLoading || memoryContent.length > memoryMaxChars ? 'default' : 'pointer',
                opacity: !memoryDirty || memorySaving || memoryLoading || memoryContent.length > memoryMaxChars ? 0.55 : 1,
              }}
            >
              {memorySaving ? 'Saving' : 'Save'}
            </button>
          </div>
          {memoryError ? (
            <div style={{ color: theme.error, fontSize: '10px', lineHeight: 1.35 }}>
              {memoryError}
            </div>
          ) : null}
        </div>
      )}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
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
            const meta = runMeta(run);
            return (
              <div
                key={run.runId}
                style={{
                  minHeight: '60px',
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
                    title={meta}
                    style={{
                      marginTop: '3px',
                      fontSize: '9px',
                      color: theme.textSecondary,
                      opacity: 0.8,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {meta}
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
