import { describe, expect, it } from 'vitest';

import {
  PARAKEET_ENGINE_LABELS,
  PARAKEET_ENGINE_MODEL_IDS,
  isParakeetEngine,
} from './transcribe';

describe('transcribe helpers', () => {
  it('detects parakeet engines', () => {
    expect(isParakeetEngine('parakeet')).toBe(true);
    expect(isParakeetEngine('parakeet-multilingual')).toBe(true);
    expect(isParakeetEngine('whisper')).toBe(false);
    expect(isParakeetEngine(undefined)).toBe(false);
  });

  it('maps parakeet engines to stable model ids and labels', () => {
    expect(PARAKEET_ENGINE_MODEL_IDS.parakeet).toBe('nemo-parakeet-tdt-0.6b-v2');
    expect(PARAKEET_ENGINE_MODEL_IDS['parakeet-multilingual']).toBe('nemo-parakeet-tdt-0.6b-v3');
    expect(PARAKEET_ENGINE_LABELS.parakeet).toBe('Parakeet English');
    expect(PARAKEET_ENGINE_LABELS['parakeet-multilingual']).toBe('Parakeet Multilingual');
  });
});
