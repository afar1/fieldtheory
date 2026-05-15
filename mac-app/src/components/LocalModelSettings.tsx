import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  SettingsBadge,
  SettingsNotice,
  SettingsRow,
  SettingsSectionHeading,
} from './settings/SettingsPrimitives';

type LocalModelInfo = {
  name: string;
  filename: string;
  sizeBytes: number;
  description: string;
  license?: string;
  sourceUrl?: string;
  baseModelUrl?: string;
};

type LocalModelHealth = {
  status: 'ready' | 'missing' | 'corrupt';
  modelPath: string;
  fileSizeBytes: number | null;
  expectedSizeBytes: number;
  minValidSizeBytes: number;
};

const DEFAULT_MODEL_ID = 'gemma-4-E4B-it-Q4_K_M';

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return 'Unknown';
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`;
}

function abbreviateHomePath(filePath: string | undefined): string {
  if (!filePath) return 'Unknown';
  return filePath.replace(/^\/Users\/[^/]+/, '~');
}

export default function LocalModelSettings() {
  const { theme } = useTheme();
  const [models, setModels] = useState<Record<string, LocalModelInfo>>({});
  const [healthByModel, setHealthByModel] = useState<Record<string, LocalModelHealth>>({});
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meetingSummaryPrompt, setMeetingSummaryPrompt] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.getLocalLLMModels || !api.getLocalLLMSelected || !api.getLocalLLMHealth) {
      setError('Local model settings are unavailable in this build.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [nextModels, nextSelected, nextHealth, nextMeetingSummaryPrompt] = await Promise.all([
        api.getLocalLLMModels(),
        api.getLocalLLMSelected(),
        api.getLocalLLMHealth(),
        api.getMeetingSummaryPrompt?.() ?? Promise.resolve(''),
      ]);
      setModels(nextModels);
      setSelectedModel(nextSelected || DEFAULT_MODEL_ID);
      setHealthByModel(nextHealth);
      setMeetingSummaryPrompt(nextMeetingSummaryPrompt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local model status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modelIds = useMemo(() => Object.keys(models), [models]);
  const activeModelId = models[selectedModel] ? selectedModel : modelIds[0] ?? DEFAULT_MODEL_ID;
  const model = models[activeModelId];
  const health = healthByModel[activeModelId];
  const ready = health?.status === 'ready';
  const statusTone = ready ? 'success' : health?.status === 'corrupt' ? 'warning' : 'neutral';
  const statusLabel = ready ? 'Ready' : health?.status === 'corrupt' ? 'Repair needed' : 'Missing';
  const primaryLabel = installing
    ? 'Working...'
    : ready
      ? 'Use local model'
      : health?.status === 'corrupt'
        ? 'Repair or download'
        : 'Find or download';

  const handlePrimaryAction = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.downloadLocalLLM || !api.setLocalLLMSelected) return;

    setError(null);
    setMessage(null);
    setInstalling(!ready);

    try {
      const selected = await api.setLocalLLMSelected(activeModelId);
      if (!selected.success) {
        setError(selected.error ?? 'Could not select local model.');
        return;
      }

      if (ready) {
        const enabled = await api.setUseLocalLLM?.(true);
        if (enabled && !enabled.success) {
          setError(enabled.error ?? 'Could not enable local model.');
          return;
        }
        setMessage('Using the existing local model.');
        return;
      }

      const result = await api.downloadLocalLLM(activeModelId);
      if (!result.success) {
        setError(result.error ?? 'Local model setup failed.');
        return;
      }
      setMessage(result.reusedExisting ? 'Found and linked the existing local model.' : 'Local model installed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local model setup failed.');
    } finally {
      setInstalling(false);
    }
  }, [activeModelId, load, ready]);

  const handleSaveMeetingSummaryPrompt = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.saveMeetingSummaryPrompt) {
      setPromptError('Meeting notes prompt settings are unavailable in this build.');
      return;
    }

    setPromptSaving(true);
    setPromptMessage(null);
    setPromptError(null);

    try {
      const result = await api.saveMeetingSummaryPrompt(meetingSummaryPrompt);
      if (!result.success) {
        setPromptError(result.error ?? 'Could not save meeting notes prompt.');
        return;
      }
      setMeetingSummaryPrompt(result.prompt ?? meetingSummaryPrompt);
      setPromptMessage('Meeting notes prompt saved.');
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Could not save meeting notes prompt.');
    } finally {
      setPromptSaving(false);
    }
  }, [meetingSummaryPrompt]);

  const handleResetMeetingSummaryPrompt = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.resetMeetingSummaryPrompt) {
      setPromptError('Meeting notes prompt settings are unavailable in this build.');
      return;
    }

    setPromptSaving(true);
    setPromptMessage(null);
    setPromptError(null);

    try {
      const result = await api.resetMeetingSummaryPrompt();
      if (!result.success) {
        setPromptError(result.error ?? 'Could not reset meeting notes prompt.');
        return;
      }
      setMeetingSummaryPrompt(result.prompt);
      setPromptMessage('Meeting notes prompt reset.');
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Could not reset meeting notes prompt.');
    } finally {
      setPromptSaving(false);
    }
  }, []);

  if (loading && !model) {
    return (
      <SettingsSectionHeading
        theme={theme}
        title="Local model"
        description="Loading local model status."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <SettingsSectionHeading
        theme={theme}
        title="Local model"
        description="Use Gemma for offline portable commands. Field Theory checks known local copies before downloading."
      />

      {modelIds.length > 1 && (
        <SettingsRow
          theme={theme}
          label="Model"
          control={
            <select
              value={activeModelId}
              onChange={(event) => setSelectedModel(event.target.value)}
              style={{
                minWidth: '220px',
                padding: '6px 8px',
                borderRadius: '6px',
                border: `1px solid ${theme.border}`,
                backgroundColor: theme.surface1,
                color: theme.text,
                fontSize: '12px',
              }}
            >
              {modelIds.map((id) => (
                <option key={id} value={id}>{models[id]?.name ?? id}</option>
              ))}
            </select>
          }
        />
      )}

      <SettingsRow
        theme={theme}
        label={model?.name ?? activeModelId}
        hint={model?.description ?? 'Local model for offline commands.'}
        control={<SettingsBadge theme={theme} tone={statusTone}>{statusLabel}</SettingsBadge>}
      />

      <SettingsRow
        theme={theme}
        label="Location"
        hint={ready ? abbreviateHomePath(health?.modelPath) : `Target: ${abbreviateHomePath(health?.modelPath)}`}
      />

      <SettingsRow
        theme={theme}
        label="Size"
        hint={ready ? `${formatBytes(health?.fileSizeBytes)} available` : `${formatBytes(model?.sizeBytes)} download if needed`}
      />

      <SettingsRow
        theme={theme}
        label="License"
        hint={model?.license ?? 'Unknown'}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={() => void handlePrimaryAction()}
          disabled={installing}
          style={{
            padding: '7px 12px',
            borderRadius: '7px',
            border: `1px solid ${theme.border}`,
            backgroundColor: installing ? theme.selectedBg : theme.accent,
            color: installing ? theme.textSecondary : '#fff',
            fontSize: '12px',
            fontWeight: 600,
            cursor: installing ? 'default' : 'pointer',
          }}
        >
          {primaryLabel}
        </button>
        <span style={{ fontSize: '11px', color: theme.textSecondary }}>
          Existing GGUF files are reused instead of downloaded again.
        </span>
      </div>

      {message && <SettingsNotice theme={theme} tone="success">{message}</SettingsNotice>}
      {error && <SettingsNotice theme={theme} tone="warning">{error}</SettingsNotice>}

      <div style={{ height: '1px', backgroundColor: theme.border, opacity: 0.7 }} />

      <SettingsSectionHeading
        theme={theme}
        title="Meeting notes"
        description="Customize the Maxwell prompt used when meeting transcripts become summary notes."
      />

      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '12px',
          color: theme.text,
        }}
      >
        <span>Summary style prompt</span>
        <textarea
          aria-label="Meeting notes prompt"
          value={meetingSummaryPrompt}
          onChange={(event) => setMeetingSummaryPrompt(event.target.value)}
          spellCheck={false}
          style={{
            minHeight: '150px',
            resize: 'vertical',
            padding: '10px 12px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.surface1,
            color: theme.text,
            fontSize: '12px',
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          type="button"
          onClick={() => void handleSaveMeetingSummaryPrompt()}
          disabled={promptSaving || !meetingSummaryPrompt.trim()}
          style={{
            padding: '7px 12px',
            borderRadius: '7px',
            border: `1px solid ${theme.border}`,
            backgroundColor: promptSaving ? theme.selectedBg : theme.accent,
            color: promptSaving ? theme.textSecondary : '#fff',
            fontSize: '12px',
            fontWeight: 600,
            cursor: promptSaving || !meetingSummaryPrompt.trim() ? 'default' : 'pointer',
            opacity: !meetingSummaryPrompt.trim() ? 0.6 : 1,
          }}
        >
          {promptSaving ? 'Saving...' : 'Save prompt'}
        </button>
        <button
          type="button"
          onClick={() => void handleResetMeetingSummaryPrompt()}
          disabled={promptSaving}
          style={{
            padding: '7px 12px',
            borderRadius: '7px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.surface1,
            color: theme.text,
            fontSize: '12px',
            fontWeight: 600,
            cursor: promptSaving ? 'default' : 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      {promptMessage && <SettingsNotice theme={theme} tone="success">{promptMessage}</SettingsNotice>}
      {promptError && <SettingsNotice theme={theme} tone="warning">{promptError}</SettingsNotice>}
    </div>
  );
}
