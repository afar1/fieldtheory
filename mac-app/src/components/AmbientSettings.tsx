import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const FALLBACK_SETTINGS: AmbientSettingsValue = {
  instructions: '',
  accessMode: 'codex-defaults',
};

export default function AmbientSettings() {
  const { theme } = useTheme();
  const [settings, setSettings] = useState<AmbientSettingsValue>(FALLBACK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.commandsAPI?.getAmbientSettings?.()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((error) => {
        if (!cancelled) setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load Ambient settings.' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const showResult = useCallback((result: AmbientSettingsSaveResult) => {
    setSettings(result.settings);
    if (!result.success) {
      setMessage({ kind: 'error', text: result.error ?? 'Could not save Ambient settings.' });
      return;
    }
    setDirty(false);
    setMessage({
      kind: 'success',
      text: result.appliedToActiveTask
        ? 'Saved and applied to the active Ambient task.'
        : 'Saved for the next Ambient meeting.',
    });
  }, []);

  const save = useCallback(async () => {
    if (!window.commandsAPI?.saveAmbientSettings) return;
    setSaving(true);
    setMessage(null);
    try {
      showResult(await window.commandsAPI.saveAmbientSettings(settings));
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save Ambient settings.' });
    } finally {
      setSaving(false);
    }
  }, [settings, showResult]);

  const reset = useCallback(async () => {
    if (!window.commandsAPI?.resetAmbientSettings) return;
    setSaving(true);
    setMessage(null);
    try {
      showResult(await window.commandsAPI.resetAmbientSettings());
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not reset Ambient settings.' });
    } finally {
      setSaving(false);
    }
  }, [showResult]);

  const border = theme.isDark ? '#404040' : '#e5e7eb';
  const inputBackground = theme.isDark ? '#1a1a1a' : '#ffffff';

  return (
    <section style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
      <header style={{ padding: '16px 18px', borderBottom: `1px solid ${border}` }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Ambient staffer</div>
        <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: theme.textSecondary }}>
          This is the exact instruction text sent to Codex. Saving updates the active Ambient task when one is running.
        </div>
      </header>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Staffer instructions sent to Codex</span>
          <textarea
            aria-label="Staffer instructions sent to Codex"
            value={settings.instructions}
            disabled={loading || saving}
            onChange={(event) => {
              const instructions = event.currentTarget.value;
              setSettings((current) => ({ ...current, instructions }));
              setDirty(true);
              setMessage(null);
            }}
            spellCheck={false}
            style={{
              minHeight: 300,
              resize: 'vertical',
              padding: 12,
              border: `1px solid ${border}`,
              borderRadius: 8,
              background: inputBackground,
              color: theme.text,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              lineHeight: 1.55,
            }}
          />
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Codex access</span>
          <div style={{
            padding: '9px 10px',
            border: `1px solid ${border}`,
            borderRadius: 7,
            background: inputBackground,
            color: theme.text,
            fontSize: 13,
          }}>
            Controlled in Codex
          </div>
          <span style={{ fontSize: 12, lineHeight: 1.5, color: theme.textSecondary }}>
            Field Theory does not add a separate safety layer. The Ambient task uses the permission profile configured in Codex.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !dirty}
            style={{
              padding: '8px 12px',
              border: 0,
              borderRadius: 7,
              background: theme.info,
              color: '#ffffff',
              cursor: loading || saving || !dirty ? 'default' : 'pointer',
              opacity: loading || saving || !dirty ? 0.55 : 1,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : 'Save and apply'}
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={loading || saving}
            style={{
              padding: '8px 12px',
              border: `1px solid ${border}`,
              borderRadius: 7,
              background: 'transparent',
              color: theme.text,
              cursor: loading || saving ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Reset to Field Theory default
          </button>
          {message && (
            <span role={message.kind === 'error' ? 'alert' : 'status'} style={{
              fontSize: 12,
              color: message.kind === 'error' ? theme.error : theme.success,
            }}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
