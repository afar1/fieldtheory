import { TranscriptEntry } from '../types';

export const EMPTY_TRANSCRIPTION_TEXT = 'No speech detected in this recording.';

export type CapturedTranscript = {
  sourceText: string;
  entryId: string;
};

export function normalizeTranscriptText(transcription: string): string {
  const trimmed = transcription.trim();
  return trimmed.length > 0 ? trimmed : EMPTY_TRANSCRIPTION_TEXT;
}

export function createCapturedTranscriptEntry(
  transcription: string,
  now = Date.now(),
  randomSuffix = Math.random().toString(36).slice(2, 8),
): {
  entry: TranscriptEntry;
  capture: CapturedTranscript;
} {
  const sourceText = normalizeTranscriptText(transcription);
  const entryId = `${now}-${randomSuffix}`;
  const entry: TranscriptEntry = {
    id: entryId,
    text: sourceText,
    createdAt: now,
    updatedAt: now,
  };

  return {
    entry,
    capture: { sourceText, entryId },
  };
}

export function patchTranscriptEntryText(
  transcripts: TranscriptEntry[],
  entryId: string,
  text: string,
  updatedAt = Date.now(),
): {
  transcripts: TranscriptEntry[];
  didPatch: boolean;
} {
  let didPatch = false;
  const next = transcripts.map((entry) => {
    if (entry.id !== entryId) return entry;
    didPatch = true;
    return { ...entry, text, updatedAt };
  });

  return {
    transcripts: didPatch ? next : transcripts,
    didPatch,
  };
}
