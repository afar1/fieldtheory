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
  subject: string;
  body: string;
}

export interface AgentMailReplyOptions {
  fromModel: EmailDebateInboxKey;
  inReplyToMessageId: string;
  body: string;
}

export interface AgentMailIncomingMessage {
  messageId: string;
  threadId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  date: string;
}

type AgentMailClientLike = {
  inboxes: {
    create: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    list: () => Promise<Record<string, unknown> | Record<string, unknown>[]>;
    messages: {
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
    subject: options.subject,
    text: options.body,
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

  return messages
    .filter((message) => {
      const messageId = String(message.messageId ?? '');
      return Boolean(messageId) && !knownMessageIds.has(messageId);
    })
    .map((message) => ({
      messageId: String(message.messageId ?? ''),
      threadId: String(message.threadId ?? message.thread_id ?? ''),
      from: String((message.from_ as { address?: string } | undefined)?.address ?? message.from ?? ''),
      fromName: String((message.from_ as { name?: string } | undefined)?.name ?? message.from ?? 'Unknown'),
      subject: String(message.subject ?? ''),
      body: String(message.extractedText ?? message.text ?? ''),
      date: String(message.createdAt ?? new Date().toISOString()),
    }));
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
