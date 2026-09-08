import type { VoiceInboxPresentation } from './voiceInboxPresentation';

/** User-visible contract for the bundled Voice requests worker. */
export interface VoiceWorkSettings {
  enabled: boolean;
  workspacePath: string | null;
}

export interface VoiceWorkTask {
  threadId: string;
  title?: string;
  status: string;
  summary?: string;
  finalResponse?: string;
  question?: string;
  canOpen?: boolean;
}

export interface VoiceWorkState {
  settings: VoiceWorkSettings;
  status: 'disabled' | 'signed_out' | 'connecting' | 'ready' | 'working' | 'needs_setup' | 'error';
  message?: string;
  codex: { available: boolean; signedIn: boolean | null };
  /** The durable account-scoped Codex routing conversation, once created. */
  inboxThreadId?: string;
  lastEventAt?: number;
  lastTask?: VoiceWorkTask;
}

export interface VoiceWorkAPI {
  getState(): Promise<VoiceWorkState>;
  updateSettings(settings: Partial<VoiceWorkSettings>): Promise<VoiceWorkState>;
  listFolders(): Promise<Array<{ path: string; label: string }>>;
  getInboxPresentation(): Promise<VoiceInboxPresentation>;
  onInboxChanged(callback: () => void): () => void;
  refreshStatus(): Promise<VoiceWorkState>;
  openTask(threadId: string): Promise<{ opened: boolean; error?: string }>;
  onStateChanged(callback: (state: VoiceWorkState) => void): () => void;
}

export const VOICE_WORK_CHANNELS = {
  getState: 'voiceWork:getState',
  updateSettings: 'voiceWork:updateSettings',
  listFolders: 'voiceWork:listFolders',
  getInboxPresentation: 'voiceWork:getInboxPresentation',
  inboxChanged: 'voiceWork:inboxChanged',
  refreshStatus: 'voiceWork:refreshStatus',
  openTask: 'voiceWork:openTask',
  stateChanged: 'voiceWork:stateChanged',
} as const;
