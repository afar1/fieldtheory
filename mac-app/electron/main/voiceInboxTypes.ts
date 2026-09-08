export interface VoiceInboxTranscript {
  userId: string;
  transcriptId: string;
  text: string;
  createdAtMs: number;
  updatedAtMs: number;
  deletedAt?: string | null;
}

export interface VoiceInboxDispatch {
  transcriptId: string;
  threadId: string;
  /** An actual turn/start acknowledgement, not the backend dispatch boundary. */
  turnId?: string;
  /** Historical completed jobs are also confirmed execution evidence. */
  completed?: boolean;
  dispatchedAt?: string;
}

export interface VoiceInboxCursor {
  updatedAt: string;
  id: string;
}

export type VoiceInboxCursorKind = 'transcripts' | 'jobs';
export type VoiceInboxWriteResult = {
  transcriptId: string;
  status: 'created' | 'updated' | 'unchanged' | 'preserved' | 'skipped' | 'pending';
  notePath: string | null;
};
