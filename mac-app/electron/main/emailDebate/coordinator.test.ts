import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('./transport', () => ({
  sendDebateEmail: vi.fn().mockResolvedValue('<sent@fieldtheory.app>'),
  testSmtpConnection: vi.fn().mockResolvedValue(true),
  testImapConnection: vi.fn().mockResolvedValue(true),
  pollForReplies: vi.fn().mockResolvedValue([]),
  generateMessageId: vi.fn((threadId: string, turn: number) => `<council-${threadId}-turn-${turn}@fieldtheory.app>`),
  generateRootMessageId: vi.fn((threadId: string) => `<council-${threadId}-root@fieldtheory.app>`),
  stripQuotedReply: vi.fn((body: string) => body),
  formatDebatePlainText: vi.fn((body: string, speaker: string) => `${speaker}\n\n${body}`),
}));

vi.mock('./agentMailTransport', () => ({
  MODEL_INBOXES: {
    opus: { username: 'opus', displayName: 'Claude Opus' },
    sonnet: { username: 'sonnet', displayName: 'Claude Sonnet' },
    codex: { username: 'codex', displayName: 'Codex (OpenAI)' },
    council: { username: 'council', displayName: 'Field Theory Council' },
  },
  checkForReplies: vi.fn().mockResolvedValue([]),
  provisionAllInboxes: vi.fn().mockResolvedValue(undefined),
  replyToDebateEmail: vi.fn().mockResolvedValue({ messageId: 'reply-msg', threadId: 'provider-thread-1' }),
  sendNewDebateEmail: vi.fn().mockResolvedValue({ messageId: 'root-msg', threadId: 'provider-thread-1' }),
  testConnection: vi.fn().mockResolvedValue({ ok: true, inboxCount: 2 }),
}));

import { EmailDebateManager } from './manager';
import { EmailDebateCoordinator } from './coordinator';
import { pollForReplies, sendDebateEmail } from './transport';

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

const TEST_CONFIG = {
  smtp: { host: 'smtp.test.com', port: 587, secure: false, user: 'test', pass: 'pass' },
  imap: { host: 'imap.test.com', port: 993, secure: true, user: 'test', pass: 'pass' },
  fromAddress: 'council@test.com',
  fromName: 'Test Council',
  defaultRecipients: ['user@test.com'],
  pollIntervalMs: 60_000,
  enabled: true,
  outboundTransport: 'smtp' as const,
  inboundTransport: 'imap' as const,
  agentMailApiKey: '',
  agentMailDomain: 'agentmail.to',
  agentMailInboxIds: {},
};

