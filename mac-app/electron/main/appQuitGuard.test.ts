import { describe, expect, it } from 'vitest';
import {
  collectQuitBlockingActivities,
  formatQuitBlockingActivityDetail,
  getActiveCodexTerminalSessionCount,
} from './appQuitGuard';

describe('appQuitGuard', () => {
  it('returns no blocking activities when local work is idle', () => {
    expect(collectQuitBlockingActivities({
      transcriptionStatus: 'idle',
      hotMicActive: false,
      localLlmActive: false,
      agentRunCount: 0,
      codexTerminalSessions: [{ exitedAt: new Date().toISOString() }],
    })).toEqual([]);
  });

  it('summarizes active local work that quit would stop', () => {
    const activities = collectQuitBlockingActivities({
      transcriptionStatus: 'recording',
      hotMicActive: true,
      localLlmActive: true,
      agentRunCount: 2,
      codexTerminalSessions: [
        { exitedAt: null },
        { exitedAt: new Date().toISOString() },
        { exitedAt: null },
      ],
    });

    expect(activities.map((activity) => activity.kind)).toEqual([
      'transcription',
      'hot-mic',
      'local-model',
      'agent-run',
      'codex-terminal',
    ]);
    expect(formatQuitBlockingActivityDetail(activities)).toContain('A recording is still active.');
    expect(formatQuitBlockingActivityDetail(activities)).toContain('2 local agent runs are still running.');
    expect(formatQuitBlockingActivityDetail(activities)).toContain('2 embedded Codex terminal sessions are still running.');
    expect(formatQuitBlockingActivityDetail(activities)).toContain('Quitting now will stop this local work.');
  });

  it('counts only live Codex terminal sessions', () => {
    expect(getActiveCodexTerminalSessionCount([
      { exitedAt: null },
      { exitedAt: '2026-05-28T00:00:00.000Z' },
    ])).toBe(1);
  });
});
