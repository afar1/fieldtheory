export type VisibleTranscriptionEngine = 'whisper' | 'parakeet' | 'parakeet-multilingual';
export type VisibleParakeetEngine = Exclude<VisibleTranscriptionEngine, 'whisper'>;

export type VisibleTranscriptionEngineOption = {
  id: VisibleTranscriptionEngine;
  label: string;
  description: string;
  sizeLabel?: string;
  recommended?: boolean;
};

export const DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE: VisibleTranscriptionEngine = 'parakeet';
export const DEFAULT_VISIBLE_PARAKEET_ENGINE: VisibleParakeetEngine = 'parakeet';

export const PARAKEET_VISIBLE_ENGINE_OPTIONS: VisibleTranscriptionEngineOption[] = [
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

export function normalizeVisibleTranscriptionEngine(
  engine: string | null | undefined
): VisibleTranscriptionEngine {
  if (engine === 'whisper' || engine === 'parakeet' || engine === 'parakeet-multilingual') {
    return engine;
  }
  return DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE;
}