describe('EmailDebateCoordinator', () => {
  let tmpDir: string;
  let councilPath: string;
  let emailManager: EmailDebateManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emaildebate-coordinator-test-'));
    councilPath = path.join(tmpDir, 'council.sh');
    fs.writeFileSync(councilPath, '#!/usr/bin/env bash\n', 'utf-8');
    emailManager = new EmailDebateManager(TEST_CONFIG, tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    emailManager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts a local debate process and tracks the thread', () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const result = coordinator.startDebate({
      topic: 'Debate topic',
      matchup: 'opus-vs-codex',
      maxTurns: 4,
    });

    expect(result.threadId).toBeTruthy();
    expect(coordinator.getActiveThreadIds()).toContain(result.threadId);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--json-events');
    coordinator.destroy();
  });

  it('forwards council events from stdout into the email manager', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const { threadId } = coordinator.startDebate({
      topic: 'Debate topic',
      matchup: 'opus-vs-codex',
    });

    child.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({ type: 'debate_start', topic: 'Debate topic', maxTurns: '6' })}\n`
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
    expect(emailManager.getThread(threadId)).not.toBeNull();
    coordinator.destroy();
  });

  it('supports multiple concurrent debate processes', () => {
    const childA = new FakeChildProcess();
    const childB = new FakeChildProcess();
    const spawnFn = vi
      .fn()
      .mockReturnValueOnce(childA)
      .mockReturnValueOnce(childB);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const a = coordinator.startDebate({ topic: 'A', matchup: 'opus-vs-opus' });
    const b = coordinator.startDebate({ topic: 'B', matchup: 'opus-vs-codex' });

    expect(a.threadId).not.toBe(b.threadId);
    expect(coordinator.getActiveThreadIds()).toHaveLength(2);

    childA.emit('close', 0);
    expect(coordinator.getActiveThreadIds()).toHaveLength(1);

    childB.emit('close', 0);
    expect(coordinator.getActiveThreadIds()).toHaveLength(0);
    coordinator.destroy();
  });

  it('resumes a paused thread with the new human input', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const thread = emailManager.createThread({
      topic: 'Paused thread',
      matchup: 'opus-vs-codex',
    });

    await emailManager.handleCouncilEvent(thread.id, {
      type: 'pause_requested',
      reason: 'Need human input',
      round: '1',
      stateFilePath: '/tmp/paused.state.json',
    });

    const result = coordinator.handleHumanReply(thread.id, 'Please focus on performance.');

    expect(result).toEqual({ success: true, mode: 'resume' });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--resume-state');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('/tmp/paused.state.json');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--human-input');
    coordinator.destroy();
  });

  it('starts an existing inbound thread using its stored kickoff metadata', () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const thread = emailManager.createThread({
      topic: 'Inbound email topic',
      matchup: 'codex-vs-opus',
      maxTurns: 6,
      recipients: ['human@example.com'],
      source: 'email',
      addressedModels: ['codex', 'opus'],
      preferredStartSide: 'a',
      inboundMessageId: '<orig@fieldtheory.dev>',
      providerThreadId: 'provider-thread-inbound',
    });

    const result = coordinator.startThread(thread.id);

    expect(result).toEqual({ success: true });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--start-side');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('a');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('Inbound email topic');
    coordinator.destroy();
  });

  it('starts a fresh follow-up round for reopened threads without a resume state', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const thread = emailManager.createThread({
      topic: 'Follow-up thread',
      matchup: 'opus-vs-codex',
      maxTurns: 4,
      repoPath: '/tmp/repo',
    });

    emailManager.bufferTurnChunk(thread.id, 'Earlier point.');
    await emailManager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });
    await emailManager.handleCouncilEvent(thread.id, {
      type: 'debate_complete',
      totalRounds: '1',
      outcome: 'FINALIZING',
    });

    const result = coordinator.handleHumanReply(thread.id, 'Keep going, but narrow to implementation risk.');

    expect(result).toEqual({ success: true, mode: 'follow_up' });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--matchup');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('opus-vs-codex');
    expect(spawnFn.mock.calls[0]?.[1]).toContain('--repo');
    expect(String(spawnFn.mock.calls[0]?.[1].at(-1))).toContain('implementation risk');
    coordinator.destroy();
  });

  it('flushes a trailing buffered JSON event on process close', async () => {
    const child = new FakeChildProcess();
    const spawnFn = vi.fn().mockReturnValue(child);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    coordinator.startDebate({
      topic: 'Buffered debate',
      matchup: 'opus-vs-codex',
    });

    child.stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({ type: 'debate_start', topic: 'Buffered debate', maxTurns: '6' })
      )
    );
    child.emit('close', 0);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
    coordinator.destroy();
  });

  it('restarts a stale thread with the deferred human reply and same speaker first', async () => {
    const childA = new FakeChildProcess();
    const childB = new FakeChildProcess();
    const spawnFn = vi
      .fn()
      .mockReturnValueOnce(childA)
      .mockReturnValueOnce(childB);
    const coordinator = new EmailDebateCoordinator({
      councilPath,
      emailManager,
      spawnFn: spawnFn as never,
    });

    const { threadId } = coordinator.startDebate({
      topic: 'Debate topic',
      matchup: 'opus-vs-codex',
    });
    const thread = emailManager.getThread(threadId)!;

    childA.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ type: 'debate_start', topic: 'Debate topic', maxTurns: '6' })}\n`),
    );
    childA.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ type: 'turn_start', speaker: 'Codex', round: '1' })}\n`),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<reply-during-turn@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'alice@example.com',
        fromName: 'Alice',
        subject: `Re: ${thread.subject}`,
        body: 'Please focus on rollout risk instead.',
        date: new Date('2026-03-18T12:00:00Z'),
      },
    ]);
    await emailManager.pollOnce();

    childA.stdout.emit(
      'data',
      Buffer.from(
        `${JSON.stringify({
          type: 'turn_chunk',
          speaker: 'Codex',
          content: 'A stale draft',
        })}\n${JSON.stringify({
          type: 'turn_end',
          speaker: 'Codex',
          round: '1',
          convergence: 'low',
          action: 'continue',
        })}\n`,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(childA.kill).toHaveBeenCalledWith('SIGTERM');
    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
    expect(
      coordinator.handleHumanReply(threadId, 'A second reply before the process closes.'),
    ).toEqual({
      success: false,
      error: `Debate already running for thread ${threadId}`,
    });

    childA.emit('close', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(spawnFn.mock.calls[1]?.[1]).toContain('--start-side');
    expect(spawnFn.mock.calls[1]?.[1]).toContain('b');
    expect(String(spawnFn.mock.calls[1]?.[1].at(-1))).toContain('rollout risk');
    expect(emailManager.getPendingHumanReply(threadId)).toBeNull();
    coordinator.destroy();
  });
});
