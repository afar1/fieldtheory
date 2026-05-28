import type { CodexTerminalSessionSummary } from './codexTerminalManager';
import type { TranscriptionStatus } from './transcriberManager';

export type QuitBlockingActivityKind =
  | 'transcription'
  | 'hot-mic'
  | 'local-model'
  | 'agent-run'
  | 'codex-terminal';

export interface QuitBlockingActivity {
  kind: QuitBlockingActivityKind;
  label: string;
}

export interface QuitBlockingActivitySnapshot {
  transcriptionStatus?: TranscriptionStatus | null;
  hotMicActive?: boolean;
  localLlmActive?: boolean;
  agentRunCount?: number;
  codexTerminalSessions?: Pick<CodexTerminalSessionSummary, 'exitedAt' | 'modelRunActive'>[];
}

export function getActiveCodexTerminalModelRunCount(
  sessions: Pick<CodexTerminalSessionSummary, 'exitedAt' | 'modelRunActive'>[] = [],
): number {
  return sessions.filter((session) => !session.exitedAt && session.modelRunActive).length;
}

export function collectQuitBlockingActivities(snapshot: QuitBlockingActivitySnapshot): QuitBlockingActivity[] {
  const activities: QuitBlockingActivity[] = [];
  const transcriptionStatus = snapshot.transcriptionStatus ?? 'idle';
  if (transcriptionStatus !== 'idle') {
    activities.push({
      kind: 'transcription',
      label: transcriptionStatus === 'silentStacking'
        ? 'Silent screenshot stacking is still active.'
        : transcriptionStatus === 'recording'
          ? 'A recording is still active.'
          : 'A transcription is still processing.',
    });
  }

  if (snapshot.hotMicActive) {
    activities.push({ kind: 'hot-mic', label: 'Hot Mic is still listening.' });
  }

  if (snapshot.localLlmActive) {
    activities.push({ kind: 'local-model', label: 'A local model command is still running.' });
  }

  const agentRunCount = Math.max(0, Math.floor(snapshot.agentRunCount ?? 0));
  if (agentRunCount > 0) {
    activities.push({
      kind: 'agent-run',
      label: agentRunCount === 1
        ? 'One local agent run is still running.'
        : `${agentRunCount} local agent runs are still running.`,
    });
  }

  const terminalCount = getActiveCodexTerminalModelRunCount(snapshot.codexTerminalSessions);
  if (terminalCount > 0) {
    activities.push({
      kind: 'codex-terminal',
      label: terminalCount === 1
        ? 'One embedded Codex model turn is still running.'
        : `${terminalCount} embedded Codex model turns are still running.`,
    });
  }

  return activities;
}

export function formatQuitBlockingActivityDetail(activities: QuitBlockingActivity[]): string {
  if (activities.length === 0) return '';
  return [
    ...activities.map((activity) => `- ${activity.label}`),
    '',
    'Quitting now will stop this local work.',
  ].join('\n');
}
