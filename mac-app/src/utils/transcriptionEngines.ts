import type { ParakeetSetupError } from '../types/window';

export type VisibleTranscriptionEngine = 'parakeet' | 'parakeet-multilingual';
export type VisibleParakeetEngine = VisibleTranscriptionEngine;

export type VisibleParakeetEngineStatus = {
  engine: VisibleParakeetEngine;
  verified: boolean;
  needsReinstall: boolean;
  lastError: string | null;
  lastErrorDetail?: string | null;
  lastErrorAt?: string | null;
  setupError?: ParakeetSetupError | null;
};

export type VisibleParakeetActionLabel = 'Install' | 'Verify' | 'Retry' | 'Repair model' | 'Reinstall';

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
  if (engine === 'parakeet' || engine === 'parakeet-multilingual') {
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

export function isVisibleParakeetRepairableCacheError(error: string | null | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  const missingFile =
    normalized.includes('no such file or directory') ||
    normalized.includes('filesystem error: in file_size');
  if (!missingFile) return false;

  return normalized.includes('.onnx.data') ||
    normalized.includes('huggingface') ||
    normalized.includes('/snapshots/') ||
    normalized.includes('models--');
}

export function getVisibleParakeetActionLabel(
  status: VisibleParakeetEngineStatus | null,
  runtimeInstalled: boolean
): VisibleParakeetActionLabel {
  if (status?.needsReinstall) {
    if (isVisibleParakeetTimeoutError(status.lastError)) {
      return 'Retry';
    }
    if (isVisibleParakeetRepairableCacheError(status.lastError)) {
      return 'Repair model';
    }
    return 'Reinstall';
  }

  return runtimeInstalled ? 'Verify' : 'Install';
}

export function getVisibleParakeetPendingActionLabel(
  actionLabel: VisibleParakeetActionLabel
): 'Installing...' | 'Verifying...' | 'Retrying...' | 'Repairing model...' | 'Reinstalling...' {
  if (actionLabel === 'Verify') return 'Verifying...';
  if (actionLabel === 'Retry') return 'Retrying...';
  if (actionLabel === 'Repair model') return 'Repairing model...';
  if (actionLabel === 'Reinstall') return 'Reinstalling...';
  return 'Installing...';
}

export function getVisibleParakeetRecoveryMessage(error: string | null | undefined): string | null {
  if (!error?.trim()) return null;

  if (isVisibleParakeetTimeoutError(error)) {
    return 'The runtime installed, but the model did not finish downloading or loading in time. Retry on a stable internet connection. If it repeats, open Settings > Diagnostics and send it to support.';
  }

  if (isVisibleParakeetRepairableCacheError(error)) {
    return 'Field Theory found a broken Parakeet model download. Repair the model to clear the cached snapshot and download it again. If it repeats, open Settings > Diagnostics and send it to support.';
  }

  const normalized = error.toLowerCase();
  if (
    normalized.includes('python 3.10') ||
    normalized.includes('python 3.12') ||
    normalized.includes('missing-python') ||
    normalized.includes('unsupported-python')
  ) {
    return 'Install a supported Python with Homebrew, then retry Parakeet setup.';
  }

  if (normalized.includes('virtual environment') || normalized.includes('python -m venv') || normalized.includes('venv')) {
    return 'Field Theory found Python, but it could not create a virtual environment. Install Homebrew Python 3.12, then retry Parakeet setup.';
  }

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
