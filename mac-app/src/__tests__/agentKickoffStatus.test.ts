import { describe, expect, it } from 'vitest';
import { getAgentKickoffFooterStatus } from '../utils/agentKickoffStatus';

describe('getAgentKickoffFooterStatus', () => {
  it('maps started agent kickoff events to running footer status', () => {
    expect(getAgentKickoffFooterStatus({
      runId: 'run-1',
      absPath: '/Users/afar/.fieldtheory/library/Notes/Entry.md',
      model: 'codex',
      status: 'started',
      message: 'Started. Waiting for agent output.',
    }, 123)).toEqual({
      status: 'running',
      message: 'Codex: Started. Waiting for agent output.',
      detail: 'Entry.md',
      eventKind: 'status',
      commandName: 'agent',
      filePath: '/Users/afar/.fieldtheory/library/Notes/Entry.md',
      runId: 'run-1',
      error: undefined,
      updatedAt: 123,
    });
  });

  it('maps failed agent kickoff events to error footer status', () => {
    expect(getAgentKickoffFooterStatus({
      runId: 'run-2',
      absPath: '/tmp/Trouble.md',
      model: 'claude',
      status: 'error',
      message: 'Agent exited with code 1',
      error: 'Agent exited with code 1',
    }, 456)).toMatchObject({
      status: 'error',
      message: 'Claude Code: Agent exited with code 1',
      detail: 'Trouble.md',
      eventKind: 'error',
      commandName: 'agent',
      runId: 'run-2',
      error: 'Agent exited with code 1',
      updatedAt: 456,
    });
  });
});
