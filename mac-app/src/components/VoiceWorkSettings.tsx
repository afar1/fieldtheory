import VoiceInboxInstructionsEditor from './VoiceInboxInstructionsEditor';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VoiceWorkState } from '../../electron/shared/voiceWork';
import { useTheme } from '../contexts/ThemeContext';
import { SettingsCard, SettingsRow, SettingsSectionHeading } from './settings/SettingsPrimitives';
import { OpenVoiceTaskButton } from './OpenVoiceTaskButton';
import { formatVoiceInboxTime } from '../../electron/shared/voiceInboxPresentation';

function readinessMessage(state: VoiceWorkState): string {
  if (state.message) return state.message;
  if (!state.codex.available) return 'Install Codex on this Mac and sign in, then check again.';
  if (state.codex.signedIn !== true) return 'Sign in to Codex on this Mac, then check again.';
  if (state.status === 'signed_out') return 'Sign in to Field Theory, then check again.';
  if (!state.settings.workspacePath) return 'Choose a Library folder for your voice transcripts.';
  if (state.status === 'connecting') return 'Checking your connection…';
  if (state.status === 'needs_setup' || state.status === 'error') return 'Check again to see what needs attention.';
  if (state.status === 'working') return 'Codex is working on a voice request.';
  return state.settings.enabled ? 'Listening for new synced voice requests.' : 'Ready when you turn on Voice requests.';
}

function statusLabel(state: VoiceWorkState): string {
  switch (state.status) {
    case 'signed_out': return 'Sign-in needed';
    case 'connecting': return 'Connecting…';
    case 'working': return 'Working';
    case 'needs_setup': return 'Setup needed';
    case 'error': return 'Needs attention';
    case 'ready': return state.settings.enabled ? 'Ready' : 'Ready to enable';
    case 'disabled': return 'Off';
  }
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case 'routing': return 'Choosing destination';
    case 'waiting': return 'Waiting to start';
    case 'finishing': return 'Saving result';
    case 'completed': return 'Done';
    case 'context': return 'Saved as context';
    case 'queued':
    case 'pending': return 'Queued';
    case 'running':
    case 'working':
    case 'started':
    case 'delegated': return 'Working';
    case 'needs_user':
    case 'needs_attention': return 'Needs you';
    case 'failed':
    case 'error': return 'Failed';
    case 'interrupted':
    case 'cancelled': return 'Stopped';
    default: return 'Status unavailable';
  }
}

