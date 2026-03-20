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
  sendNewDebateEmail: vi.fn().mockResolvedValue({ messageId: 'root-msg', threadId: 'provider-thread-1' }),
  testConnection: vi.fn().mockResolvedValue({ ok: true, inboxCount: 2 }),
}));

import { EmailDebateManager } from './manager';
import {
  checkForReplies,
  sendNewDebateEmail,
  testConnection as testAgentMailConnection,
} from './agentMailTransport';
import { pollForReplies, sendDebateEmail, testImapConnection } from './transport';

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

  it('does not resend the opening email when an existing thread starts a follow-up round', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });

    manager.bufferTurnChunk(thread.id, 'First argument.');
    await manager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    await manager.handleCouncilEvent(thread.id, {
      type: 'debate_start',
      topic: 'Test',
      maxTurns: '4',
    });

    expect(sendDebateEmail).toHaveBeenCalledTimes(1);
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
    expect(call?.[1].from).toBe('opus@test.com');
    expect(call?.[1].fromName).toContain('Opus');
    expect(String(call?.[1].body)).toContain('tabs');
  });

  it('adds the other addressed model as visible cc without delivering to it', async () => {
    const thread = manager.createThread({
      topic: 'Test',
      matchup: 'codex-vs-opus',
      maxTurns: 4,
      recipients: ['user@test.com'],
      addressedModels: ['codex', 'opus'],
    });

    manager.bufferTurnChunk(thread.id, 'Cloud-first for control plane; local-first for execution.');

    await manager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Codex',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    const call = vi.mocked(sendDebateEmail).mock.calls[0];
    expect(call?.[1].to).toEqual(['user@test.com']);
    expect(call?.[1].cc).toEqual(['opus@test.com']);
    expect(call?.[1].envelopeTo).toEqual(['user@test.com']);
  });

  it('suppresses a stale turn email when a newer human reply arrives before delivery', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });
    manager.reopenThread(thread.id);

    await manager.handleCouncilEvent(thread.id, {
      type: 'turn_start',
      speaker: 'Opus',
      round: '1',
    });

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<reply-during-turn@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'alice@example.com',
        fromName: 'Alice',
        subject: `Re: ${thread.subject}`,
        body: 'Please reframe this around rollout risk.',
        date: new Date('2026-03-18T12:03:00Z'),
      },
    ]);
    await manager.pollOnce();

    manager.bufferTurnChunk(thread.id, 'Original draft that should not be sent.');
    const result = await manager.handleCouncilEvent(thread.id, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '1',
      convergence: 'low',
      action: 'continue',
    });

    expect(sendDebateEmail).not.toHaveBeenCalled();
    expect(result.deferredTurn).toEqual({
      speaker: 'Opus',
      round: 1,
      humanMessageId: '<reply-during-turn@example.com>',
      humanBody: 'Please reframe this around rollout risk.',
    });
    expect(
      events.some(
        (event) =>
          event.type === 'turn_delivery_deferred' &&
          event.threadId === thread.id &&
          event.humanMessageId === '<reply-during-turn@example.com>',
      ),
    ).toBe(true);
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

  it('stores a pause resume-state path and clears it on completion', async () => {
    const thread = manager.createThread({ topic: 'Test', matchup: 'opus-vs-opus', maxTurns: 4 });

    await manager.handleCouncilEvent(thread.id, {
      type: 'pause_requested',
      reason: 'Need human input',
      round: '1',
      stateFilePath: '/tmp/council-paused.state.json',
    });
    expect(manager.getThread(thread.id)?.resumeStatePath).toBe('/tmp/council-paused.state.json');

    await manager.handleCouncilEvent(thread.id, {
      type: 'debate_complete',
      totalRounds: '4',
      outcome: 'FINALIZING',
    });
    expect(manager.getThread(thread.id)?.resumeStatePath).toBeNull();
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

  it('tracks the latest uninjected human reply separately from older injected replies', async () => {
    const thread = manager.createThread({ topic: 'Pending reply', matchup: 'opus-vs-opus', maxTurns: 4 });
    manager.reopenThread(thread.id);

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<reply-a@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'alice@example.com',
        fromName: 'Alice',
        subject: `Re: ${thread.subject}`,
        body: 'First reply',
        date: new Date('2026-03-18T12:00:00Z'),
      },
    ]);
    await manager.pollOnce();

    expect(manager.getPendingHumanReply(thread.id)).toEqual({
      messageId: '<reply-a@example.com>',
      body: 'First reply',
    });

    manager.markHumanReplyInjected(thread.id, '<reply-a@example.com>');
    expect(manager.getPendingHumanReply(thread.id)).toBeNull();

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<reply-b@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'alice@example.com',
        fromName: 'Alice',
        subject: `Re: ${thread.subject}`,
        body: 'Second reply',
        date: new Date('2026-03-18T12:05:00Z'),
      },
    ]);
    await manager.pollOnce();

    expect(manager.getPendingHumanReply(thread.id)).toEqual({
      messageId: '<reply-b@example.com>',
      body: 'Second reply',
    });
  });

  it('matches AgentMail replies by provider thread id and reopens concluded threads', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'agentmail', agentMailApiKey: 'test-key' },
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
        providerMessageId: 'provider-msg-1',
        threadId: 'provider-thread-1',
        from: 'human@example.com',
        fromName: 'Human',
        to: ['codex@fieldtheory.dev'],
        cc: [],
        subject: `Re: ${thread.subject}`,
        body: 'Keep going.',
        inReplyTo: 'root-msg',
        references: ['root-msg'],
        headers: { 'message-id': 'incoming-1' },
        date: '2026-03-18T12:00:00Z',
        receivingInbox: 'codex' as const,
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

  it('creates a new inbound thread from an AgentMail kickoff email and emits a kickoff event', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'agentmail', agentMailApiKey: 'test-key' },
      tmpDir
    );
    const scopedEvents: Array<{ type: string; [key: string]: unknown }> = [];
    agentMailManager.on('event', (event) => scopedEvents.push(event));

    vi.mocked(checkForReplies).mockResolvedValueOnce([
      {
        messageId: '<orig-message@fieldtheory.dev>',
        providerMessageId: 'provider-msg-kickoff',
        threadId: 'provider-thread-kickoff',
        from: 'human@example.com',
        fromName: 'Human',
        to: ['codex@fieldtheory.dev'],
        cc: ['opus@fieldtheory.dev', 'ally@example.com'],
        subject: 'Debate this architecture',
        body: 'Please pressure-test this idea.',
        inReplyTo: null,
        references: [],
        headers: {
          'message-id': '<orig-message@fieldtheory.dev>',
          to: 'codex@fieldtheory.dev',
          cc: 'opus@fieldtheory.dev, ally@example.com',
        },
        date: '2026-03-18T12:00:00Z',
        receivingInbox: 'council' as const,
      },
    ]);

    await agentMailManager.pollOnce();

    const createdThread = agentMailManager.getThreads()[0];
    expect(createdThread).toBeTruthy();
    expect(createdThread?.source).toBe('email');
    expect(createdThread?.matchup).toBe('codex-vs-opus');
    expect(createdThread?.providerThreadId).toBe('provider-thread-kickoff');
    expect(createdThread?.participants).toContain('human@example.com');
    expect(createdThread?.participants).toContain('ally@example.com');
    expect(createdThread?.participants).not.toContain('codex@fieldtheory.dev');
    expect(createdThread?.messages).toHaveLength(1);
    expect(createdThread?.lastInjectedHumanMessageId).toBe('<orig-message@fieldtheory.dev>');
    expect(scopedEvents.some((event) => event.type === 'inbound_thread_ready')).toBe(true);
    agentMailManager.destroy();
  });

  it('routes inbound kickoff from preserved headers when the receiving inbox is a hidden council inbox', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'agentmail', agentMailApiKey: 'test-key' },
      tmpDir
    );

    vi.mocked(checkForReplies).mockResolvedValueOnce([
      {
        messageId: '<orig-hidden@fieldtheory.dev>',
        providerMessageId: 'provider-msg-hidden',
        threadId: 'provider-thread-hidden',
        from: 'human@example.com',
        fromName: 'Human',
        to: ['council@agentmail.to'],
        cc: [],
        subject: 'Just Codex please',
        body: 'Debate this with yourself.',
        inReplyTo: null,
        references: [],
        headers: {
          'message-id': '<orig-hidden@fieldtheory.dev>',
          to: 'codex@fieldtheory.dev',
          'x-gm-original-to': 'codex@fieldtheory.dev',
        },
        date: '2026-03-18T12:05:00Z',
        receivingInbox: 'council' as const,
      },
    ]);

    await agentMailManager.pollOnce();

    const createdThread = agentMailManager.getThreads()[0];
    expect(createdThread?.matchup).toBe('codex-vs-codex');
    expect(createdThread?.addressedModels).toEqual(['codex']);
    agentMailManager.destroy();
  });

  it('polls only configured AgentMail inbox keys for inbound routing', async () => {
    const agentMailManager = new EmailDebateManager(
      {
        ...TEST_CONFIG,
        outboundTransport: 'smtp',
        inboundTransport: 'agentmail',
        agentMailApiKey: 'test-key',
        agentMailInboxIds: {
          council: 'debateintake@agentmail.to',
        },
      },
      tmpDir
    );

    vi.mocked(checkForReplies).mockResolvedValueOnce([
      {
        messageId: '<orig-hidden@fieldtheory.dev>',
        providerMessageId: 'provider-msg-hidden',
        threadId: 'provider-thread-hidden',
        from: 'human@example.com',
        fromName: 'Human',
        to: ['council@agentmail.to'],
        cc: [],
        subject: 'Just Codex please',
        body: 'Debate this with yourself.',
        inReplyTo: null,
        references: [],
        headers: {
          'message-id': '<orig-hidden@fieldtheory.dev>',
          to: 'codex@fieldtheory.dev',
          'x-gm-original-to': 'codex@fieldtheory.dev',
        },
        date: '2026-03-18T12:05:00Z',
        receivingInbox: 'council' as const,
      },
    ]);

    await agentMailManager.pollOnce();

    expect(checkForReplies).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkForReplies).mock.calls[0]?.[1]).toBe('council');
    expect(agentMailManager.getThreads()[0]?.matchup).toBe('codex-vs-codex');
    agentMailManager.destroy();
  });

  it('uses AgentMail send transport with thread headers for turn emails when configured', async () => {
    const agentMailManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'agentmail', agentMailApiKey: 'test-key' },
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

    expect(sendNewDebateEmail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendNewDebateEmail).mock.calls[1]?.[1].headers).toMatchObject({
      'In-Reply-To': thread.rootMessageId,
      References: thread.rootMessageId,
    });
    agentMailManager.destroy();
  });

  it('supports AgentMail outbound with IMAP inbound in mixed mode', async () => {
    const mixedManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'imap', agentMailApiKey: 'test-key' },
      tmpDir
    );
    const thread = mixedManager.createThread({
      topic: 'Mixed transport',
      matchup: 'opus-vs-codex',
    });

    await mixedManager.handleCouncilEvent(thread.id, {
      type: 'debate_start',
      topic: 'Mixed transport',
      maxTurns: '4',
    });

    vi.mocked(pollForReplies).mockResolvedValueOnce([
      {
        messageId: '<mixed-reply@example.com>',
        inReplyTo: thread.rootMessageId,
        references: [thread.rootMessageId],
        from: 'human@example.com',
        fromName: 'Human',
        subject: `Re: ${thread.subject}`,
        body: 'Reply via IMAP',
        date: new Date('2026-03-18T12:10:00Z'),
      },
    ]);

    await mixedManager.pollOnce();

    expect(sendNewDebateEmail).toHaveBeenCalled();
    expect(pollForReplies).toHaveBeenCalled();
    expect(mixedManager.getPendingHumanReply(thread.id)).toEqual({
      messageId: '<mixed-reply@example.com>',
      body: 'Reply via IMAP',
    });
    mixedManager.destroy();
  });

  it('tests both AgentMail and IMAP in mixed mode', async () => {
    const mixedManager = new EmailDebateManager(
      { ...TEST_CONFIG, outboundTransport: 'agentmail', inboundTransport: 'imap', agentMailApiKey: 'test-key' },
      tmpDir
    );

    const status = await mixedManager.testConnection();

    expect(testAgentMailConnection).toHaveBeenCalledWith('test-key');
    expect(testImapConnection).toHaveBeenCalledWith(TEST_CONFIG.imap);
    expect(status).toEqual({
      smtp: false,
      imap: true,
      agentMail: true,
      errors: [],
    });
    mixedManager.destroy();
  });
});
