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
import { sendDebateEmail } from './transport';

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
  transport: 'smtp' as const,
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
});