export default function VoiceWorkSettings() {
  const { theme } = useTheme();
  const [state, setState] = useState<VoiceWorkState | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [folders, setFolders] = useState<Array<{ path: string; label: string }>>([]);
  const [folderChoice, setFolderChoice] = useState('');
  const folderRevision = useRef<number | null>(null);
  const folderRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const mutationPending = useRef(false);
  const api = window.voiceWorkAPI;

  const cancelFolder = useCallback(() => {
    folderRequest.current++;
    folderRevision.current = null;
    mutationPending.current = false;
    setChoosing(false);
    setFolders([]);
    setFolderChoice('');
  }, []);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const requestRevision = ++revision.current;
    if (!api) {
      setChecking(false);
      setError('Open Settings in the Field Theory Mac app to set up Voice requests.');
      return () => { active = false; mounted.current = false; };
    }

    const unsubscribe = api.onStateChanged((next) => {
      if (!active) return;
      revision.current++;
      if (folderRevision.current !== null) {
        cancelFolder();
        setError('Voice requests changed while the folder picker was open. Check again, then choose the folder.');
      }
      setState(next);
    });
    void (async () => {
      try {
        const initial = await api.getState();
        if (!active || requestRevision !== revision.current) return;
        setState(initial);
        const refreshed = await api.refreshStatus();
        if (active && requestRevision === revision.current) setState(refreshed);
      } catch {
        if (active && requestRevision === revision.current) {
          setError('Could not check Voice requests. Check again to retry.');
        }
      } finally {
        if (active) setChecking(false);
      }
    })();

    return () => {
      active = false;
      mounted.current = false;
      revision.current++;
      folderRequest.current++;
      unsubscribe();
    };
  }, [api, cancelFolder]);

  const refresh = async () => {
    if (!api || checking) return;
    const requestRevision = ++revision.current;
    setChecking(true);
    setError(null);
    try {
      const next = await api.refreshStatus();
      if (mounted.current && requestRevision === revision.current) setState(next);
    } catch {
      if (mounted.current && requestRevision === revision.current) {
        setError('Could not check Voice requests. Check again to retry.');
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const toggle = async () => {
    if (!api || !state || mutationPending.current) return;
    mutationPending.current = true;
    const enabled = !state.settings.enabled;
    const requestRevision = ++revision.current;
    setSaving(true);
    setError(null);
    try {
      const next = await api.updateSettings({ enabled });
      if (mounted.current && requestRevision === revision.current) setState(next);
    } catch {
      if (mounted.current) setError(`Could not turn ${enabled ? 'on' : 'off'} Voice requests. Check again and try once more.`);
    } finally {
      mutationPending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const chooseWorkspace = async () => {
    if (!api || !state || mutationPending.current) return;
    mutationPending.current = true;
    const requestRevision = ++revision.current;
    const request = ++folderRequest.current;
    folderRevision.current = requestRevision;
    setChoosing(true);
    setFolders([]);
    setFolderChoice('');
    setError(null);
    try {
      const available = await api.listFolders();
      if (!mounted.current || request !== folderRequest.current) return;
      if (requestRevision !== revision.current) {
        cancelFolder();
        setError('Voice requests changed while the folder picker was open. Check again, then choose the folder.');
        return;
      }
      setFolders(available);
      setFolderChoice(available.some((folder) => folder.path === state.settings.workspacePath)
        ? state.settings.workspacePath! : available[0]?.path ?? '');
    } catch {
      if (mounted.current && request === folderRequest.current) {
        cancelFolder();
        setError('Could not load Library folders. Check again and retry.');
      }
    }
  };

  const saveFolder = async () => {
    if (!api || !choosing || saving || !folders.some((folder) => folder.path === folderChoice)) return;
    if (folderRevision.current !== revision.current) {
      cancelFolder();
      setError('Voice requests changed while the folder picker was open. Check again, then choose the folder.');
      return;
    }
    const requestRevision = ++revision.current;
    const request = folderRequest.current;
    // Saving emits state changes too; the response remains fenced by revision.
    folderRevision.current = null;
    setSaving(true);
    try {
      const next = await api.updateSettings({ workspacePath: folderChoice });
      if (mounted.current && requestRevision === revision.current) setState(next);
      if (mounted.current && request === folderRequest.current) cancelFolder();
    } catch {
      if (mounted.current && request === folderRequest.current) {
        cancelFolder();
        setError('Could not save the Library folder. Choose the folder again to retry.');
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const enabled = state?.settings.enabled === true;
  const canEnable = Boolean(state?.settings.workspacePath && state.codex.available && state.codex.signedIn === true
    && !['signed_out', 'connecting', 'needs_setup', 'error'].includes(state.status));
  const toggleDisabled = !api || !state || saving || choosing || (!enabled && (checking || !canEnable));
  const folderDisabled = !api || !state || checking || saving || choosing || enabled || state?.status === 'working';
  const buttonStyle: CSSProperties = {
    padding: '7px 11px', borderRadius: 6, border: `1px solid ${theme.border}`,
    background: 'transparent', color: theme.text, fontSize: 12, cursor: 'pointer',
  };

  return (
    <section aria-label="Voice requests">
      <SettingsCard theme={theme}>
        <SettingsSectionHeading
          theme={theme}
          title="Voice requests"
          description="Save synced voice transcripts in Library and let Codex handle new requests. Keep Field Theory running and this Mac online."
        />
        <SettingsRow
          theme={theme}
          label="Enable voice requests"
          hint="Send new synced requests to Codex. Codex chooses the appropriate project or task, using its existing permissions."
          control={(
            <button
              type="button"
              role="switch"
              aria-label="Enable voice requests"
              aria-checked={enabled}
              disabled={toggleDisabled}
              onClick={() => void toggle()}
              style={{
                ...buttonStyle, minWidth: 46,
                color: enabled ? '#ffffff' : theme.textSecondary,
                background: enabled ? theme.accent : theme.selectedBg,
                borderColor: enabled ? theme.accent : theme.border,
                opacity: toggleDisabled ? 0.55 : 1,
                cursor: toggleDisabled ? 'default' : 'pointer',
              }}
            >
              {enabled ? 'On' : 'Off'}
            </button>
          )}
        />
        <SettingsRow
          theme={theme}
          label="Library folder"
          hint={(
            <>
              <span style={{ overflowWrap: 'anywhere' }}>{state?.settings.workspacePath || 'Preparing your Inbox…'}</span>
              {enabled && <span style={{ display: 'block' }}>Pause Voice requests to change this folder.</span>}
            </>
          )}
          control={(
            <button
              type="button"
              disabled={folderDisabled}
              onClick={() => void chooseWorkspace()}
              style={{ ...buttonStyle, opacity: folderDisabled ? 0.55 : 1, cursor: folderDisabled ? 'default' : 'pointer' }}
            >
              {choosing ? 'Choosing…' : state?.settings.workspacePath ? 'Change folder…' : 'Choose folder…'}
            </button>
          )}
        />
        {choosing && (
          <div role="group" aria-label="Choose a Library folder" style={{ margin: '12px 0', display: 'grid', gap: 10 }}>
            <label htmlFor="voice-library-folder" style={{ fontSize: 12 }}>Library folder</label>
            <select id="voice-library-folder" value={folderChoice} disabled={saving || !folders.length}
              onChange={(event) => setFolderChoice(event.target.value)} style={buttonStyle}>
              {!folders.length && <option value="">Loading Library folders…</option>}
              {folders.map((folder) => <option key={folder.path} value={folder.path}>{folder.label}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={saving || !folders.some((folder) => folder.path === folderChoice)} onClick={() => void saveFolder()} style={buttonStyle}>Use folder</button>
              <button type="button" disabled={saving} onClick={cancelFolder} style={buttonStyle}>Cancel</button>
            </div>
          </div>
        )}
        {state && state.status !== 'signed_out' && <VoiceInboxInstructionsEditor saved={state.settings.inboxInstructions} disabled={saving || choosing} onSave={async value => {
          if (!api || mutationPending.current) throw new Error('Voice requests unavailable.');
          mutationPending.current = true;
          setSaving(true);
          try {
            const next = await api.updateSettings({ inboxInstructions: value });
            if (mounted.current) setState(next);
          } finally {
            mutationPending.current = false;
            if (mounted.current) setSaving(false);
          }
        }} />}
        <SettingsRow
          theme={theme}
          label={(
            <span role="status" aria-live="polite" aria-atomic="true">
              {checking ? 'Checking…' : state ? statusLabel(state) : 'Unavailable'}
            </span>
          )}
          hint={state ? readinessMessage(state) : 'Checking that Field Theory and Codex are ready.'}
          control={(
            <button
              type="button"
              disabled={!api || checking || saving || choosing}
              onClick={() => void refresh()}
              style={{ ...buttonStyle, opacity: !api || checking || saving || choosing ? 0.55 : 1 }}
            >
              Check again
            </button>
          )}
          last
        />
        <p style={{ margin: '10px 0 0', color: theme.textSecondary, fontSize: 11.5, lineHeight: 1.5 }}>
          Follow-ups to existing Codex conversations use that conversation’s permissions. Codex handles any approvals.
        </p>
        <p style={{ margin: '10px 0 0', color: theme.textSecondary, fontSize: 11.5, lineHeight: 1.5 }}>
          While Voice requests are enabled and Codex is signed in, Field Theory keeps this Mac awake when plugged in. Your screen can lock or turn off. Battery power, closing the lid without an external display, or choosing Sleep can pause delivery; saved requests resume when the Mac reconnects.
        </p>
        <p style={{ margin: '10px 0 0', color: theme.textSecondary, fontSize: 11.5, lineHeight: 1.5 }}>
          Inbox contains your transcript and a link after it is sent to a task. Earlier synced recordings, “just context,” and “hold off” remain notes. Recordings kept local on your phone stay there.
        </p>
        {state?.inboxThreadId && (
          <SettingsRow theme={theme} label="Codex voice inbox"
            hint="Your pinned intake conversation records arrivals, routing decisions, and task links."
            control={<OpenVoiceTaskButton threadId={state.inboxThreadId} label="Open voice inbox" />} />
        )}
        {!!state?.activeTasks?.length && (
          <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 18, paddingTop: 16 }}>
            <div style={{ color: theme.textSecondary, fontSize: 11, marginBottom: 7 }}>Active voice requests · {state.activeTasks.length}</div>
            {state.activeTasks.map(task => (
              <div key={task.jobId} style={{ marginTop: 12 }}>
                <div style={{ color: theme.text, fontSize: 13 }}>{task.title}</div>
                <div style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}>{taskStatusLabel(task.status)}</div>
                {task.threadId && <OpenVoiceTaskButton threadId={task.threadId} style={{ marginTop: 6 }} />}
              </div>
            ))}
          </div>
        )}
        {state?.lastTask && (
          <div style={{ borderTop: `1px solid ${theme.border}`, marginTop: 18, paddingTop: 16 }}>
            <div style={{ color: theme.textSecondary, fontSize: 11, marginBottom: 7 }}>Latest voice task · {taskStatusLabel(state.lastTask.status)}</div>
            <div style={{ color: theme.text, fontSize: 13, fontWeight: 600 }}>{state.lastTask.title || 'Voice task'}</div>
            {state.lastTask.summary && <p style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.lastTask.summary}</p>}
            {state.lastTask.question?.trim() && <p style={{ color: theme.text, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.lastTask.question}</p>}
            {state.lastTask.finalResponse?.trim() && (
              <details key={state.lastTask.threadId} style={{ marginTop: 12 }}>
                <summary style={{ color: theme.text, fontSize: 12, cursor: 'pointer' }}>Read full response</summary>
                <div style={{ marginTop: 10, color: theme.text, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {state.lastTask.finalResponse}
                </div>
              </details>
            )}
            {state.lastTask.canOpen && (
              <OpenVoiceTaskButton threadId={state.lastTask.threadId} style={{ marginTop: 8 }} />
            )}
          </div>
        )}
        {state?.lastEventAt && Number.isFinite(state.lastEventAt) ? (
          <p style={{ color: theme.textSecondary, fontSize: 11, marginBottom: 0 }}>
            Last update: {new Date(state.lastEventAt).toLocaleDateString()} · {formatVoiceInboxTime(state.lastEventAt)}
          </p>
        ) : null}
        {error && <p role="alert" style={{ color: theme.error, fontSize: 12, lineHeight: 1.5, marginBottom: 0 }}>{error}</p>}
      </SettingsCard>
    </section>
  );
}
