import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  SETTINGS_CARD_GAP,
  SettingsBadge,
  SettingsCard,
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
  ollamaTag?: string;
};

type LocalModelHealth = {
  status: 'ready' | 'missing' | 'corrupt';
  modelPath: string;
  fileSizeBytes: number | null;
  expectedSizeBytes: number;
  minValidSizeBytes: number;
};

const FALLBACK_MODEL_ID = 'gemma-4-12B-it-Q4_K_M';
const FALLBACK_MODEL_FILENAME = 'gemma-4-12B-it-Q4_K_M.gguf';
const FALLBACK_MODEL_SOURCE_URL = 'https://huggingface.co/ggml-org/gemma-4-12B-it-GGUF';
const FIELD_THEORY_MODEL_DIR = '~/.fieldtheory/models';

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return 'Unknown';
  const gib = bytes / (1024 ** 3);
  return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`;
}

function abbreviateHomePath(filePath: string | undefined): string {
  if (!filePath) return 'Unknown';
  return filePath.replace(/^\/Users\/[^/]+/, '~');
}

function getFieldTheoryModelPath(filename: string | undefined): string {
  return `${FIELD_THEORY_MODEL_DIR}/${filename ?? FALLBACK_MODEL_FILENAME}`;
}

function getGemmaDownloadCommand(model: LocalModelInfo | undefined): string {
  const filename = model?.filename ?? FALLBACK_MODEL_FILENAME;
  const sourceUrl = model?.sourceUrl ?? FALLBACK_MODEL_SOURCE_URL;
  return `mkdir -p ${FIELD_THEORY_MODEL_DIR} && curl -L --fail --continue-at - -o ${getFieldTheoryModelPath(filename)} "${sourceUrl}/resolve/main/${filename}?download=true"`;
}

function getGemmaLinkCommand(model: LocalModelInfo | undefined): string {
  const filename = model?.filename ?? FALLBACK_MODEL_FILENAME;
  return `mkdir -p ${FIELD_THEORY_MODEL_DIR} && test -f "<paste-your-existing-gguf-path-here>" && ln -sf "<paste-your-existing-gguf-path-here>" ${getFieldTheoryModelPath(filename)}`;
}

function getOllamaGemmaCommand(model: LocalModelInfo | undefined): string {
  return `brew install ollama llama.cpp && ollama pull ${model?.ollamaTag ?? 'gemma4:12b'}`;
}

export default function LocalModelSettings() {
  const { theme } = useTheme();
  const [models, setModels] = useState<Record<string, LocalModelInfo>>({});
  const [healthByModel, setHealthByModel] = useState<Record<string, LocalModelHealth>>({});
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODEL_ID);
  const [loading, setLoading] = useState(true);
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState<'ollama' | 'download' | 'link' | null>(null);

  const load = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.getLocalLLMModels || !api.getLocalLLMSelected || !api.getLocalLLMHealth) {
      setError('Local model settings are unavailable in this build.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [nextModels, nextSelected, nextHealth] = await Promise.all([
        api.getLocalLLMModels(),
        api.getLocalLLMSelected(),
        api.getLocalLLMHealth(),
      ]);
      setModels(nextModels);
      setSelectedModel(nextSelected || FALLBACK_MODEL_ID);
      setHealthByModel(nextHealth);
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
  const activeModelId = models[selectedModel] ? selectedModel : modelIds[0] ?? FALLBACK_MODEL_ID;
  const model = models[activeModelId];
  const health = healthByModel[activeModelId];
  const ready = health?.status === 'ready';
  const statusTone = ready ? 'success' : health?.status === 'corrupt' ? 'warning' : 'neutral';
  const statusLabel = ready ? 'Ready' : health?.status === 'corrupt' ? 'Invalid file' : 'Missing';
  const ollamaCommand = getOllamaGemmaCommand(model);
  const downloadCommand = getGemmaDownloadCommand(model);
  const linkCommand = getGemmaLinkCommand(model);

  const handleCopyCommand = useCallback(async (kind: 'ollama' | 'download' | 'link', command: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = command;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedCommand(kind);
      window.setTimeout(() => {
        setCopiedCommand((current) => (current === kind ? null : current));
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy command.');
    }
  }, []);

  const handleSelectModel = useCallback(async (modelId: string) => {
    const api = window.clipboardAPI;
    setSelectedModel(modelId);
    setError(null);
    setMessage(null);
    if (!api?.setLocalLLMSelected) return;

    try {
      const selected = await api.setLocalLLMSelected(modelId);
      if (!selected.success) {
        setError(selected.error ?? 'Could not select local model.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not select local model.');
    }
  }, []);

  const handleFindGemma = useCallback(async () => {
    const api = window.clipboardAPI;
    if (!api?.getLocalLLMHealth || !api.setLocalLLMSelected) return;

    setError(null);
    setMessage(null);
    setFinding(true);

    try {
      const nextHealth = await api.getLocalLLMHealth();
      setHealthByModel(nextHealth);
      const activeHealth = nextHealth[activeModelId];
      if (activeHealth?.status !== 'ready') {
        setError(`Gemma was not found yet. Put ${model?.filename ?? FALLBACK_MODEL_FILENAME} in ${FIELD_THEORY_MODEL_DIR}, or link an existing GGUF file there, then click Find Gemma again.`);
        return;
      }

      const selected = await api.setLocalLLMSelected(activeModelId);
      if (!selected.success) {
        setError(selected.error ?? 'Could not select local model.');
        return;
      }

      const enabled = await api.setUseLocalLLM?.(true);
      if (enabled && !enabled.success) {
        setError(enabled.error ?? 'Could not enable local model.');
        return;
      }
      setMessage('Found Gemma and enabled local commands.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check for Gemma.');
    } finally {
      setFinding(false);
    }
  }, [activeModelId, model?.filename]);

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_CARD_GAP }}>
      <SettingsSectionHeading
        theme={theme}
        title="Local model"
        description="Use Gemma for offline portable commands. Install the model in Terminal, then let Field Theory find it."
      />

      <SettingsCard theme={theme}>
        {modelIds.length > 1 && (
          <SettingsRow
            theme={theme}
            label="Model"
            control={
              <select
                value={activeModelId}
                onChange={(event) => void handleSelectModel(event.target.value)}
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
          last
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0' }}>
          <button
            type="button"
            onClick={() => void handleFindGemma()}
            disabled={finding}
            style={{
              padding: '7px 12px',
              borderRadius: '7px',
              border: `1px solid ${theme.border}`,
              backgroundColor: finding ? theme.selectedBg : theme.accent,
              color: finding ? theme.textSecondary : '#fff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: finding ? 'default' : 'pointer',
            }}
          >
            {finding ? 'Finding...' : 'Find Gemma'}
          </button>
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            Safe to click anytime. It only checks for Gemma and enables it.
          </span>
        </div>
      </SettingsCard>

      <SettingsCard theme={theme}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
            Setup steps
          </div>
          <div style={{ fontSize: '11px', lineHeight: 1.45, color: theme.textSecondary }}>
            Step 1: install Ollama and pull Gemma 4 in Terminal. Step 2: put the Gemma 4 GGUF at {getFieldTheoryModelPath(model?.filename)}, or link an existing GGUF there. Step 3: click Find Gemma.
          </div>
          <TerminalCommand
            label="1. Install Ollama and Gemma 4"
            command={ollamaCommand}
            copied={copiedCommand === 'ollama'}
            onCopy={() => void handleCopyCommand('ollama', ollamaCommand)}
            theme={theme}
          />
          <TerminalCommand
            label="2. Download Gemma 4 GGUF for Field Theory"
            command={downloadCommand}
            copied={copiedCommand === 'download'}
            onCopy={() => void handleCopyCommand('download', downloadCommand)}
            theme={theme}
          />
          <TerminalCommand
            label="Or link an existing GGUF"
            command={linkCommand}
            copied={copiedCommand === 'link'}
            onCopy={() => void handleCopyCommand('link', linkCommand)}
            theme={theme}
          />
        </div>
      </SettingsCard>

      {message && <SettingsNotice theme={theme} tone="success">{message}</SettingsNotice>}
      {error && <SettingsNotice theme={theme} tone="warning">{error}</SettingsNotice>}
    </div>
  );
}

function TerminalCommand({
  label,
  command,
  copied,
  onCopy,
  theme,
}: {
  label: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, color: theme.text }}>{label}</span>
        <button
          type="button"
          onClick={onCopy}
          style={{
            padding: '4px 8px',
            borderRadius: '6px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.surface2 ?? theme.surface1,
            color: theme.text,
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code
        style={{
          display: 'block',
          padding: '7px 8px',
          borderRadius: '6px',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.isDark ? 'rgba(15, 23, 42, 0.5)' : '#f8fafc',
          color: theme.text,
          fontSize: '11px',
          lineHeight: 1.4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          userSelect: 'text',
        }}
      >
        {command}
      </code>
    </div>
  );
}
