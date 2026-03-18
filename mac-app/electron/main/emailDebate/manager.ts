/**
 * EmailDebateManager — Bridges debate sessions with persisted email threads.
 *
 * The source port is intentionally session-oriented. Multiple email debates can
 * be active at once, each keyed by thread id.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import crypto from 'crypto';
import type { CouncilEvent } from '../types/council';
import { createLogger } from '../logger';
import { ThreadStore } from './threadStore';
import {
  MODEL_INBOXES,
  checkForReplies,
  provisionAllInboxes,
  replyToDebateEmail,
  sendNewDebateEmail,
  testConnection as testAgentMailConnection,
} from './agentMailTransport';
import {
  DEFAULT_EMAIL_DEBATE_CONFIG,
  type EmailDebateConfig,
  type EmailDebateConnectionStatus,
  type EmailDebateEvent,
  type EmailDebateInboxKey,
  type EmailThread,
} from './types';
import {
  formatDebatePlainText,
  generateMessageId,
  generateRootMessageId,
  pollForReplies,
  sendDebateEmail,
  testImapConnection,
  testSmtpConnection,
} from './transport';

const log = createLogger('EmailDebate');

interface EmailDebateSession {
  threadId: string;
  recipients: string[];
  turnCounter: number;
  turnContentBuffer: string;
  lastMessageId: string | null;
}

export interface CreateThreadOptions {
  topic: string;
  matchup: string;
  maxTurns?: number | null;
  repoPath?: string | null;
  recipients?: string[];
  owner?: string;
  subject?: string;
}

export class EmailDebateManager extends EventEmitter {
  private config: EmailDebateConfig;
  private readonly store: ThreadStore;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sessions = new Map<string, EmailDebateSession>();

  constructor(config: Partial<EmailDebateConfig> = {}, storeDir?: string) {
    super();
    this.config = { ...DEFAULT_EMAIL_DEBATE_CONFIG, ...config };
    this.store = new ThreadStore(storeDir);
  }

  getConfig(): EmailDebateConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<EmailDebateConfig>): void {
    this.config = { ...this.config, ...partial };
    if (this.pollTimer) {
      this.stopPolling();
      this.startPolling();
    }
  }

  isEnabled(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.useAgentMail()) {
      return Boolean(this.config.agentMailApiKey);
    }

    return Boolean(this.config.smtp.host) && Boolean(this.config.fromAddress);
  }

  async testConnection(): Promise<EmailDebateConnectionStatus> {
    const errors: string[] = [];

    if (this.useAgentMail()) {
      try {
        const result = await testAgentMailConnection(this.config.agentMailApiKey);
        return { smtp: false, imap: false, agentMail: result.ok, errors: [] };
      } catch (error) {
        errors.push(`AgentMail: ${error instanceof Error ? error.message : String(error)}`);
        return { smtp: false, imap: false, agentMail: false, errors };
      }
    }

    let smtp = false;
    let imap = false;

    try {
      smtp = await testSmtpConnection(this.config.smtp);
    } catch (error) {
      errors.push(`SMTP: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      imap = await testImapConnection(this.config.imap);
    } catch (error) {
      errors.push(`IMAP: ${error instanceof Error ? error.message : String(error)}`);
    }

    return { smtp, imap, agentMail: false, errors };
  }

  async provisionInboxes(): Promise<void> {
    if (!this.useAgentMail()) {
      return;
    }

    await provisionAllInboxes(this.getAgentMailConfig());
  }

  createThread(options: CreateThreadOptions): EmailThread {
    const threadId = crypto.randomUUID().substring(0, 12);
    const recipients = this.normalizeRecipients(options.recipients ?? this.config.defaultRecipients);
    const owner = options.owner ?? this.config.fromAddress;
    const subject = options.subject ?? `[Council] ${options.topic.substring(0, 100)}`;

    const thread: EmailThread = {
      id: threadId,
      rootMessageId: generateRootMessageId(threadId),
      subject,
      topic: options.topic,
      matchup: options.matchup,
      repoPath: options.repoPath ?? null,
      status: 'active',
      providerThreadId: null,
      participants: [...new Set([...recipients, owner].filter(Boolean))],
      owner,
      messages: [],
      modelTurnCount: 0,
      maxTurns: options.maxTurns ?? null,
      extensionTurns: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptPath: null,
      consensusPath: null,
    };

    this.store.save(thread);
    this.sessions.set(threadId, {
      threadId,
      recipients,
      turnCounter: 0,
      turnContentBuffer: '',
      lastMessageId: null,
    });

    this.emitEvent({ type: 'thread_created', threadId, subject });
    return thread;
  }

  getThreads(): EmailThread[] {
    return this.store.list();
  }

  getThread(threadId: string): EmailThread | null {
    return this.store.load(threadId);
  }

  getActiveThreadIds(): string[] {
    return [...this.sessions.keys()];
  }

  closeThread(threadId: string): boolean {
    const thread = this.store.setStatus(threadId, 'closed');
    this.sessions.delete(threadId);
    if (!thread) {
      return false;
    }

    this.emitEvent({ type: 'thread_closed', threadId });
    return true;
  }

  reopenThread(threadId: string): boolean {
    const thread = this.store.setStatus(threadId, 'active');
    if (!thread) {
      return false;
    }

    this.ensureSession(threadId);
    this.emitEvent({ type: 'thread_reopened', threadId });
    return true;
  }

  resetTurnBuffer(threadId: string): void {
    this.ensureSession(threadId).turnContentBuffer = '';
  }

  bufferTurnChunk(threadId: string, content: string): void {
    const session = this.ensureSession(threadId);
    session.turnContentBuffer += `${content}\n`;
  }

  async handleCouncilEvent(threadId: string, event: CouncilEvent): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    this.ensureSession(threadId);

    switch (event.type) {
      case 'debate_start':
        await this.sendTopicEmail(threadId);
        break;
      case 'turn_start':
        this.resetTurnBuffer(threadId);
        break;
      case 'turn_chunk':
        this.bufferTurnChunk(threadId, event.content);
        break;
      case 'turn_end':
        await this.sendTurnEmail(threadId, event.speaker, Number(event.round));
        break;
      case 'transcript_written':
        this.store.setTranscriptPath(threadId, event.path);
        break;
      case 'consensus_written':
        this.store.setConsensusPath(threadId, event.path);
        await this.sendConclusionEmail(threadId, event.path);
        break;
      case 'debate_complete':
        this.store.setStatus(threadId, 'concluded');
        this.sessions.delete(threadId);
        this.emitEvent({ type: 'thread_concluded', threadId });
        break;
      default:
        break;
    }
  }

  startPolling(): void {
    if (this.pollTimer || !this.isEnabled()) {
      return;
    }

    void this.pollOnce();
    this.pollTimer = setInterval(() => void this.pollOnce(), this.config.pollIntervalMs);
  }

  stopPolling(): void {
    if (!this.pollTimer) {
      return;
    }

    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async pollOnce(): Promise<void> {
    const knownIds = this.store.getAllKnownMessageIds();

    try {
      if (this.useAgentMail()) {
        for (const inboxKey of this.getPollingInboxKeys()) {
          const incomingMessages = await checkForReplies(this.getAgentMailConfig(), inboxKey, knownIds);
          for (const incoming of incomingMessages) {
            const thread = this.store.findThreadByProviderThreadId(incoming.threadId);
            if (!thread) {
              continue;
            }

            this.recordHumanReply(thread.id, {
              messageId: incoming.messageId,
              inReplyTo: null,
              references: [],
              from: incoming.from,
              fromName: incoming.fromName,
              to: thread.participants,
              subject: incoming.subject,
              body: incoming.body,
              sentAt: incoming.date,
              author: `human:${incoming.from}`,
              turnNumber: null,
            });
          }
        }
        return;
      }

      const rootMessageIds = this.store.getReplyableRootMessageIds();
      if (rootMessageIds.length === 0) {
        return;
      }

      const replies = await pollForReplies(this.config.imap, rootMessageIds, knownIds);
      for (const reply of replies) {
        const thread = this.store.findThreadByReference(reply.references);
        if (!thread || reply.from === this.config.fromAddress) {
          continue;
        }

        this.recordHumanReply(thread.id, {
          messageId: reply.messageId,
          inReplyTo: reply.inReplyTo,
          references: reply.references,
          from: reply.from,
          fromName: reply.fromName,
          to: thread.participants,
          subject: reply.subject,
          body: reply.body,
          sentAt: reply.date.toISOString(),
          author: `human:${reply.from}`,
          turnNumber: null,
        });
      }
    } catch (error) {
      log.error('Poll error: %s', error);
    }
  }

  buildReplyContext(threadId: string): string | null {
    const thread = this.store.load(threadId);
    if (!thread) {
      return null;
    }

    const humanReplies = thread.messages.filter((message) => message.author.startsWith('human:'));
    if (humanReplies.length === 0) {
      return null;
    }

    return humanReplies
      .map((reply) => `[${reply.fromName} (${reply.from}) replied]\n${reply.body}`)
      .join('\n\n---\n\n');
  }

  destroy(): void {
    this.stopPolling();
    this.removeAllListeners();
    this.sessions.clear();
  }

  private useAgentMail(): boolean {
    return this.config.transport === 'agentmail' && Boolean(this.config.agentMailApiKey);
  }

  private getAgentMailConfig() {
    return {
      apiKey: this.config.agentMailApiKey,
      domain: this.config.agentMailDomain || 'agentmail.to',
      inboxIds: this.config.agentMailInboxIds,
    };
  }

  private getPollingInboxKeys(): EmailDebateInboxKey[] {
    return Object.keys(MODEL_INBOXES) as EmailDebateInboxKey[];
  }

  private ensureSession(threadId: string): EmailDebateSession {
    const existing = this.sessions.get(threadId);
    if (existing) {
      return existing;
    }

    const thread = this.store.load(threadId);
    if (!thread) {
      throw new Error(`Unknown email debate thread: ${threadId}`);
    }

    const modelTurnCount = thread.messages.reduce(
      (max, message) => Math.max(max, message.turnNumber ?? 0),
      0
    );
    const lastMessageId = thread.messages.at(-1)?.messageId ?? null;

    const session: EmailDebateSession = {
      threadId,
      recipients: thread.participants.filter((participant) => participant !== thread.owner),
      turnCounter: modelTurnCount,
      turnContentBuffer: '',
      lastMessageId,
    };

    this.sessions.set(threadId, session);
    return session;
  }

  private async sendTopicEmail(threadId: string): Promise<void> {
    const session = this.ensureSession(threadId);
    const thread = this.requireThread(threadId);

    const body = [
      'A new council debate has been started.',
      '',
      `Topic: ${thread.topic}`,
      `Matchup: ${thread.matchup}`,
      thread.maxTurns != null ? `Max turns: ${thread.maxTurns}` : null,
      thread.repoPath ? `Repo: ${thread.repoPath}` : null,
      '',
      'Reply to this thread to steer the debate or add new context.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      let messageId = thread.rootMessageId;
      if (this.useAgentMail()) {
        const result = await sendNewDebateEmail(this.getAgentMailConfig(), {
          fromModel: 'council',
          to: session.recipients,
          subject: thread.subject,
          body: formatDebatePlainText(body, this.config.fromName),
        });
        messageId = result.messageId || messageId;
        session.lastMessageId = result.messageId || messageId;
        this.store.setProviderThreadId(threadId, result.threadId);
      } else {
        await sendDebateEmail(this.config.smtp, {
          from: this.config.fromAddress,
          fromName: this.config.fromName,
          to: session.recipients,
          subject: thread.subject,
          body: formatDebatePlainText(body, this.config.fromName),
          messageId,
          inReplyTo: null,
          references: [],
        });
        session.lastMessageId = messageId;
      }

      this.store.addMessage(threadId, {
        messageId,
        inReplyTo: null,
        references: [],
        from: this.config.fromAddress,
        fromName: this.config.fromName,
        to: session.recipients,
        subject: thread.subject,
        body: formatDebatePlainText(body, this.config.fromName),
        sentAt: new Date().toISOString(),
        author: 'system',
        turnNumber: null,
      });
      this.emitEvent({ type: 'email_sent', threadId, messageId, author: 'system', turnNumber: null });
    } catch (error) {
      this.emitEvent({
        type: 'error',
        threadId,
        message: `Failed to send topic email: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async sendTurnEmail(threadId: string, speaker: string, round: number): Promise<void> {
    const session = this.ensureSession(threadId);
    const thread = this.requireThread(threadId);
    session.turnCounter += 1;
    const turnNumber = session.turnCounter;
    const rawBody = session.turnContentBuffer.trim() || `[Turn ${round} by ${speaker}]`;
    session.turnContentBuffer = '';
    const body = formatDebatePlainText(rawBody, speaker);

    try {
      let messageId = generateMessageId(threadId, turnNumber);
      const inReplyTo = session.lastMessageId;
      if (this.useAgentMail() && session.lastMessageId) {
        const result = await replyToDebateEmail(this.getAgentMailConfig(), {
          fromModel: this.speakerToModelKey(speaker),
          inReplyToMessageId: session.lastMessageId,
          body,
        });
        messageId = result.messageId || messageId;
        session.lastMessageId = result.messageId || messageId;
      } else {
        const previousMessageId =
          turnNumber === 1 ? thread.rootMessageId : generateMessageId(threadId, turnNumber - 1);
        const references = [thread.rootMessageId];
        for (let index = 1; index < turnNumber; index += 1) {
          references.push(generateMessageId(threadId, index));
        }

        await sendDebateEmail(this.config.smtp, {
          from: this.config.fromAddress,
          fromName: speaker,
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          messageId,
          inReplyTo: previousMessageId,
          references,
        });
        session.lastMessageId = messageId;
      }

      this.store.addMessage(threadId, {
        messageId,
        inReplyTo,
        references: [],
        from: this.config.fromAddress,
        fromName: speaker,
        to: session.recipients,
        subject: `Re: ${thread.subject}`,
        body,
        sentAt: new Date().toISOString(),
        author: speaker,
        turnNumber,
      });
      this.emitEvent({ type: 'email_sent', threadId, messageId, author: speaker, turnNumber });
    } catch (error) {
      this.emitEvent({
        type: 'error',
        threadId,
        message: `Failed to send turn email: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async sendConclusionEmail(threadId: string, consensusPath: string): Promise<void> {
    const session = this.ensureSession(threadId);
    const thread = this.requireThread(threadId);
    session.turnCounter += 1;
    const turnNumber = session.turnCounter;

    let consensus = '[Conclusion could not be read]';
    try {
      consensus = fs.readFileSync(consensusPath, 'utf-8').trim();
    } catch {
      // Keep fallback text.
    }

    const body = formatDebatePlainText(
      `Council conclusion\n\n${consensus}\n\nReply to reopen the discussion.`,
      'Council'
    );

    try {
      let messageId = generateMessageId(threadId, turnNumber);
      const inReplyTo = session.lastMessageId;
      if (this.useAgentMail() && session.lastMessageId) {
        const result = await replyToDebateEmail(this.getAgentMailConfig(), {
          fromModel: 'council',
          inReplyToMessageId: session.lastMessageId,
          body,
        });
        messageId = result.messageId || messageId;
        session.lastMessageId = result.messageId || messageId;
      } else {
        const previousMessageId =
          turnNumber === 1 ? thread.rootMessageId : generateMessageId(threadId, turnNumber - 1);
        const references = [thread.rootMessageId];
        for (let index = 1; index < turnNumber; index += 1) {
          references.push(generateMessageId(threadId, index));
        }

        await sendDebateEmail(this.config.smtp, {
          from: this.config.fromAddress,
          fromName: 'Council',
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          messageId,
          inReplyTo: previousMessageId,
          references,
        });
        session.lastMessageId = messageId;
      }

      this.store.addMessage(threadId, {
        messageId,
        inReplyTo,
        references: [],
        from: this.config.fromAddress,
        fromName: 'Council',
        to: session.recipients,
        subject: `Re: ${thread.subject}`,
        body,
        sentAt: new Date().toISOString(),
        author: 'conclusion',
        turnNumber,
      });
    } catch (error) {
      log.error('Failed to send conclusion email for %s: %s', threadId, error);
    }
  }

  private recordHumanReply(
    threadId: string,
    message: EmailThread['messages'][number]
  ): void {
    const thread = this.requireThread(threadId);
    this.store.addMessage(threadId, message);

    if (thread.status === 'concluded') {
      this.store.setStatus(threadId, 'active');
      this.ensureSession(threadId);
      this.emitEvent({ type: 'thread_reopened', threadId });
    }

    this.emitEvent({
      type: 'reply_received',
      threadId,
      messageId: message.messageId,
      from: message.from,
      body: message.body,
    });
  }

  private speakerToModelKey(speaker: string): EmailDebateInboxKey {
    const normalized = speaker.toLowerCase().replace(/\s+[ab]$/, '');
    if (normalized.includes('opus')) {
      return 'opus';
    }
    if (normalized.includes('sonnet')) {
      return 'sonnet';
    }
    if (normalized.includes('codex')) {
      return 'codex';
    }
    return 'council';
  }

  private normalizeRecipients(recipients: string[]): string[] {
    return [...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean))];
  }

  private requireThread(threadId: string): EmailThread {
    const thread = this.store.load(threadId);
    if (!thread) {
      throw new Error(`Unknown email debate thread: ${threadId}`);
    }
    return thread;
  }

  private emitEvent(event: EmailDebateEvent): void {
    this.emit('event', event);
  }
}
