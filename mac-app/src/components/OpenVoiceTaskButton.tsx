import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/** Shared by Settings, the Inbox list, and the transcript footer. */
export function OpenVoiceTaskButton({ threadId, compact = false, style, label }: {
  threadId: string;
  label?: string;
  compact?: boolean;
  style?: CSSProperties;
}) {
  const { theme } = useTheme();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    ++generation.current;
    pending.current = false;
    setOpening(false);
    setError(null);
    return () => { ++generation.current; };
  }, [threadId]);
  const open = async () => {
    if (pending.current || !window.voiceWorkAPI) return;
    pending.current = true;
    const request = generation.current;
    setOpening(true);
    setError(null);
    try {
      const result = await window.voiceWorkAPI.openTask(threadId);
      if (request === generation.current && !result.opened) {
        setError(result.error || 'Could not open the task. Open Codex to find it.');
      }
    } catch {
      if (request === generation.current) setError('Could not open the task. Open Codex to find it.');
    } finally {
      if (request === generation.current) { pending.current = false; setOpening(false); }
    }
  };
  return (
    <span
      data-state={error ? 'error' : opening ? 'opening' : 'idle'}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', ...style }}
    >
      <button
        type="button"
        aria-busy={opening}
        disabled={opening || !window.voiceWorkAPI}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); void open(); }}
        title={error ?? (opening ? 'Opening task in Codex…' : 'Open task in Codex')}
        style={{
          padding: compact ? '2px 6px' : '7px 11px', borderRadius: 6,
          border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text,
          fontSize: compact ? 10 : 12, lineHeight: compact ? '14px' : undefined,
          whiteSpace: 'nowrap', cursor: opening ? 'wait' : 'pointer', opacity: opening ? 0.6 : 1,
        }}
      >
        {opening && !compact ? 'Opening…' : label ?? 'Codex'}
      </button>
      {error && <span role="alert" style={compact
        ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }
        : { fontSize: 11, color: theme.error, marginTop: 4 }}>{error}</span>}
    </span>
  );
}
