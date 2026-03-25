/**
 * Types for the email-based debate system.
 *
 * Debates run through the existing council engine, but each turn can also be
 * sent as a real email. Human replies can later resume the same thread.
 */

import type { CouncilTokenUsage } from '../types/council';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export type EmailDebateOutboundTransport = 'agentmail' | 'smtp';
export type EmailDebateInboundTransport = 'agentmail' | 'imap';
export type EmailDebateThreadSource = 'local' | 'email';

export type EmailDebateThreadStatus = 'active' | 'concluded' | 'closed';

export type EmailDebateInboxKey = 'opus' | 'sonnet' | 'codex' | 'council';

export interface EmailThreadTurnTokenUsage extends CouncilTokenUsage {}

export interface EmailThreadTokenUsage extends CouncilTokenUsage {
  turnsWithUsage: number;
}

export function createEmptyEmailThreadTokenUsage(): EmailThreadTokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    turnsWithUsage: 0,
  };
}

export interface EmailDebateConfig {
  smtp: SmtpConfig;
  imap: ImapConfig;
  fromAddress: string;
  fromName: string;
  defaultRecipients: string[];
  autoSendConclusionEmail: boolean;
  pollIntervalMs: number;
  enabled: boolean;
  outboundTransport: EmailDebateOutboundTransport;
  inboundTransport: EmailDebateInboundTransport;
  agentMailApiKey: string;
  agentMailDomain: string;
  agentMailInboxIds: Partial<Record<EmailDebateInboxKey, string>>;
}

export interface EmailThreadMessage {
  messageId: string;
  providerMessageId?: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  sentAt: string;
  author: string;
  turnNumber: number | null;
  tokenUsage?: EmailThreadTurnTokenUsage | null;
}

export interface EmailThread {
  id: string;
  rootMessageId: string;
  subject: string;
  topic: string;
  matchup: string;
  repoPath: string | null;
  status: EmailDebateThreadStatus;
  providerThreadId: string | null;
  participants: string[];
  owner: string;
  messages: EmailThreadMessage[];
  tokenUsage: EmailThreadTokenUsage;
  modelTurnCount: number;
  maxTurns: number | null;
  extensionTurns: number;
  createdAt: string;
  updatedAt: string;
  transcriptPath: string | null;
  consensusPath: string | null;
  resumeStatePath: string | null;
  lastInjectedHumanMessageId: string | null;
  source: EmailDebateThreadSource;
  inboundMessageId: string | null;
  addressedModels: EmailDebateInboxKey[];
  preferredStartSide: 'a' | 'b' | null;
}

export type EmailDebateEvent =
  | { type: 'thread_created'; threadId: string; subject: string }
  | { type: 'inbound_thread_ready'; threadId: string }
  | { type: 'thread_concluded'; threadId: string }
  | { type: 'thread_closed'; threadId: string }
  | { type: 'thread_reopened'; threadId: string }
  | { type: 'email_sent'; threadId: string; messageId: string; author: string; turnNumber: number | null }
  | {
      type: 'turn_delivery_deferred';
      threadId: string;
      speaker: string;
      round: number;
      humanMessageId: string;
    }
  | { type: 'reply_received'; threadId: string; from: string; body: string; messageId: string }
  | { type: 'error'; threadId: string; message: string };

export interface EmailDebateConnectionStatus {
  smtp: boolean;
  imap: boolean;
  agentMail: boolean;
  errors: string[];
}

export const DEFAULT_EMAIL_DEBATE_CONFIG: EmailDebateConfig = {
  smtp: { host: '', port: 587, secure: false, user: '', pass: '' },
  imap: { host: '', port: 993, secure: true, user: '', pass: '' },
  fromAddress: '',
  fromName: 'Field Theory Council',
  defaultRecipients: [],
  autoSendConclusionEmail: false,
  pollIntervalMs: 15_000,
  enabled: false,
  outboundTransport: 'agentmail',
  inboundTransport: 'imap',
  agentMailApiKey: '',
  agentMailDomain: 'agentmail.to',
  agentMailInboxIds: {},
};

export const EmailDebateIPCChannels = {
  GET_CONFIG: 'emailDebate:getConfig',
  SAVE_CONFIG: 'emailDebate:saveConfig',
  TEST_CONNECTION: 'emailDebate:testConnection',
  GET_THREADS: 'emailDebate:getThreads',
  GET_THREAD: 'emailDebate:getThread',
  CLOSE_THREAD: 'emailDebate:closeThread',
  REOPEN_THREAD: 'emailDebate:reopenThread',
  EVENT: 'emailDebate:event',
} as const;
