/**
 * AgentMail transport for source-level email debate support.
 *
 * V1 uses this primarily for outbound model emails.
 */

import { AgentMailClient as AgentMailClientCtor } from 'agentmail';
import { createLogger } from '../logger';
import type { EmailDebateInboxKey } from './types';

const log = createLogger('AgentMailTransport');

export interface AgentMailConfig {
  apiKey: string;
  domain: string;
  inboxIds: Partial<Record<EmailDebateInboxKey, string>>;
}

export interface AgentMailSendOptions {
  fromModel: EmailDebateInboxKey;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  headers?: Record<string, string>;
}

export interface AgentMailReplyOptions {
  fromModel: EmailDebateInboxKey;
  inReplyToMessageId: string;
  body: string;
}

export interface AgentMailIncomingMessage {
  messageId: string;
  providerMessageId: string;
  threadId: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string[];
  headers: Record<string, string>;
  date: string;
  receivingInbox: EmailDebateInboxKey;
}

type AgentMailClientLike = {
  inboxes: {
    create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    list: () => Promise<Record<string, unknown> | Record<string, unknown>[]>;
    messages: {
      get: (inboxId: string, messageId: string) => Promise<Record<string, unknown>>;
      send: (inboxId: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      reply: (
        inboxId: string,
        messageId: string,
        input: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
      list: (inboxId: string, input: Record<string, unknown>) => Promise<Record<string, unknown> | Record<string, unknown>[]>;
    };
    threads: {
      list: (inboxId: string) => Promise<Record<string, unknown> | Record<string, unknown>[]>;
    };
  };
};

export const MODEL_INBOXES: Record<
  EmailDebateInboxKey,
  { username: string; displayName: string }
> = {
  opus: { username: 'opus', displayName: 'Claude Opus' },
  sonnet: { username: 'sonnet', displayName: 'Claude Sonnet' },
  codex: { username: 'codex', displayName: 'Codex (OpenAI)' },
  council: { username: 'council', displayName: 'Field Theory Council' },
};

let clientInstance: AgentMailClientLike | null = null;

function getClient(apiKey: string): AgentMailClientLike {
  if (!clientInstance) {
    clientInstance = new AgentMailClientCtor({ apiKey }) as unknown as AgentMailClientLike;
  }

  return clientInstance;
}

export function resetClient(): void {
  clientInstance = null;
}

export function setClientForTesting(client: AgentMailClientLike | null): void {
  clientInstance = client;
}

export async function ensureModelInbox(
  config: AgentMailConfig,
  modelKey: EmailDebateInboxKey
): Promise<string> {
  const cachedId = config.inboxIds[modelKey];
  if (cachedId) {
    return cachedId;
  }

  const model = MODEL_INBOXES[modelKey];
  const client = getClient(config.apiKey);

  try {
    const inbox = await client.inboxes.create({
      username: model.username,
      domain: config.domain,
      displayName: model.displayName,
      clientId: `ft-${model.username}-${config.domain}`,
    });

    const inboxId = String(inbox.inboxId ?? inbox.inbox_id ?? '');
    if (!inboxId) {
      throw new Error('No inboxId in AgentMail create response');
    }

    config.inboxIds[modelKey] = inboxId;
    log.info('Provisioned inbox %s@%s -> %s', model.username, config.domain, inboxId);
    return inboxId;
  } catch {
    return findInboxByUsername(config, modelKey);
  }
}

async function findInboxByUsername(
  config: AgentMailConfig,
  modelKey: EmailDebateInboxKey
): Promise<string> {
  const client = getClient(config.apiKey);
  const model = MODEL_INBOXES[modelKey];
  const response = await client.inboxes.list();
  const inboxes = Array.isArray(response)
    ? response
    : ((response.inboxes as Record<string, unknown>[] | undefined) ?? []);

  for (const inbox of inboxes) {
    const email = String(inbox.email ?? '');
    if (!email.startsWith(`${model.username}@`)) {
      continue;
    }

    const inboxId = String(inbox.inboxId ?? inbox.inbox_id ?? '');
    if (!inboxId) {
      continue;
    }

    config.inboxIds[modelKey] = inboxId;
    return inboxId;
  }

  throw new Error(`Could not find inbox for ${model.username}@${config.domain}`);
}

export async function provisionAllInboxes(config: AgentMailConfig): Promise<void> {
  for (const modelKey of Object.keys(MODEL_INBOXES) as EmailDebateInboxKey[]) {
    try {
      await ensureModelInbox(config, modelKey);
    } catch (error) {
      log.warn('Failed to provision %s inbox: %s', modelKey, error);
    }
  }
}

export async function sendNewDebateEmail(
  config: AgentMailConfig,
  options: AgentMailSendOptions
): Promise<{ messageId: string; threadId: string }> {
  const inboxId = await ensureModelInbox(config, options.fromModel);
  const client = getClient(config.apiKey);
  const response = await client.inboxes.messages.send(inboxId, {
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    text: options.body,
    headers: options.headers,
  });

  return {
    messageId: String(response.messageId ?? response.message_id ?? ''),
    threadId: String(response.threadId ?? response.thread_id ?? ''),
  };
}

export async function replyToDebateEmail(
  config: AgentMailConfig,
  options: AgentMailReplyOptions
): Promise<{ messageId: string; threadId: string }> {
  const inboxId = await ensureModelInbox(config, options.fromModel);
  const client = getClient(config.apiKey);
  const response = await client.inboxes.messages.reply(
    inboxId,
    options.inReplyToMessageId,
    { text: options.body }
  );

  return {
    messageId: String(response.messageId ?? response.message_id ?? ''),
    threadId: String(response.threadId ?? response.thread_id ?? ''),
  };
}

export async function checkForReplies(
  config: AgentMailConfig,
  modelKey: EmailDebateInboxKey,
  knownMessageIds: Set<string>
): Promise<AgentMailIncomingMessage[]> {
  const inboxId = await ensureModelInbox(config, modelKey);
  const client = getClient(config.apiKey);
  const response = await client.inboxes.messages.list(inboxId, { limit: 50 });
  const messages = Array.isArray(response)
    ? response
    : ((response.messages as Record<string, unknown>[] | undefined) ?? []);

  const incomingMessages: AgentMailIncomingMessage[] = [];

  for (const messageItem of messages) {
    const messageId = getCanonicalMessageId(messageItem);
    if (!messageId || knownMessageIds.has(messageId)) {
      continue;
    }

    let fullMessage = messageItem;
    try {
      fullMessage = await client.inboxes.messages.get(inboxId, String(messageItem.messageId ?? messageId));
    } catch (error) {
      log.warn('Falling back to AgentMail list payload for %s: %s', messageId, error);
    }

    const incoming = toIncomingMessage(fullMessage, modelKey);
    if (incoming.messageId && !knownMessageIds.has(incoming.messageId)) {
      incomingMessages.push(incoming);
    }
  }

  return incomingMessages;
}

export async function listThreads(
  config: AgentMailConfig,
  modelKey: EmailDebateInboxKey
): Promise<Array<{ threadId: string; subject: string; lastActivity: string }>> {
  const inboxId = await ensureModelInbox(config, modelKey);
  const client = getClient(config.apiKey);
  const response = await client.inboxes.threads.list(inboxId);
  const threads = Array.isArray(response)
    ? response
    : ((response.threads as Record<string, unknown>[] | undefined) ?? []);

  return threads.map((thread) => ({
    threadId: String(thread.threadId ?? ''),
    subject: String(thread.subject ?? ''),
    lastActivity: String(thread.lastActivity ?? ''),
  }));
}

export async function testConnection(apiKey: string): Promise<{ ok: true; inboxCount: number }> {
  const client = new AgentMailClientCtor({ apiKey }) as unknown as AgentMailClientLike;
  const response = await client.inboxes.list();
  const inboxes = Array.isArray(response)
    ? response
    : ((response.inboxes as unknown[] | undefined) ?? []);

  return { ok: true, inboxCount: inboxes.length };
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    normalized[key.toLowerCase()] = String(value);
  }
  return normalized;
}

function getCanonicalMessageId(message: Record<string, unknown>): string {
  const headers = normalizeHeaders((message.headers as Record<string, unknown> | undefined) ?? {});
  return headers['message-id'] ?? String(message.messageId ?? '');
}

function extractReferences(rawReferences: unknown, headerReferences?: string): string[] {
  if (Array.isArray(rawReferences)) {
    return rawReferences.map(String).map((value) => value.trim()).filter(Boolean);
  }
  if (typeof rawReferences === 'string') {
    return rawReferences.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  }
  if (!headerReferences) {
    return [];
  }
  return headerReferences.split(/\s+/).map((value) => value.trim()).filter(Boolean);
}

function parseAddressList(raw: string | string[]): string[] {
  const values = Array.isArray(raw) ? raw : raw.split(',');
  const addresses = values
    .map((value) => parseMailboxAddress(value).address)
    .filter(Boolean);
  return [...new Set(addresses)];
}

function getRecipientAddresses(
  message: Record<string, unknown>,
  field: 'to' | 'cc',
  headerNames: string[],
): string[] {
  const headers = normalizeHeaders((message.headers as Record<string, unknown> | undefined) ?? {});
  const rawApiValue = field === 'to' ? message.to : message.cc;
  const apiValues = Array.isArray(rawApiValue) ? rawApiValue.map(String) : [];
  const headerValues = headerNames
    .map((name) => headers[name])
    .filter((value): value is string => Boolean(value));

  return parseAddressList([...apiValues, ...headerValues]);
}

function toIncomingMessage(
  message: Record<string, unknown>,
  receivingInbox: EmailDebateInboxKey,
): AgentMailIncomingMessage {
  const headers = normalizeHeaders((message.headers as Record<string, unknown> | undefined) ?? {});
  const fromMailbox = parseMailboxAddress(String(message.from ?? ''));

  return {
    messageId: headers['message-id'] ?? String(message.messageId ?? ''),
    providerMessageId: String(message.messageId ?? ''),
    threadId: String(message.threadId ?? message.thread_id ?? ''),
    from: fromMailbox.address,
    fromName: fromMailbox.name,
    to: getRecipientAddresses(message, 'to', ['to', 'x-gm-original-to', 'x-original-to', 'delivered-to']),
    cc: getRecipientAddresses(message, 'cc', ['cc']),
    subject: String(message.subject ?? ''),
    body: extractMessageBody(message),
    inReplyTo: String(message.inReplyTo ?? headers['in-reply-to'] ?? '') || null,
    references: extractReferences(message.references, headers['references']),
    headers,
    date: String(message.createdAt ?? new Date().toISOString()),
    receivingInbox,
  };
}

export function extractMessageBody(message: Record<string, unknown>): string {
  return String(
    message.extractedText ??
    message.text ??
    message.extractedHtml ??
    message.html ??
    message.preview ??
    ''
  );
}

function parseMailboxAddress(raw: string): { address: string; name: string } {
  const trimmed = raw.trim();
  const angleMatch = trimmed.match(/^(.*)<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1]?.trim().replace(/^"+|"+$/g, '') || 'Unknown';
    return {
      address: angleMatch[2]?.trim().toLowerCase() ?? '',
      name,
    };
  }

  const addressMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  if (!addressMatch) {
    return { address: '', name: 'Unknown' };
  }

  const localPart = addressMatch.split('@')[0] ?? 'Unknown';
  const displayName = localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : 'Unknown';
  return {
    address: addressMatch.toLowerCase(),
    name: displayName,
  };
}
