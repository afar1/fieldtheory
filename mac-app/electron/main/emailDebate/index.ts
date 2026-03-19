export {
  MODEL_INBOXES,
  checkForReplies,
  ensureModelInbox,
  listThreads,
  provisionAllInboxes,
  replyToDebateEmail,
  resetClient,
  sendNewDebateEmail,
  testConnection,
  type AgentMailConfig,
  type AgentMailIncomingMessage,
  type AgentMailReplyOptions,
  type AgentMailSendOptions,
} from './agentMailTransport';
export { EmailDebateCoordinator } from './coordinator';
export { EmailDebateManager } from './manager';
export {
  ThreadStore,
} from './threadStore';
export {
  formatDebatePlainText,
  generateMessageId,
  generateRootMessageId,
  type IncomingReply,
  pollForReplies,
  sendDebateEmail,
  stripQuotedReply,
  testImapConnection,
  testSmtpConnection,
} from './transport';
export {
  DEFAULT_EMAIL_DEBATE_CONFIG,
  EmailDebateIPCChannels,
} from './types';
export type {
  EmailDebateCoordinatorOptions,
  StartEmailDebateOptions,
} from './coordinator';
export type {
  CreateThreadOptions,
  DeferredTurnDelivery,
  HandleCouncilEventResult,
} from './manager';
export type {
  EmailDebateConfig,
  EmailDebateConnectionStatus,
  EmailDebateEvent,
  EmailDebateInboxKey,
  EmailDebateInboundTransport,
  EmailDebateOutboundTransport,
  EmailDebateThreadStatus,
  EmailThread,
  EmailThreadMessage,
  ImapConfig,
  SmtpConfig,
} from './types';
