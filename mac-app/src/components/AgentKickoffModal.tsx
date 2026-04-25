// =============================================================================
// AgentKickoffModal — popup for dispatching the locally-installed Claude Code
// or Codex CLI against the markdown file currently open in the Librarian.
//
// User flow: click the agent button → modal opens → type instruction → pick
// model → hit run. Stdout/stderr stream live into the output panel; on
// success the main process appends a "## Agent run" footer to the file.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type AgentKickoffModel = 'claude' | 'codex';

interface AgentKickoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string | null;
  fileTitle: string | null;
}

type RunStatus = 'idle' | 'running' | 'done' | 'error';

const MODEL_OPTIONS: Array<{ id: AgentKickoffModel; label: string; hint: string }> = [
  { id: 'claude', label: 'Claude Code', hint: 'claude -p' },
  { id: 'codex', label: 'Codex', hint: 'codex exec' },
];

const STORAGE_KEY = 'agentKickoff.lastModel';

export default function AgentKickoffModal({
  isOpen,
  onClose,
  filePath,
  fileTitle,
}: AgentKickoffModalProps) {
  const { theme } = useTheme();
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<AgentKickoffModel>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage?.getItem(STORAGE_KEY) : null;
    return stored === 'codex' ? 'codex' : 'claude';
  });
  const [status, setStatus] = useState<RunStatus>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [appendedFooter, setAppendedFooter] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  // Reset transient state when reopening with a different file.
  useEffect(() => {
    if (!isOpen) return;
    setStatus('idle');
    setOutput('');
    setError(null);
    setSummary(null);
    setAppendedFooter(false);
    setRunId(null);
    // Focus the textarea so the user can start typing immediately.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isOpen, filePath]);

  // Persist last-selected model.
  useEffect(() => {
    try { window.localStorage?.setItem(STORAGE_KEY, model); } catch { /* private mode */ }
  }, [model]);

  // Subscribe to stdout/stderr chunks while the modal is open. The modal
  // runs one agent at a time, so we don't filter by runId — every event
  // belongs to the active run.
  useEffect(() => {
    if (!isOpen) return;
    const off = window.agentKickoffAPI?.onProgress((event) => {
      setOutput((prev) => prev + event.chunk);
    });
    return () => { off?.(); };
  }, [isOpen]);

  // Auto-scroll output to the bottom as new chunks arrive.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const canRun = status !== 'running' && !!filePath && instruction.trim().length > 0;

  const handleRun = useCallback(async () => {
    if (!canRun || !filePath) return;
    setStatus('running');
    setOutput('');
    setError(null);
    setSummary(null);
    setAppendedFooter(false);
    try {
      const result = await window.agentKickoffAPI?.kickoff({
        absPath: filePath,
        instruction: instruction.trim(),
        model,
      });
      if (!result) {
        setStatus('error');
        setError('Agent kickoff API is unavailable.');
        return;
      }
      setRunId(result.runId);
      setSummary(result.summary || null);
      setAppendedFooter(result.appendedFooter);
      if (result.ok) {
        setStatus('done');
      } else {
        setStatus('error');
        setError(result.error || 'Agent run failed.');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [canRun, filePath, instruction, model]);

  const handleCancel = useCallback(async () => {
    if (status !== 'running' || !runId) return;
    await window.agentKickoffAPI?.cancel(runId);
  }, [status, runId]);

  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget && status !== 'running') {
      onClose();
    }
  }, [onClose, status]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && status !== 'running') {
      event.preventDefault();
      onClose();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleRun();
    }
  }, [handleRun, onClose, status]);

  if (!isOpen) return null;

  const fileLabel = fileTitle || (filePath ? filePath.split('/').pop() ?? filePath : 'No file selected');

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Run agent on this file"
    >
      <div
        style={{
          width: '90%',
          maxWidth: '560px',
          maxHeight: '80vh',
          backgroundColor: theme.bg,
          border: `1px solid ${theme.border}`,
          borderRadius: '12px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: theme.text }}>
              Run agent on this file
            </div>
            <div
              style={{
                fontSize: '11px',
                color: theme.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={filePath ?? ''}
            >
              {fileLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === 'running'}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              lineHeight: 1,
              color: theme.textSecondary,
              cursor: status === 'running' ? 'not-allowed' : 'pointer',
              opacity: status === 'running' ? 0.4 : 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label
              htmlFor="agent-kickoff-instruction"
              style={{ fontSize: '11px', color: theme.textSecondary, display: 'block', marginBottom: '5px' }}
            >
              Instruction
            </label>
            <textarea
              id="agent-kickoff-instruction"
              ref={textareaRef}
              value={instruction}
              onChange={(e) => setInstruction(e.currentTarget.value)}
              disabled={status === 'running'}
              placeholder="e.g. Clean up the rambling sentences and tighten the prose. Keep the meaning."
              rows={4}
              style={{
                width: '100%',
                fontSize: '13px',
                padding: '10px 12px',
                color: theme.text,
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '5px' }}>
              Model
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {MODEL_OPTIONS.map((option) => {
                const selected = option.id === model;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setModel(option.id)}
                    disabled={status === 'running'}
                    title={option.hint}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: selected ? 600 : 400,
                      color: selected ? (theme.isDark ? '#fff' : '#000') : theme.textSecondary,
                      backgroundColor: selected
                        ? (theme.isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.08)')
                        : 'transparent',
                      border: `1px solid ${selected ? theme.text : theme.border}`,
                      borderRadius: '6px',
                      cursor: status === 'running' ? 'not-allowed' : 'pointer',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    {option.label}
                    <div style={{ fontSize: '10px', fontWeight: 400, color: theme.textSecondary, marginTop: '2px' }}>
                      {option.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {(status !== 'idle' || output) && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  color: theme.textSecondary,
                  marginBottom: '5px',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>{status === 'running' ? 'Running…' : status === 'done' ? 'Output' : status === 'error' ? 'Output (errored)' : 'Output'}</span>
                {appendedFooter && (
                  <span style={{ color: theme.success ?? '#16a34a' }}>Footer appended ✓</span>
                )}
              </div>
              <pre
                ref={outputRef}
                style={{
                  margin: 0,
                  maxHeight: '200px',
                  overflow: 'auto',
                  padding: '10px 12px',
                  fontSize: '11px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  color: theme.text,
                  backgroundColor: theme.isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {output || (status === 'running' ? 'Waiting for output…' : '')}
              </pre>
              {summary && status === 'done' && (
                <div style={{ fontSize: '12px', color: theme.text, marginTop: '8px' }}>
                  <strong>Summary:</strong> {summary}
                </div>
              )}
              {error && status === 'error' && (
                <div style={{ fontSize: '12px', color: theme.error ?? '#dc2626', marginTop: '8px' }}>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '12px 18px',
            borderTop: `1px solid ${theme.border}`,
          }}
        >
          {status === 'running' ? (
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '8px 14px',
                fontSize: '13px',
                color: theme.text,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '8px 14px',
                  fontSize: '13px',
                  color: theme.text,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={!canRun}
                style={{
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: canRun ? (theme.accent ?? '#2563eb') : theme.border,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: canRun ? 'pointer' : 'not-allowed',
                  opacity: canRun ? 1 : 0.6,
                }}
                title="Run agent (⌘⏎)"
              >
                {status === 'done' ? 'Run again' : 'Run'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
