import type { TranscriptionEngine } from './transcribe';

export type HotMicEngineReadiness =
  | 'ready'
  | 'warming'
  | 'cold'
  | 'not-installed'
  | 'not-downloaded'
  | 'corrupt'
  | 'unsupported-arch'
  | 'disabled';

export interface HotMicEngineStatus {
  selectedEngine: TranscriptionEngine;
  source: 'global';
  whisperModel: string | null;
  readiness: HotMicEngineReadiness;
  detail: string | null;
  fallbackAvailable: boolean;
}
