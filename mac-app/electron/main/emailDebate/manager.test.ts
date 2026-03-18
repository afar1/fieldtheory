import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
import { checkForReplies, replyToDebateEmail, sendNewDebateEmail } from './agentMailTransport';
import { pollForReplies, sendDebateEmail } from './transport';

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

describe('EmailDebateManager', () => {
  let manager: EmailDebateManager;
  let tmpDir: string;
  let events: Array<{ type: string; [key: string]: unknown }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emaildebate-test-'));
    manager = new EmailDebateManager(TEST_CONFIG, tmpDir);
    events = [];
    manager.on('event', (event) => events.push(event));
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a thread and session with correct metadata', () => {
    const thread = manager.createThread({
      topic: 'Test topic',
      matchup: 'opus-vs-codex',
      maxTurns: 6,
    });

    expect(thread.topic).toBe('Test topic');
    expect(thread.providerThreadId).toBeNull();
    expect(thread.participants).toContain('user@test.com');
    expect(manager.getActiveThreadIds()).toContain(thread.id);
  });

  it('normalizes duplicate and blank recipients when creating a thread', () => {
    const thread = manager.createThread({
      topic: 'Normalized',
      matchup: 'opus-vs-codex',
      recipients: ['user@test.com', ' user@test.com ', ''],
    });

    expect(thread.participants.filter((participant) => participant === 'user@test.com')).toHaveLength(1);
  });

  it('handles simultaneous sessions independently', async () => {
    const threadA = manager.createThread({ topic: 'Thread A', matchup: 'opus-vs-opus' });
    const threadB = manager.createThread({ topic: 'Thread B', matchup: 'opus-vs-codex' });

    manager.bufferTurnChunk(threadA.id, 'Argument A');
    manager.bufferTurnChunk(threadB.id, 'Argument B');

    await manager.handleCouncilEvent(threadA.id, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    await manager.handleCouncilEvent(threadB.id, {
      type: 'turn_end',
      speaker: 'Codex',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    expect(sendDebateEmail).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(sendDebateEmail).mock.calls;
    expect(String(calls[0]?.[1].body)).toContain('Argument A');
    expect(String(calls[1]?.[1].body)).toContain('Argument B');
  });

  it('sends the opening email on debate_start', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });

    await manager.handleCouncilEvent(thread.id, {
      type: 'debate_start',
      topic: 'Test',
      maxTurns: '4',
    });

    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(sendDebateEmail).mock.calls[0]?.[1].body)).toContain(
      'A new council debate has been started.'
    );
  });

  it('sends turn emails with buffered content', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });

    manager.bufferTurnChunk(thread.id, 'Here is my argument about tabs.');
    manager.bufferTurnChunk(thread.id, 'They are clearly superior.');

    await manager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
    const call = vi.mocked(sendDebateEmail).mock.calls[0];
    expect(call?.[1].fromName).toContain('Opus');
    expect(String(call?.[1].body)).toContain('tabs');
  });

  it('marks threads concluded and removes the active session', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });

    await manager.handleCouncilEvent(thread.id, {
      type: 'debate_complete',
      totalRounds: '4',
      outcome: 'FINALIZING',
    });

    expect(manager.getThread(thread.id)?.status).toBe('concluded');
    expect(manager.getActiveThreadIds()).not.toContain(thread.id);
    expect(events.some((event) => event.type === 'thread_concluded')).toBe(true);
  });

  it('builds reply context from stored human replies', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });
    manager.reopenThread(thread.id);

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<reply@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'alice@example.com',
        fromName: 'Alice',
        subject: `Re: ${thread.subject}`,
        body: 'Please consider the performance implications.',
        date: new Date('2026-03-18T12:00:00Z'),
      },
    ]);

    await manager.pollOnce();

    expect(manager.buildReplyContext(thread.id)).toContain('Alice');
    expect(manager.buildReplyContext(thread.id)).toContain('performance implications');
  });

  it('matches AgentMail replies by provider thread id and reopens concluded threads', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, transport: 'agentmail', agentMailApiKey: 'test-key' },
      tmpDir
    );
    const thread = agentMailManager.createThread({
      topic: 'AgentMail thread',
      matchup: 'opus-vs-codex',
    });

    await agentMailManager.handleCouncilEvent(thread.id, {
      type: 'debate_start',
      topic: 'AgentMail thread',
      maxTurns: '4',
    });

    await agentMailManager.handleCouncilEvent(thread.id, {
      type: 'debate_complete',
      totalRounds: '2',
      outcome: 'FINALIZING',
    });

    vi.mocked(checkForReplies).mockResolvedValueOnce([
      {
        messageId: 'incoming-1',
        threadId: 'provider-thread-1',
        from: 'human@example.com',
        fromName: 'Human',
        subject: `Re: ${thread.subject}`,
        body: 'Keep going.',
        date: '2026-03-18T12:00:00Z',
      },
    ]);

    const scopedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    agentMailManager.on('event', (event) => scopedEvents.push(event));

    await agentMailManager.pollOnce();

    expect(sendNewDebateEmail).toHaveBeenCalled();
    expect(agentMailManager.getThread(thread.id)?.providerThreadId).toBe('provider-thread-1');
    expect(agentMailManager.getThread(thread.id)?.status).toBe('active');
    expect(scopedEvents.some((event) => event.type === 'thread_reopened')).toBe(true);
    expect(scopedEvents.some((event) => event.type === 'reply_received')).toBe(true);
    agentMailManager.destroy();
  });

  it('uses AgentMail reply transport for turn emails when configured', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, transport: 'agentmail', agentMailApiKey: 'test-key' },
      tmpDir
    );
    const thread = agentMailManager.createThread({
      topic: 'AgentMail turns',
      matchup: 'opus-vs-codex',
    });

    await agentMailManager.handleCouncilEvent(thread.id, {
      type: 'debate_start',
      topic: 'AgentMail turns',
      maxTurns: '4',
    });
    agentMailManager.bufferTurnChunk(thread.id, 'A model turn.');

    await agentMailManager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Codex',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    expect(replyToDebateEmail).toHaveBeenCalled();
    agentMailManager.destroy();
  });
});
