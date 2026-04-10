export type VisibleTranscriptionEngine = 'whisper' | 'parakeet' | 'parakeet-multilingual';
export type VisibleParakeetEngine = Exclude<VisibleTranscriptionEngine, 'whisper'>;

export type VisibleParakeetEngineStatus = {
  engine: VisibleParakeetEngine;
  verified: boolean;
  needsReinstall: boolean;
  lastError: string | null;
  lastErrorDetail?: string | null;
  lastErrorAt?: string | null;
};

export type VisibleParakeetActionLabel = 'Install' | 'Verify' | 'Retry' | 'Reinstall';

export type VisibleParakeetStatus = {
  runtimeInstalled: boolean;
  engines: VisibleParakeetEngineStatus[];
} | null | undefined;

export type VisibleTranscriptionEngineOption = {
  id: VisibleTranscriptionEngine;
  label: string;
  description: string;
  sizeLabel?: string;
  recommended?: boolean;
};

/** Parakeet rows only (excludes whisper) so engine pickers type-check against Parakeet helpers. */
export type ParakeetVisibleEngineOption = Omit<VisibleTranscriptionEngineOption, 'id'> & {
  id: VisibleParakeetEngine;
};

export const DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE: VisibleTranscriptionEngine = 'parakeet';
export const DEFAULT_VISIBLE_PARAKEET_ENGINE: VisibleParakeetEngine = 'parakeet';

export const PARAKEET_VISIBLE_ENGINE_OPTIONS: ParakeetVisibleEngineOption[] = [
  {
    id: 'parakeet',
    label: 'Parakeet English',
    description: 'NVIDIA Parakeet TDT 0.6B v2 — fast, high-accuracy English ASR',
    sizeLabel: '~600 MB',
    recommended: true,
  },
  {
    id: 'parakeet-multilingual',
    label: 'Parakeet Multilingual',
    description: 'NVIDIA Parakeet TDT 0.6B v3 — local multilingual ASR',
    sizeLabel: '~600 MB',
  },
];

export const PARAKEET_ONE_TIME_SETUP_NOTE =
  'First setup downloads the selected model once, then Parakeet runs locally offline.';

export function normalizeVisibleTranscriptionEngine(
  engine: string | null | undefined
): VisibleTranscriptionEngine {
  if (engine === 'whisper' || engine === 'parakeet' || engine === 'parakeet-multilingual') {
    return engine;
  }
  return DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE;
}

export function getVisibleParakeetEngineStatus(
  status: VisibleParakeetStatus,
  engine: VisibleParakeetEngine
): VisibleParakeetEngineStatus | null {
  return status?.engines.find((entry) => entry.engine === engine) ?? null;
}

export function isVisibleParakeetEngineVerified(
  status: VisibleParakeetStatus,
  engine: VisibleParakeetEngine
): boolean {
  return Boolean(getVisibleParakeetEngineStatus(status, engine)?.verified);
}

export function hasVisibleParakeetRuntime(status: VisibleParakeetStatus): boolean {
  return Boolean(status?.runtimeInstalled);
}

export function isVisibleParakeetTimeoutError(error: string | null | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return normalized.includes('startup timed out') || normalized.includes('model verification timed out');
}

export function getVisibleParakeetActionLabel(
  status: VisibleParakeetEngineStatus | null,
  runtimeInstalled: boolean
): VisibleParakeetActionLabel {
  if (status?.needsReinstall) {
    return isVisibleParakeetTimeoutError(status.lastError) ? 'Retry' : 'Reinstall';
  }

  return runtimeInstalled ? 'Verify' : 'Install';
}

export function getVisibleParakeetPendingActionLabel(
  actionLabel: VisibleParakeetActionLabel
): 'Installing...' | 'Verifying...' | 'Retrying...' | 'Reinstalling...' {
  if (actionLabel === 'Verify') return 'Verifying...';
  if (actionLabel === 'Retry') return 'Retrying...';
  if (actionLabel === 'Reinstall') return 'Reinstalling...';
  return 'Installing...';
}

export function getVisibleParakeetRecoveryMessage(error: string | null | undefined): string | null {
  if (!error?.trim()) return null;

  if (isVisibleParakeetTimeoutError(error)) {
    return 'The runtime installed, but the model did not finish downloading or loading in time. Retry on a stable internet connection. If it repeats, open Settings > Diagnostics and send it to support.';
  }

  const normalized = error.toLowerCase();
  if (
    normalized.includes('failed to load') ||
    normalized.includes('exited during startup') ||
    normalized.includes('onnx-asr is not installed') ||
    normalized.includes('no such file or directory')
  ) {
    return 'Field Theory could not start the Parakeet runtime cleanly. Remove Parakeet and install it again. If it repeats, open Settings > Diagnostics and send it to support.';
  }

  return 'Retry once. If it repeats, open Settings > Diagnostics and send it to support so we can inspect the Parakeet error.';
}
