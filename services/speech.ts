import {
  EmitterSubscription,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

type NativeVoice = {
  id: string;
  language: string;
  isPersonalVoice: boolean;
};

export type SpeechPlaybackState = 'speaking' | 'paused' | 'stopped';

const SAMANTHA_ID = 'com.apple.voice.compact.en-US.Samantha';
const VoiceSamplerModule = Platform.OS === 'ios' ? NativeModules.VoiceSamplerModule : null;
const speechEventEmitter =
  Platform.OS === 'ios' && VoiceSamplerModule
    ? new NativeEventEmitter(VoiceSamplerModule)
    : null;

async function listVoices(): Promise<NativeVoice[]> {
  if (!VoiceSamplerModule?.listVoices) {
    return [];
  }

  try {
    const voices = await VoiceSamplerModule.listVoices();
    return Array.isArray(voices) ? voices : [];
  } catch (error) {
    console.error('Failed to list speech voices:', error);
    return [];
  }
}

export async function resolvePreferredReadbackVoiceIdentifier(
  preferredVoiceIdentifier?: string
): Promise<string | null> {
  const voices = await listVoices();

  if (voices.length === 0) {
    return null;
  }

  if (preferredVoiceIdentifier && voices.some((voice) => voice.id === preferredVoiceIdentifier)) {
    return preferredVoiceIdentifier;
  }

  const personalVoice = voices.find((voice) => voice.isPersonalVoice);
  if (personalVoice) {
    return personalVoice.id;
  }

  const samantha = voices.find((voice) => voice.id === SAMANTHA_ID);
  if (samantha) {
    return samantha.id;
  }

  const englishVoice = voices.find((voice) => voice.language.startsWith('en'));
  return englishVoice?.id ?? voices[0]?.id ?? null;
}

export async function speakReadback(
  text: string,
  preferredVoiceIdentifier?: string
): Promise<boolean> {
  const trimmedText = text.trim();

  if (!trimmedText || !VoiceSamplerModule?.speak) {
    return false;
  }

  const voiceIdentifier = await resolvePreferredReadbackVoiceIdentifier(preferredVoiceIdentifier);
  if (!voiceIdentifier) {
    return false;
  }

  VoiceSamplerModule.speak(voiceIdentifier, trimmedText);
  return true;
}

export function pauseReadback(): void {
  VoiceSamplerModule?.pause?.();
}

export function resumeReadback(): void {
  VoiceSamplerModule?.resume?.();
}

export function stopReadback(): void {
  VoiceSamplerModule?.stop?.();
}

export function subscribeToSpeechPlaybackState(
  listener: (state: SpeechPlaybackState) => void
): EmitterSubscription | null {
  if (!speechEventEmitter) {
    return null;
  }

  return speechEventEmitter.addListener('speechStateDidChange', (event?: { state?: string }) => {
    if (event?.state === 'speaking' || event?.state === 'paused' || event?.state === 'stopped') {
      listener(event.state);
    }
  });
}
