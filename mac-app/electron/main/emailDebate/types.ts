/**
 * Types for the email-based debate system.
 *
 * Debates run through the existing council engine, but each turn can also be
 * sent as a real email. Human replies can later resume the same thread.
 */

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

export type EmailDebateTransport = 'agentmail' | 'smtp';

export type EmailDebateThreadStatus = 'active' | 'concluded' | 'closed';

export type EmailDebateInboxKey = 'opus' | 'sonnet' | 'codex' | 'council';

export interface EmailDebateConfig {
  smtp: SmtpConfig;
  imap: ImapConfig;
  fromAddress: string;
  fromName: string;
  defaultRecipients: string[];
  pollIntervalMs: number;
  enabled: boolean;
  transport: EmailDebateTransport;
  agentMailApiKey: string;
  agentMailDomain: string;
  agentMailInboxIds: Partial<Record<EmailDebateInboxKey, string>>;
}

export interface EmailThreadMessage {
  messageId: string;
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
  modelTurnCount: number;
  maxTurns: number | null;
  extensionTurns: number;
  createdAt: string;
  updatedAt: string;
  transcriptPath: string | null;
  consensusPath: string | null;
}

export type EmailDebateEvent =
  | { type: 'thread_created'; threadId: string; subject: string }
  | { type: 'thread_concluded'; threadId: string }
  | { type: 'thread_closed'; threadId: string }
  | { type: 'thread_reopened'; threadId: string }
  | { type: 'email_sent'; threadId: string; messageId: string; author: string; turnNumber: number | null }
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
  pollIntervalMs: 15_000,
  enabled: false,
  transport: 'agentmail',
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
