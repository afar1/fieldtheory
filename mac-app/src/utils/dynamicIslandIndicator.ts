export type DynamicIslandInputMode = 'hot-mic' | 'standard';

export type DynamicIslandTranscriptionState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'showing-transcript'
  | 'improving';

export interface LeftModeDotPresentation {
  color: string;
  shadow: string;
}

const WHITE_DOT: LeftModeDotPresentation = {
  color: 'rgba(255, 255, 255, 0.92)',
  shadow: '0 0 6px rgba(255, 255, 255, 0.22)',
};

const ORANGE_DOT: LeftModeDotPresentation = {
  color: 'rgba(249, 115, 22, 0.95)',
  shadow: '0 0 8px rgba(249, 115, 22, 0.5)',
};

const RED_DOT: LeftModeDotPresentation = {
  color: 'rgba(239, 68, 68, 0.95)',
  shadow: '0 0 8px rgba(239, 68, 68, 0.45)',
};

export function getLeftModeDotPresentation(
  inputMode: DynamicIslandInputMode,
  state: DynamicIslandTranscriptionState
): LeftModeDotPresentation {
  if (state === 'recording' || state === 'transcribing') {
    return RED_DOT;
  }

  if (inputMode === 'hot-mic') {
    return ORANGE_DOT;
  }

  return WHITE_DOT;
}
