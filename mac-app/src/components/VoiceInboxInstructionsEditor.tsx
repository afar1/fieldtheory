import { useState } from 'react';
import { DEFAULT_VOICE_INBOX_INSTRUCTIONS } from '../../electron/shared/voiceInboxInstructions';
import { useTheme } from '../contexts/ThemeContext';

export default function VoiceInboxInstructionsEditor({ saved, disabled, onSave }: {
  saved?: string; disabled: boolean; onSave: (value: string) => Promise<void>;
}) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const current = saved ?? DEFAULT_VOICE_INBOX_INSTRUCTIONS;
  const value = draft ?? current;
  const save = async (text: string) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await onSave(text);
      setDraft(null);
      setNotice('Saved. Applies to recordings routed after this change.');
    } catch {
      setError('Could not save Voice inbox instructions. Your edits are still here.');
    } finally { setSaving(false); }
  };
  const buttonStyle = { padding: '7px 11px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 12 };
  return <div style={{ margin: '18px 0', display: 'grid', gap: 8 }}>
    <label htmlFor="voice-inbox-instructions" style={{ fontSize: 13, fontWeight: 600 }}>Voice inbox instructions</label>
    <p style={{ margin: 0, color: theme.textSecondary, fontSize: 12 }}>Tell your agent app (e.g. Codex) how to handle incoming recordings.</p>
    <textarea id="voice-inbox-instructions" rows={14} maxLength={20000} value={value} disabled={disabled || saving}
      onChange={event => { setDraft(event.target.value); setNotice(''); }}
      style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: 10, borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 12, lineHeight: 1.5 }} />
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" style={buttonStyle} disabled={disabled || saving || !value.trim() || value === current} onClick={() => void save(value)}>Save changes</button>
      <button type="button" style={buttonStyle} disabled={disabled || saving || (value === DEFAULT_VOICE_INBOX_INSTRUCTIONS && current === DEFAULT_VOICE_INBOX_INSTRUCTIONS)} onClick={() => void save(DEFAULT_VOICE_INBOX_INSTRUCTIONS)}>Reset to defaults</button>
    </div>
    {notice && <p role="status" style={{ margin: 0, fontSize: 12 }}>{notice}</p>}
    {error && <p role="alert" style={{ margin: 0, fontSize: 12 }}>{error}</p>}
  </div>;
}
