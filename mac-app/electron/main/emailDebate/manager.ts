/**
 * EmailDebateManager — Bridges debate sessions with persisted email threads.
 *
 * The source port is intentionally session-oriented. Multiple email debates can
 * be active at once, each keyed by thread id.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import crypto from 'crypto';
import { DEFAULT_COUNCIL_MAX_TURNS, type CouncilEvent } from '../types/council';
import { createLogger } from '../logger';
import { ThreadStore } from './threadStore';
import {
  MODEL_INBOXES,
  type AgentMailIncomingMessage,
  checkForReplies,
  provisionAllInboxes,
  sendNewDebateEmail,
  testConnection as testAgentMailConnection,
} from './agentMailTransport';
import {
  DEFAULT_EMAIL_DEBATE_CONFIG,
  createEmptyEmailThreadTokenUsage,
  type EmailDebateConfig,
  type EmailDebateConnectionStatus,
  type EmailDebateEvent,
  type EmailDebateInboxKey,
  type EmailThread,
  type EmailThreadTurnTokenUsage,
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
const THEORY_SUBJECT_PREFIX = 'Theory: ';

interface EmailDebateSession {
  threadId: string;
  recipients: string[];
  turnCounter: number;
  turnContentBuffer: string;
  lastMessageId: string | null;
  turnStartHumanMessageId: string | null;
}

export interface DeferredTurnDelivery {
  speaker: string;
  round: number;
  humanMessageId: string;
  humanBody: string;
}

export interface HandleCouncilEventResult {
  deferredTurn?: DeferredTurnDelivery;
}

export interface CreateThreadOptions {
  topic: string;
  matchup: string;
  maxTurns?: number | null;
  repoPath?: string | null;
  recipients?: string[];
  owner?: string;
  subject?: string;
  source?: 'local' | 'email';
  inboundMessageId?: string | null;
  addressedModels?: EmailDebateInboxKey[];
  preferredStartSide?: 'a' | 'b' | null;
  providerThreadId?: string | null;
}

function normalizeTheorySubject(subject: string): string {
  const trimmed = subject.trim().replace(/\s+/g, ' ');
  const withoutReplyPrefixes = trimmed.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim();
  const withoutTheoryPrefix = withoutReplyPrefixes.replace(/^theory\s*:\s*/i, '').trim();
  const base = withoutTheoryPrefix || 'Email debate';
  return `${THEORY_SUBJECT_PREFIX}${base}`;
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

    if (this.wantsAgentMailOutbound()) {
      return Boolean(this.config.agentMailApiKey);
    }

    return Boolean(this.config.smtp.host) && Boolean(this.config.fromAddress);
  }

  async testConnection(): Promise<EmailDebateConnectionStatus> {
    const errors: string[] = [];
    let smtp = false;
    let imap = false;
    let agentMail = false;

    if (this.wantsAgentMailOutbound() || this.wantsAgentMailInbound()) {
      try {
        const result = await testAgentMailConnection(this.config.agentMailApiKey);
        agentMail = result.ok;
      } catch (error) {
        errors.push(`AgentMail: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.usesSmtpOutbound()) {
      try {
        smtp = await testSmtpConnection(this.config.smtp);
      } catch (error) {
        errors.push(`SMTP: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (this.usesImapInbound()) {
      try {
        imap = await testImapConnection(this.config.imap);
      } catch (error) {
        errors.push(`IMAP: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { smtp, imap, agentMail, errors };
  }

  async provisionInboxes(): Promise<void> {
    if (!this.wantsAgentMailOutbound() && !this.wantsAgentMailInbound()) {
      return;
    }

    await provisionAllInboxes(this.getAgentMailConfig());
  }

  createThread(options: CreateThreadOptions): EmailThread {
    const threadId = crypto.randomUUID().substring(0, 12);
    const recipients = this.normalizeRecipients(options.recipients ?? this.config.defaultRecipients);
    const owner = options.owner ?? this.config.fromAddress;
    const subject = normalizeTheorySubject(options.subject ?? options.topic.substring(0, 100));

    const thread: EmailThread = {
      id: threadId,
      rootMessageId: generateRootMessageId(threadId),
      subject,
      topic: options.topic,
      matchup: options.matchup,
      repoPath: options.repoPath ?? null,
      status: 'active',
      providerThreadId: options.providerThreadId ?? null,
      participants: [...new Set([...recipients, owner].filter(Boolean))],
      owner,
      messages: [],
      tokenUsage: createEmptyEmailThreadTokenUsage(),
      modelTurnCount: 0,
      maxTurns: options.maxTurns ?? null,
      extensionTurns: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcriptPath: null,
      consensusPath: null,
      resumeStatePath: null,
      lastInjectedHumanMessageId: null,
      source: options.source ?? 'local',
      inboundMessageId: options.inboundMessageId ?? null,
      addressedModels: options.addressedModels ?? [],
      preferredStartSide: options.preferredStartSide ?? null,
    };

    this.store.save(thread);
    this.sessions.set(threadId, {
      threadId,
      recipients,
      turnCounter: 0,
      turnContentBuffer: '',
      lastMessageId: null,
      turnStartHumanMessageId: null,
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

  async handleCouncilEvent(threadId: string, event: CouncilEvent): Promise<HandleCouncilEventResult> {
    if (!this.isEnabled()) {
      return {};
    }

    const session = this.ensureSession(threadId);

    switch (event.type) {
      case 'debate_start':
        if (this.requireThread(threadId).messages.length === 0) {
          await this.sendTopicEmail(threadId);
        }
        return {};
      case 'turn_start':
        this.resetTurnBuffer(threadId);
        session.turnStartHumanMessageId = this.getLatestHumanReplyMessageId(threadId);
        return {};
      case 'turn_chunk':
        this.bufferTurnChunk(threadId, event.content);
        return {};
      case 'turn_end': {
        const turnTokenUsage = this.parseTurnTokenUsage(event);
        this.store.recordTokenUsage(threadId, turnTokenUsage);
        return {
          deferredTurn:
            (await this.sendTurnEmail(
              threadId,
              event.speaker,
              Number(event.round),
              turnTokenUsage,
            )) ?? undefined,
        };
      }
      case 'pause_requested':
        this.store.setResumeStatePath(threadId, event.stateFilePath);
        return {};
      case 'resume_started':
        this.store.setStatus(threadId, 'active');
        this.store.setResumeStatePath(threadId, event.stateFilePath);
        return {};
      case 'transcript_written':
        this.store.setTranscriptPath(threadId, event.path);
        return {};
      case 'consensus_written':
        this.store.setConsensusPath(threadId, event.path);
        if (this.config.autoSendConclusionEmail) {
          await this.sendConclusionEmail(threadId, event.path);
        }
        return {};
      case 'debate_complete':
        this.store.setStatus(threadId, 'concluded');
        this.store.setResumeStatePath(threadId, null);
        this.sessions.delete(threadId);
        this.emitEvent({ type: 'thread_concluded', threadId });
        return {};
      default:
        return {};
    }
  }

  startPolling(): void {
    if (this.pollTimer || !this.canPollReplies()) {
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
    if (!this.canPollReplies()) {
      return;
    }

    const knownIds = this.store.getAllKnownMessageIds();
    const seenMessageIds = new Set(knownIds);

    try {
      if (this.useAgentMailInbound()) {
        for (const inboxKey of this.getPollingInboxKeys()) {
          const incomingMessages = await checkForReplies(this.getAgentMailConfig(), inboxKey, knownIds);
          for (const incoming of incomingMessages) {
            if (!incoming.messageId || seenMessageIds.has(incoming.messageId)) {
              continue;
            }
            seenMessageIds.add(incoming.messageId);

            const thread =
              this.store.findThreadByProviderThreadId(incoming.threadId) ??
              this.store.findThreadByReference([
                incoming.messageId,
                ...(incoming.references ?? []),
                ...(incoming.inReplyTo ? [incoming.inReplyTo] : []),
              ]);

            if (!thread) {
              const kickoffThread = this.createInboundThreadFromMessage(incoming);
              if (kickoffThread) {
                this.emitEvent({ type: 'inbound_thread_ready', threadId: kickoffThread.id });
              }
              continue;
            }

            this.recordHumanReply(thread.id, {
              messageId: incoming.messageId,
              providerMessageId: incoming.providerMessageId,
              inReplyTo: incoming.inReplyTo,
              references: incoming.references,
              from: incoming.from,
              fromName: incoming.fromName,
              to: this.resolveThreadHumanRecipients(thread, incoming.from, incoming.to, incoming.cc),
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

      const trackedMessageIds = this.store.getReplyableTrackedMessageIds();
      if (trackedMessageIds.length === 0) {
        return;
      }

      const replies = await pollForReplies(this.config.imap, trackedMessageIds, knownIds);
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
          to: this.resolveThreadHumanRecipients(thread, reply.from, reply.to, reply.cc),
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

  getPendingHumanReply(threadId: string): { messageId: string; body: string } | null {
    const thread = this.store.load(threadId);
    if (!thread) {
      return null;
    }

    const pendingReplies = this.getUninjectedHumanReplies(thread);
    if (pendingReplies.length === 0) {
      return null;
    }

    return {
      messageId: pendingReplies.at(-1)?.messageId ?? '',
      body: this.formatHumanReplyBundle(pendingReplies),
    };
  }

  markHumanReplyInjected(threadId: string, messageId: string): void {
    this.store.setLastInjectedHumanMessageId(threadId, messageId);
  }

  destroy(): void {
    this.stopPolling();
    this.removeAllListeners();
    this.sessions.clear();
  }

  private wantsAgentMailOutbound(): boolean {
    return this.config.outboundTransport === 'agentmail';
  }

  private useAgentMailOutbound(): boolean {
    return this.wantsAgentMailOutbound() && Boolean(this.config.agentMailApiKey);
  }

  private usesSmtpOutbound(): boolean {
    return this.config.outboundTransport === 'smtp';
  }

  private wantsAgentMailInbound(): boolean {
    return this.config.inboundTransport === 'agentmail';
  }

  private useAgentMailInbound(): boolean {
    return this.wantsAgentMailInbound() && Boolean(this.config.agentMailApiKey);
  }

  private usesImapInbound(): boolean {
    return this.config.inboundTransport === 'imap';
  }

  private canPollReplies(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (this.useAgentMailInbound()) {
      return true;
    }

    return Boolean(this.config.imap.host) && Boolean(this.config.imap.user);
  }

  private getAgentMailConfig() {
    return {
      apiKey: this.config.agentMailApiKey,
      domain: this.config.agentMailDomain || 'agentmail.to',
      inboxIds: this.config.agentMailInboxIds,
    };
  }

  private getPollingInboxKeys(): EmailDebateInboxKey[] {
    const configuredKeys = (Object.keys(this.config.agentMailInboxIds) as EmailDebateInboxKey[])
      .filter((key) => Boolean(this.config.agentMailInboxIds[key]));

    if (configuredKeys.length > 0) {
      return configuredKeys;
    }

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
    const lastReplyTargetId = thread.messages.at(-1)?.messageId ?? null;

    const session: EmailDebateSession = {
      threadId,
      recipients: this.getHumanParticipants(thread),
      turnCounter: modelTurnCount,
      turnContentBuffer: '',
      lastMessageId: lastReplyTargetId,
      turnStartHumanMessageId: this.getLatestHumanReplyMessageId(threadId),
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
      if (this.useAgentMailOutbound()) {
        const result = await sendNewDebateEmail(this.getAgentMailConfig(), {
          fromModel: 'council',
          to: session.recipients,
          subject: thread.subject,
          body: formatDebatePlainText(body, this.config.fromName),
          headers: {
            'Message-ID': messageId,
          },
        });
        session.lastMessageId = messageId;
        this.store.setProviderThreadId(threadId, result.threadId);
        this.store.addMessage(threadId, {
          messageId,
          providerMessageId: result.messageId || null,
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
      } else {
        const visibleCc = this.getVisibleCc(thread);
        await sendDebateEmail(this.config.smtp, {
          from: this.getSystemFromAddress(),
          fromName: this.config.fromName,
          to: session.recipients,
          cc: visibleCc,
          envelopeTo: session.recipients,
          subject: thread.subject,
          body: formatDebatePlainText(body, this.config.fromName),
          messageId,
          inReplyTo: null,
          references: [],
        });
        session.lastMessageId = messageId;
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
      }
      this.emitEvent({ type: 'email_sent', threadId, messageId, author: 'system', turnNumber: null });
    } catch (error) {
      log.error('Failed to send topic email for %s: %s', threadId, error);
      this.emitEvent({
        type: 'error',
        threadId,
        message: `Failed to send topic email: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private async sendTurnEmail(
    threadId: string,
    speaker: string,
    round: number,
    tokenUsage: EmailThreadTurnTokenUsage | null,
  ): Promise<DeferredTurnDelivery | null> {
    const session = this.ensureSession(threadId);
    const thread = this.requireThread(threadId);
    const rawBody = session.turnContentBuffer.trim() || `[Turn ${round} by ${speaker}]`;
    session.turnContentBuffer = '';
    const pendingReply = this.getPendingHumanReply(threadId);
    if (pendingReply && pendingReply.messageId !== session.turnStartHumanMessageId) {
      this.emitEvent({
        type: 'turn_delivery_deferred',
        threadId,
        speaker,
        round,
        humanMessageId: pendingReply.messageId,
      });
      return {
        speaker,
        round,
        humanMessageId: pendingReply.messageId,
        humanBody: pendingReply.body,
      };
    }

    session.turnCounter += 1;
    const turnNumber = session.turnCounter;
    const body = formatDebatePlainText(rawBody, speaker, this.getSpeakerSignatureDetail(speaker));

    try {
      let messageId = generateMessageId(threadId, turnNumber);
      const inReplyTo = session.lastMessageId ?? this.getLastVisibleMessageId(thread);
      const references = this.buildThreadReferences(thread);
      if (this.useAgentMailOutbound()) {
        const result = await sendNewDebateEmail(this.getAgentMailConfig(), {
          fromModel: this.speakerToModelKey(speaker),
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          headers: {
            'Message-ID': messageId,
            ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
            ...(references.length > 0 ? { References: references.join(' ') } : {}),
          },
        });
        session.lastMessageId = messageId;
        this.store.setProviderThreadId(threadId, result.threadId);
        this.store.addMessage(threadId, {
          messageId,
          providerMessageId: result.messageId || null,
          inReplyTo,
          references,
          from: this.config.fromAddress,
          fromName: speaker,
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          sentAt: new Date().toISOString(),
          author: speaker,
          turnNumber,
          tokenUsage,
        });
      } else {
        const visibleCc = this.getVisibleCc(thread, speaker);
        await sendDebateEmail(this.config.smtp, {
          from: this.getSpeakerFromAddress(speaker),
          fromName: speaker,
          to: session.recipients,
          cc: visibleCc,
          envelopeTo: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          messageId,
          inReplyTo,
          references,
        });
        session.lastMessageId = messageId;
        this.store.addMessage(threadId, {
          messageId,
          providerMessageId: null,
          inReplyTo,
          references,
          from: this.config.fromAddress,
          fromName: speaker,
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          sentAt: new Date().toISOString(),
          author: speaker,
          turnNumber,
          tokenUsage,
        });
      }
      if (session.turnStartHumanMessageId) {
        this.store.setLastInjectedHumanMessageId(threadId, session.turnStartHumanMessageId);
      }
      this.emitEvent({ type: 'email_sent', threadId, messageId, author: speaker, turnNumber });
    } catch (error) {
      log.error('Failed to send turn email for %s: %s', threadId, error);
      this.emitEvent({
        type: 'error',
        threadId,
        message: `Failed to send turn email: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return null;
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
      const inReplyTo = session.lastMessageId ?? this.getLastVisibleMessageId(thread);
      const references = this.buildThreadReferences(thread);
      if (this.useAgentMailOutbound()) {
        const result = await sendNewDebateEmail(this.getAgentMailConfig(), {
          fromModel: 'council',
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          headers: {
            'Message-ID': messageId,
            ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
            ...(references.length > 0 ? { References: references.join(' ') } : {}),
          },
        });
        session.lastMessageId = messageId;
        this.store.setProviderThreadId(threadId, result.threadId);
        this.store.addMessage(threadId, {
          messageId,
          providerMessageId: result.messageId || null,
          inReplyTo,
          references,
          from: this.config.fromAddress,
          fromName: 'Council',
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          sentAt: new Date().toISOString(),
          author: 'conclusion',
          turnNumber,
        });
      } else {
        const visibleCc = this.getVisibleCc(thread);
        await sendDebateEmail(this.config.smtp, {
          from: this.getSystemFromAddress(),
          fromName: 'Council',
          to: session.recipients,
          cc: visibleCc,
          envelopeTo: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          messageId,
          inReplyTo,
          references,
        });
        session.lastMessageId = messageId;
        this.store.addMessage(threadId, {
          messageId,
          providerMessageId: null,
          inReplyTo,
          references,
          from: this.config.fromAddress,
          fromName: 'Council',
          to: session.recipients,
          subject: `Re: ${thread.subject}`,
          body,
          sentAt: new Date().toISOString(),
          author: 'conclusion',
          turnNumber,
        });
      }
    } catch (error) {
      log.error('Failed to send conclusion email for %s: %s', threadId, error);
    }
  }

  private recordHumanReply(
    threadId: string,
    message: EmailThread['messages'][number]
  ): void {
    this.store.addMessage(threadId, message);
    const thread = this.requireThread(threadId);
    this.refreshSessionRecipients(threadId, thread);

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

  private getHumanParticipants(thread: EmailThread): string[] {
    return thread.participants.filter(
      (participant) => participant !== thread.owner && !this.isAgentAlias(participant)
    );
  }

  private refreshSessionRecipients(threadId: string, thread: EmailThread): void {
    const session = this.sessions.get(threadId);
    if (!session) {
      return;
    }

    session.recipients = this.getHumanParticipants(thread);
  }

  private getSystemFromAddress(): string {
    return this.config.fromAddress;
  }

  private getSpeakerFromAddress(speaker: string): string {
    const domain = this.config.fromAddress.split('@')[1];
    if (!domain) {
      return this.config.fromAddress;
    }

    return `${this.speakerToModelKey(speaker)}@${domain}`;
  }

  private getSpeakerSignatureDetail(speaker: string): string | null {
    switch (this.speakerToModelKey(speaker)) {
      case 'opus':
        return 'Claude Opus 4.6';
      case 'sonnet':
        return 'Claude Sonnet';
      case 'codex':
        return 'GPT-5.3';
      default:
        return null;
    }
  }

  private getVisibleCc(thread: EmailThread, senderSpeaker?: string): string[] {
    const domain = this.config.fromAddress.split('@')[1];
    if (!domain) {
      return [];
    }

    const senderModel = senderSpeaker ? this.speakerToModelKey(senderSpeaker) : null;
    return thread.addressedModels
      .filter((model) => model !== 'council')
      .filter((model) => model !== senderModel)
      .map((model) => `${model}@${domain}`);
  }

  private getLastVisibleMessageId(thread: EmailThread): string | null {
    return thread.messages.at(-1)?.messageId ?? null;
  }

  private buildThreadReferences(thread: EmailThread): string[] {
    return [...new Set(thread.messages.map((message) => message.messageId).filter(Boolean))];
  }

  private getUninjectedHumanReplies(thread: EmailThread): EmailThread['messages'] {
    const humanReplies = thread.messages.filter((message) => message.author.startsWith('human:'));
    if (!thread.lastInjectedHumanMessageId) {
      return humanReplies;
    }

    const lastInjectedIndex = humanReplies.findIndex(
      (message) => message.messageId === thread.lastInjectedHumanMessageId
    );
    if (lastInjectedIndex < 0) {
      return humanReplies;
    }

    return humanReplies.slice(lastInjectedIndex + 1);
  }

  private formatHumanReplyBundle(replies: EmailThread['messages']): string {
    if (replies.length === 1) {
      return replies[0]?.body ?? '';
    }

    return replies
      .map((reply) => `[${reply.fromName} (${reply.from}) replied]\n${reply.body}`)
      .join('\n\n---\n\n');
  }

  private createInboundThreadFromMessage(incoming: AgentMailIncomingMessage): EmailThread | null {
    const routing = this.resolveInboundRouting(incoming);
    if (!routing) {
      return null;
    }

    const thread = this.createThread({
      topic: this.buildInboundTopic(incoming, routing.addressedModels),
      matchup: routing.matchup,
      maxTurns: DEFAULT_COUNCIL_MAX_TURNS,
      recipients: routing.humanRecipients,
      subject: incoming.subject || 'Email debate',
      source: 'email',
      inboundMessageId: incoming.messageId,
      addressedModels: routing.addressedModels,
      preferredStartSide: routing.preferredStartSide,
      providerThreadId: incoming.threadId,
    });

    this.store.setLastInjectedHumanMessageId(thread.id, incoming.messageId);
    this.store.addMessage(thread.id, {
      messageId: incoming.messageId,
      providerMessageId: incoming.providerMessageId,
      inReplyTo: incoming.inReplyTo,
      references: incoming.references,
      from: incoming.from,
      fromName: incoming.fromName,
      to: routing.humanRecipients,
      subject: incoming.subject || normalizeTheorySubject('Email debate'),
      body: incoming.body,
      sentAt: incoming.date,
      author: `human:${incoming.from}`,
      turnNumber: null,
    });
    this.sessions.delete(thread.id);

    return this.requireThread(thread.id);
  }

  private resolveInboundRouting(
    incoming: AgentMailIncomingMessage,
  ): { matchup: string; addressedModels: EmailDebateInboxKey[]; humanRecipients: string[]; preferredStartSide: 'a' | 'b' } | null {
    const toModels = this.extractAddressedModels(incoming.to);
    const ccModels = this.extractAddressedModels(incoming.cc);
    const headerModels = this.extractAddressedModels(this.getInboundHeaderAddresses(incoming));
    let addressedModels = [...new Set([...toModels, ...ccModels, ...headerModels])];

    if (addressedModels.includes('council') && addressedModels.length > 1) {
      addressedModels = addressedModels.filter((model) => model !== 'council');
    }

    if (addressedModels.length === 0) {
      if (incoming.receivingInbox === 'council') {
        addressedModels = ['opus', 'codex'];
      } else {
        addressedModels = [incoming.receivingInbox];
      }
    }

    if (addressedModels.length === 1 && addressedModels[0] === 'council') {
      addressedModels = ['opus', 'codex'];
    }

    if (addressedModels.length === 0) {
      return null;
    }

    const firstToModel = toModels[0];
    if (addressedModels.length === 1) {
      const model = addressedModels[0];
      return {
        matchup: `${model}-vs-${model}`,
        addressedModels,
        humanRecipients: this.resolveHumanRecipients(incoming),
        preferredStartSide: 'a',
      };
    }

    let pair = addressedModels.slice(0, 2);
    if (firstToModel) {
      const firstOpponent = addressedModels.find((model) => model !== firstToModel);
      pair = [firstToModel, firstOpponent ?? addressedModels[1]];
    } else if (addressedModels.length >= 2 && this.shouldFlipCcOrder(incoming.messageId)) {
      pair = [addressedModels[1], addressedModels[0]];
    }

    return {
      matchup: `${pair[0]}-vs-${pair[1]}`,
      addressedModels: pair,
      humanRecipients: this.resolveHumanRecipients(incoming),
      preferredStartSide: 'a',
    };
  }

  private resolveHumanRecipients(incoming: AgentMailIncomingMessage): string[] {
    const humanRecipients = [
      incoming.from,
      ...incoming.to.filter((address) => !this.isAgentAlias(address)),
      ...incoming.cc.filter((address) => !this.isAgentAlias(address)),
      ...this.getInboundHeaderAddresses(incoming).filter((address) => !this.isAgentAlias(address)),
    ];
    return this.normalizeRecipients(humanRecipients);
  }

  private resolveThreadHumanRecipients(
    thread: EmailThread,
    from: string,
    to: string[],
    cc: string[],
  ): string[] {
    return this.normalizeRecipients([
      ...this.getHumanParticipants(thread),
      from,
      ...to.filter((address) => !this.isAgentAlias(address)),
      ...cc.filter((address) => !this.isAgentAlias(address)),
    ]);
  }

  private extractAddressedModels(addresses: string[]): EmailDebateInboxKey[] {
    const models: EmailDebateInboxKey[] = [];
    for (const address of addresses) {
      const model = this.addressToModelKey(address);
      if (model && !models.includes(model)) {
        models.push(model);
      }
    }
    return models;
  }

  private addressToModelKey(address: string): EmailDebateInboxKey | null {
    const localPart = address.trim().toLowerCase().split('@')[0] ?? '';
    if (localPart in MODEL_INBOXES) {
      return localPart as EmailDebateInboxKey;
    }
    return null;
  }

  private isAgentAlias(address: string): boolean {
    return this.addressToModelKey(address) !== null;
  }

  private shouldFlipCcOrder(messageId: string): boolean {
    const digest = crypto.createHash('sha256').update(messageId).digest('hex');
    const nibble = Number.parseInt(digest[0] ?? '0', 16);
    return Number.isFinite(nibble) && nibble % 2 === 1;
  }

  private getInboundHeaderAddresses(incoming: AgentMailIncomingMessage): string[] {
    return this.normalizeRecipients([
      ...this.parseHeaderAddressList(incoming.headers.to),
      ...this.parseHeaderAddressList(incoming.headers.cc),
      ...this.parseHeaderAddressList(incoming.headers['x-gm-original-to']),
      ...this.parseHeaderAddressList(incoming.headers['x-original-to']),
      ...this.parseHeaderAddressList(incoming.headers['delivered-to']),
    ]);
  }

  private parseHeaderAddressList(value: string | undefined): string[] {
    if (!value) {
      return [];
    }

    return value
      .split(',')
      .map((entry) => entry.trim())
      .map((entry) => entry.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? '')
      .filter(Boolean);
  }

  private buildInboundTopic(incoming: AgentMailIncomingMessage, addressedModels: EmailDebateInboxKey[]): string {
    const sections = [
      'A human started this debate by email.',
      'If the request is underspecified, use your first reply to ask concise clarifying questions before continuing.',
      '',
      `From: ${incoming.fromName} <${incoming.from}>`,
      incoming.subject ? `Subject: ${incoming.subject}` : null,
      incoming.to.length > 0 ? `To: ${incoming.to.join(', ')}` : null,
      incoming.cc.length > 0 ? `Cc: ${incoming.cc.join(', ')}` : null,
      addressedModels.length > 0 ? `Addressed agents: ${addressedModels.join(', ')}` : null,
      '',
      'Human message:',
      incoming.body.trim() || '[No body provided]',
    ].filter(Boolean);

    return sections.join('\n');
  }

  private getLatestHumanReplyMessageId(threadId: string): string | null {
    const thread = this.store.load(threadId);
    if (!thread) {
      return null;
    }

    const latestHumanReply = [...thread.messages]
      .reverse()
      .find((message) => message.author.startsWith('human:'));

    return latestHumanReply?.messageId ?? null;
  }

  private parseTurnTokenUsage(
    event: Extract<CouncilEvent, { type: 'turn_end' }>
  ): EmailThreadTurnTokenUsage | null {
    const tokenUsage: EmailThreadTurnTokenUsage = {
      inputTokens: this.parseTokenCount(event.inputTokens),
      outputTokens: this.parseTokenCount(event.outputTokens),
      totalTokens: this.parseTokenCount(event.totalTokens),
    };

    return tokenUsage.inputTokens != null ||
      tokenUsage.outputTokens != null ||
      tokenUsage.totalTokens != null
      ? tokenUsage
      : null;
  }

  private parseTokenCount(value: string | undefined): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
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
